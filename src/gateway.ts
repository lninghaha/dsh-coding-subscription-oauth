/**
 * Start, stop, and rotate the opt-in local coding-subscription API gateway.
 * @module dsh-coding-subscription-oauth/gateway
 */

import type { Server } from "node:http";
import {
	gatewayKeyPath,
	generateGatewayApiKey,
	loadGatewayKeyDocument,
	loadOrCreateGatewayApiKey,
	maskGatewayApiKey,
	persistGatewayKeyDocument,
} from "./gateway-auth.ts";
import { createSessionGatewayBackend, type GatewayBackend, GatewayRequestError } from "./gateway-backend.ts";
import { assertGatewayPort, type GatewayConfig, resolveGatewayConfig } from "./gateway-config.ts";
import { type GatewayGoRoute, parseGatewayGoRoute } from "./gateway-go-routing.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "./gateway-http.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import type { GrokBuildSession } from "./session.ts";

export const GATEWAY_TOS_WARNING =
	"local API gateway is enabled; exposing a subscription as a local API can violate provider ToS and consumes your quota";

export interface StartGatewayOptions {
	getGoPreview?: () => GatewayGoRoute | null;
	resolveGoCredential?: (ref: string) => Promise<string | undefined>;
	config?: Partial<GatewayConfig>;
	dshHome?: string;
	backend?: GatewayBackend;
	grok?: GrokBuildSession;
	subscriptions?: readonly OAuthProviderSession[];
	onError?: (error: unknown) => void;
}

export interface StartedGateway {
	close(): Promise<void>;
	readonly bind: string;
	readonly port: number;
}

export interface GatewayPublicStatus {
	enabled: boolean;
	running: boolean;
	bind: string;
	port: number;
	model: string | null;
	keyConfigured: boolean;
	keyAvailable: boolean;
	keyHint: string;
	models: string[];
	warning: string;
	opencodeGoEnabled: boolean;
	opencodeGoRoute?: GatewayGoRoute | null;
	opencodeGoPreview?: GatewayGoRoute | null;
	opencodeGoMigration?: "required" | "none";
}

export interface GatewaySettingsPatch {
	enabled?: boolean;
	port?: number;
	opencodeGoEnabled?: boolean;
	opencodeGoRoute?: GatewayGoRoute | null;
}

export interface CodingOAuthGatewayController {
	applySettings(patch: GatewaySettingsPatch): Promise<GatewayPublicStatus>;
	status(): Promise<GatewayPublicStatus>;
	startIfEnabled(): Promise<StartedGateway | undefined>;
	setEnabled(enabled: boolean): Promise<GatewayPublicStatus>;
	setPort(port: number): Promise<GatewayPublicStatus>;
	setOpencodeGoEnabled(enabled: boolean): Promise<GatewayPublicStatus>;
	revealKey(): Promise<{ apiKey: string; keyHint: string }>;
	rotateKey(): Promise<{ apiKey: string; keyHint: string }>;
	stop(): Promise<void>;
}

export async function startCodingOAuthGateway(options: StartGatewayOptions): Promise<StartedGateway | undefined> {
	const controller = createCodingOAuthGatewayController(options);
	return controller.startIfEnabled();
}

export function createCodingOAuthGatewayController(options: StartGatewayOptions): CodingOAuthGatewayController {
	const yaml = resolveGatewayConfig(options.config);
	const path = gatewayKeyPath(options.dshHome);
	const backend = (): GatewayBackend => {
		if (options.backend !== undefined) return options.backend;
		if (options.grok === undefined) throw new Error("gateway requires a backend or Grok session");
		return createSessionGatewayBackend(options.grok, options.subscriptions ?? []);
	};
	let goRoute: GatewayGoRoute | null = null;
	let server: Server | undefined;
	let apiKey = yaml.apiKey ?? "";
	let port = yaml.port;
	let opencodeGoEnabled = yaml.opencodeGo.enabled;
	let lock: Promise<void> = Promise.resolve();

	const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
		const previous = lock;
		let release: () => void = () => undefined;
		lock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await work();
		} finally {
			release();
		}
	};

	const closeServer = async (): Promise<void> => {
		if (server === undefined) return;
		const current = server;
		server = undefined;
		await closeGateway(current).catch(() => undefined);
	};

	const activeConfig = (): GatewayConfig => ({ ...yaml, port, opencodeGo: { enabled: opencodeGoEnabled } });

	const snapshot = async (enabled?: boolean): Promise<GatewayPublicStatus> => {
		let models: string[] = [];
		try {
			models = (await backend().listModels()).map((model) => model.id);
		} catch {
			// Status stays usable when no provider credential can currently list models.
		}
		models = [
			...models.filter((id) => !id.startsWith("opencode-go/")),
			...(goRoute?.models.map((model) => "opencode-go/" + model.id) ?? []),
		];
		return {
			enabled: enabled ?? (await desiredEnabled()),
			running: server !== undefined,
			bind: yaml.bind,
			port,
			model: models[0] ?? null,
			keyConfigured: apiKey.length > 0,
			keyAvailable: apiKey.length > 0,
			keyHint: apiKey.length === 0 ? "" : maskGatewayApiKey(apiKey),
			models,
			warning: GATEWAY_TOS_WARNING,
			opencodeGoEnabled: goRoute !== null,
			opencodeGoRoute: goRoute,
			opencodeGoPreview: options.getGoPreview?.() ?? null,
			opencodeGoMigration: opencodeGoEnabled ? "required" : "none",
		};
	};

	const persistState = async (next: {
		enabled?: boolean;
		port?: number;
		apiKey?: string;
		opencodeGoEnabled?: boolean;
		opencodeGoRoute?: GatewayGoRoute | null;
	}): Promise<void> => {
		const document = await loadGatewayKeyDocument(path);
		const nextKey = next.apiKey ?? (apiKey.length === 0 ? document?.apiKey : apiKey);
		if (nextKey === undefined || nextKey.length === 0) throw new Error("gateway api key is missing");

		const nextEnabled = next.enabled ?? document?.enabled;
		const nextPort = next.port ?? document?.port ?? port;

		const nextOpencodeGo = next.opencodeGoEnabled ?? document?.opencodeGoEnabled;
		await persistGatewayKeyDocument(path, {
			version: 1,
			apiKey: nextKey,
			...(nextEnabled === undefined ? {} : { enabled: nextEnabled }),
			port: nextPort,
			...(nextOpencodeGo === undefined ? {} : { opencodeGoEnabled: nextOpencodeGo }),
			opencodeGoRoute:
				next.opencodeGoRoute !== undefined ? next.opencodeGoRoute : (document?.opencodeGoRoute ?? goRoute),
		});
		apiKey = nextKey;
		port = nextPort;
		if (nextOpencodeGo !== undefined) opencodeGoEnabled = nextOpencodeGo;
		if (next.opencodeGoRoute !== undefined) goRoute = next.opencodeGoRoute;
	};

	const listen = async (): Promise<StartedGateway> => {
		if (apiKey.length === 0) apiKey = await loadOrCreateGatewayApiKey(path, yaml.apiKey);
		const config = activeConfig();
		const http = createGatewayHttpServer({
			config,
			apiKey,
			backend: backend(),
			getOpencodeGoRoute: () => goRoute,
			resolveGoCredential: options.resolveGoCredential ?? (async () => undefined),
		});
		try {
			await listenGateway(http, config);
		} catch (error) {
			await closeGateway(http).catch(() => undefined);
			options.onError?.(error);
			throw error;
		}
		server = http;
		return { bind: config.bind, port: config.port, close: () => closeServer() };
	};

	const desiredEnabled = async (): Promise<boolean> => {
		const document = await loadGatewayKeyDocument(path);
		return document?.enabled ?? yaml.enabled;
	};

	const desiredOpencodeGoEnabled = async (): Promise<boolean> => {
		const document = await loadGatewayKeyDocument(path);
		return document?.opencodeGoEnabled ?? yaml.opencodeGo.enabled;
	};

	const hydratePort = async (): Promise<void> => {
		const document = await loadGatewayKeyDocument(path);
		if (document?.port !== undefined) port = document.port;
	};

	const hydrateOpencodeGo = async (): Promise<void> => {
		opencodeGoEnabled = await desiredOpencodeGoEnabled();
		goRoute = (await loadGatewayKeyDocument(path))?.opencodeGoRoute ?? null;
	};

	const applySettings = (patch: GatewaySettingsPatch): Promise<GatewayPublicStatus> =>
		withLock(async () => {
			if (patch.enabled !== undefined && typeof patch.enabled !== "boolean")
				throw new GatewayRequestError(400, "invalid_enabled", "enabled must be a boolean");
			if (patch.opencodeGoEnabled !== undefined && typeof patch.opencodeGoEnabled !== "boolean")
				throw new GatewayRequestError(400, "invalid_go_mode", "opencodeGoEnabled must be a boolean");
			if (patch.opencodeGoEnabled === true)
				throw new GatewayRequestError(
					409,
					"go_migration_required",
					"Review and apply the explicit opencode-go/<model> route",
				);
			let wantedPort: number | undefined;
			try {
				wantedPort = patch.port === undefined ? undefined : assertGatewayPort(patch.port);
			} catch (error) {
				throw new GatewayRequestError(400, "invalid_port", error instanceof Error ? error.message : "Invalid port");
			}
			const wantedRoute = patch.opencodeGoRoute === undefined ? undefined : parseGatewayGoRoute(patch.opencodeGoRoute);
			if (wantedRoute && !(await options.resolveGoCredential?.(wantedRoute.credentialRef)))
				throw new GatewayRequestError(
					409,
					"go_credential_missing",
					"The selected Go credential reference is unavailable",
				);
			await hydratePort();
			await hydrateOpencodeGo();
			const document = await loadGatewayKeyDocument(path);
			const previous = {
				port,
				opencodeGoRoute: goRoute,
				opencodeGoEnabled,
				enabled: await desiredEnabled(),
				apiKey: document?.apiKey ?? apiKey,
			};
			const wasRunning = server !== undefined;
			const nextEnabled = patch.enabled ?? previous.enabled;
			await persistState({
				apiKey: previous.apiKey || generateGatewayApiKey(),
				enabled: nextEnabled,
				...(wantedPort === undefined ? {} : { port: wantedPort }),
				...(wantedRoute === undefined ? {} : { opencodeGoRoute: wantedRoute, opencodeGoEnabled: false }),
				...(patch.opencodeGoEnabled === false ? { opencodeGoEnabled: false, opencodeGoRoute: null } : {}),
			});
			try {
				if (server && (!nextEnabled || previous.port !== port)) await closeServer();
				if (nextEnabled && !server) await listen();
			} catch (error) {
				await closeServer();
				await persistState({ ...previous, apiKey: previous.apiKey || apiKey });
				if (wasRunning) await listen();
				throw error;
			}
			return snapshot();
		});

	return {
		async status() {
			await hydratePort();
			await hydrateOpencodeGo();
			if (apiKey.length === 0) {
				const document = await loadGatewayKeyDocument(path);
				apiKey = document?.apiKey ?? "";
			}
			return snapshot();
		},
		startIfEnabled() {
			return withLock(async () => {
				await hydratePort();
				await hydrateOpencodeGo();
				if (!(await desiredEnabled())) return undefined;
				if (server !== undefined) return { bind: yaml.bind, port, close: () => closeServer() };
				try {
					return await listen();
				} catch {
					return undefined;
				}
			});
		},

		applySettings,
		setEnabled: (enabled) => applySettings({ enabled }),
		setPort: (port) => applySettings({ port }),
		setOpencodeGoEnabled: (opencodeGoEnabled) => applySettings({ opencodeGoEnabled }),
		revealKey() {
			return withLock(async () => {
				if (apiKey.length === 0) apiKey = await loadOrCreateGatewayApiKey(path, yaml.apiKey);
				return { apiKey, keyHint: maskGatewayApiKey(apiKey) };
			});
		},
		rotateKey() {
			return withLock(async () => {
				await hydratePort();
				await hydrateOpencodeGo();
				const next = generateGatewayApiKey();
				const document = await loadGatewayKeyDocument(path);
				await persistState({
					apiKey: next,
					...(document?.enabled === undefined ? {} : { enabled: document.enabled }),
				});
				const shouldRun = server !== undefined;
				await closeServer();
				if (shouldRun) {
					try {
						await listen();
					} catch {
						// rotated key is persisted even if listen fails
					}
				}
				return { apiKey: next, keyHint: maskGatewayApiKey(next) };
			});
		},
		stop() {
			return withLock(() => closeServer());
		},
	};
}

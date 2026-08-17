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
import { createSessionGatewayBackend, type GatewayBackend } from "./gateway-backend.ts";
import { type GatewayConfig, resolveGatewayConfig } from "./gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "./gateway-http.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import type { GrokBuildSession } from "./session.ts";

export const GATEWAY_TOS_WARNING =
	"local API gateway is enabled; exposing a subscription as a local API can violate provider ToS and consumes your quota";

export interface StartGatewayOptions {
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
	keyHint: string;
	warning: string;
}

export interface CodingOAuthGatewayController {
	status(): Promise<GatewayPublicStatus>;
	startIfEnabled(): Promise<StartedGateway | undefined>;
	setEnabled(enabled: boolean): Promise<GatewayPublicStatus>;
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
	let server: Server | undefined;
	let apiKey = yaml.apiKey ?? "";
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

	const listen = async (): Promise<StartedGateway> => {
		if (apiKey.length === 0) apiKey = await loadOrCreateGatewayApiKey(path, yaml.apiKey);
		const http = createGatewayHttpServer({ config: yaml, apiKey, backend: backend() });
		try {
			await listenGateway(http, yaml);
		} catch (error) {
			await closeGateway(http).catch(() => undefined);
			options.onError?.(error);
			throw error;
		}
		server = http;
		return { bind: yaml.bind, port: yaml.port, close: () => closeServer() };
	};

	const desiredEnabled = async (): Promise<boolean> => {
		const document = await loadGatewayKeyDocument(path);
		return document?.enabled ?? yaml.enabled;
	};

	return {
		async status() {
			if (apiKey.length === 0) {
				const document = await loadGatewayKeyDocument(path);
				apiKey = document?.apiKey ?? "";
			}
			return {
				enabled: await desiredEnabled(),
				running: server !== undefined,
				bind: yaml.bind,
				port: yaml.port,
				keyHint: apiKey.length === 0 ? "" : maskGatewayApiKey(apiKey),
				warning: GATEWAY_TOS_WARNING,
			};
		},
		startIfEnabled() {
			return withLock(async () => {
				if (!(await desiredEnabled())) return undefined;
				if (server !== undefined) return { bind: yaml.bind, port: yaml.port, close: () => closeServer() };
				try {
					return await listen();
				} catch {
					return undefined;
				}
			});
		},
		setEnabled(enabled) {
			return withLock(async () => {
				if (apiKey.length === 0) apiKey = await loadOrCreateGatewayApiKey(path, yaml.apiKey);
				await persistGatewayKeyDocument(path, { version: 1, apiKey, enabled });
				if (enabled && server === undefined) {
					try {
						await listen();
					} catch {
						// status.running stays false; caller sees the public snapshot.
					}
				}
				if (!enabled) await closeServer();
				return {
					enabled,
					running: server !== undefined,
					bind: yaml.bind,
					port: yaml.port,
					keyHint: maskGatewayApiKey(apiKey),
					warning: GATEWAY_TOS_WARNING,
				};
			});
		},
		rotateKey() {
			return withLock(async () => {
				const next = generateGatewayApiKey();
				const document = await loadGatewayKeyDocument(path);
				apiKey = next;
				await persistGatewayKeyDocument(path, {
					version: 1,
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

/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and an account section inside dsh Settings.
 * @module dsh-coding-subscription-oauth
 */

import { dirname, join } from "node:path";
import type { Context, Fiber } from "@deepseek-ai/cordis";
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { CredentialInfo, CredentialProvider, CredentialRef } from "@deepseek-ai/dsh-credentials";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { assertUsableApiKey, type RetryPolicyConfig, RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import type { Credential, OAuthCredential } from "@earendil-works/pi-ai";
import { acquireCodingOAuthRuntime, CODING_OAUTH_CORE_ABI, type CodingOAuthRuntime } from "dsh-coding-oauth-core";
import { createCodingOAuthAdapter } from "./adapter.ts";
import { registerCodingOAuthRoutes } from "./auth-routes.ts";
import { registerCapabilityRoutes } from "./capability-routes.ts";
import {
	bindCapabilitySearch,
	bindCapabilityTools,
	bindCodexFastRoute,
	CapabilityRuntimeState,
	type CapabilitySearchRegistry,
	type CapabilityToolRegistry,
} from "./capability-runtime.ts";
import {
	type CapabilitySettingsPatch,
	CapabilitySettingsSchema,
	type CapabilitySettingsService,
	createCapabilitySettingsController,
	resolveCapabilitySettings,
} from "./capability-settings.ts";
import {
	CODEX_IMAGE_EDIT_TOOL,
	CODEX_IMAGE_GENERATE_TOOL,
	createCapabilityTools,
	type ResolveCodexImageRoute,
	resolveCodexImageRouteFromLlm,
} from "./capability-tools.ts";
import { codexAuthFromSession } from "./codex-http.ts";
import { createCodexModelCapabilities } from "./codex-model-capabilities.ts";
import { createCodexSearchProvider } from "./codex-search.ts";
import { createCodexUsageReader } from "./codex-usage.ts";
import { createDshHostAdapter } from "./dsh-host-adapter.ts";
import { createCodingOAuthGatewayController } from "./gateway.ts";
import { type GatewayConfig, GatewayConfigSchema } from "./gateway-config.ts";
import { registerGatewayRoutes } from "./gateway-routes.ts";
import {
	createGrokImagineClient,
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	GrokImagineError,
	type ImagineOperation,
} from "./grok-imagine.ts";
import {
	CLAUDE_PI_PROVIDER,
	CODEX_PI_PROVIDER,
	CODING_OAUTH_ROUTES,
	IMAGINE_MEDIA_STORE_DIRNAME,
	KIMI_PI_PROVIDER,
	XAI_PI_PROVIDER,
} from "./ids.ts";
import { registerImagineRoutes } from "./imagine-routes.ts";
import { MediaStore } from "./media-store.ts";
import {
	type OAuthImportDestinationStore,
	type OAuthImportDestinations,
	registerOAuthImportRoutes,
} from "./oauth-import-routes.ts";
import { OAUTH_PROVIDER_DEFINITIONS } from "./oauth-providers.ts";
import { OAuthProviderSession } from "./oauth-session.ts";
import type { OAuthSourceCredential } from "./oauth-sources.ts";
import { acquireCodingOAuthProxy } from "./proxy.ts";
import { GrokBuildSession } from "./session.ts";
import { GrokBuildCredentialStore, type OAuthCredentialFileStore } from "./store.ts";
import { createOwnerRequestPolicy, safeguardOwnerRequestPolicy } from "./web-origin.ts";

export type {
	CodingOAuthParticipant,
	CodingOAuthRuntime,
	DshHostCapabilities,
	OwnerRequestPolicy as CoreOwnerRequestPolicy,
} from "dsh-coding-oauth-core";
export {
	acquireCodingOAuthRuntime,
	CODING_OAUTH_CORE_ABI,
} from "dsh-coding-oauth-core";
export { createCodingOAuthAdapter, createGrokBuildAdapter, preferredGrokBuildModel } from "./adapter.ts";
export type { AliasLlmRoutePolicy } from "./alias-adapter.ts";
export { AliasLlmAdapter } from "./alias-adapter.ts";
export type { GrokBuildAuthStatus } from "./auth.ts";
export {
	grokBuildAuthStatus,
	importGrokBuildFromGrok,
	importGrokBuildSession,
	loginGrokBuild,
	loginGrokBuildSession,
	logoutGrokBuild,
} from "./auth.ts";
export type {
	CodingOAuthWebStatus,
	GrokBuildLoginMethod,
	GrokBuildWebAuthStatus,
	LoginChallenge,
	SubscriptionLoginChallenge,
	SubscriptionWebAuthStatus,
} from "./auth-routes.ts";
export {
	CODING_OAUTH_LOGIN_CANCEL_PATH,
	CODING_OAUTH_LOGIN_CODE_PATH,
	CODING_OAUTH_LOGIN_PATH,
	CODING_OAUTH_LOGOUT_PATH,
	CODING_OAUTH_MODELS_PATH,
	CODING_OAUTH_STATUS_PATH,
	GROK_BUILD_AUTH_IMPORT_PATH,
	GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
	GROK_BUILD_AUTH_LOGIN_CODE_PATH,
	GROK_BUILD_AUTH_LOGIN_PATH,
	GROK_BUILD_AUTH_LOGOUT_PATH,
	GROK_BUILD_AUTH_MODELS_PATH,
	GROK_BUILD_AUTH_STATUS_PATH,
	GrokBuildWebAuth,
	registerCodingOAuthRoutes,
	registerGrokBuildAuthRoutes,
	SubscriptionWebAuth,
} from "./auth-routes.ts";
export type { CatalogSource, LiveModelDescriptor } from "./catalog.ts";
export {
	extractLiveModels,
	extractModelIds,
	fetchLiveModelIds,
	fetchLiveModels,
	materializeLiveModel,
	mergeLiveCatalog,
	preferredGrokBuildModelFrom,
	thinkingLevelMapFromLiveEfforts,
} from "./catalog.ts";
export { createDshHostAdapter } from "./dsh-host-adapter.ts";
export type { GrokImportProbe } from "./grok-import.ts";
export { grokAuthPath, importGrokAuth, parseGrokAuthDocument, probeGrokAuth } from "./grok-import.ts";
export type { CodingOAuthProviderSlug, CodingOAuthRoute } from "./ids.ts";
export {
	ANTIGRAVITY_ROUTE,
	CLAUDE_CODE_OAUTH_AUTH_FILENAME,
	CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
	CLAUDE_CODE_OAUTH_ROUTE,
	CLAUDE_PI_PROVIDER,
	CODEX_OAUTH_AUTH_FILENAME,
	CODEX_OAUTH_MODELS_CACHE_FILENAME,
	CODEX_OAUTH_ROUTE,
	CODEX_PI_PROVIDER,
	CODING_OAUTH_ROUTES,
	DEFAULT_GROK_BUILD_MODEL,
	GROK_BUILD_AUTH_FILENAME,
	GROK_BUILD_MODELS_CACHE_FILENAME,
	GROK_BUILD_ROUTE,
	GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
	KIMI_CODE_OAUTH_AUTH_FILENAME,
	KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME,
	KIMI_CODE_OAUTH_ROUTE,
	KIMI_PI_PROVIDER,
	XAI_PI_PROVIDER,
} from "./ids.ts";
export type { GrokBuildOAuthErrorCode, GrokBuildOAuthParams, PkceLoginCallbacks } from "./oauth.ts";
export {
	buildAuthorizeUrl,
	discoverOAuthEndpoints,
	extractCode,
	GROK_BUILD_OAUTH_CLIENT_ID,
	GROK_BUILD_OAUTH_DEFAULT_PORT,
	GROK_BUILD_OAUTH_ISSUER,
	GROK_BUILD_OAUTH_SCOPE,
	GrokBuildOAuthError,
	generatePkce,
	loginGrokBuildPkce,
	refreshGrokBuildToken,
	resolveOAuthParams,
} from "./oauth.ts";
export type { OAuthProviderDefinition, SubscriptionLoginMethod, SubscriptionProviderSlug } from "./oauth-providers.ts";
export {
	CLAUDE_CODE_OAUTH_PROVIDER,
	CODEX_OAUTH_PROVIDER,
	KIMI_CODE_OAUTH_PROVIDER,
	OAUTH_PROVIDER_DEFINITIONS,
	oauthProviderDefinition,
} from "./oauth-providers.ts";
export type { OAuthProviderStatus } from "./oauth-session.ts";
export { OAuthProviderSession, oauthModelsCachePath } from "./oauth-session.ts";
export {
	GROK_BUILD_BASE_URL,
	GROK_BUILD_MODELS_URL,
	GROK_CLIENT_VERSION,
	grokBuildBaselineModels,
	grokBuildFingerprintHeaders,
	grokBuildProvider,
	grokBuildReasoningMap,
} from "./provider.ts";
export type { CodingOAuthProxyOptions } from "./proxy.ts";
export {
	codingOAuthProxyInEffect,
	codingOAuthProxyUnreachableHint,
	ensureCodingOAuthProxy,
	ensureGrokBuildProxy,
	grokBuildProxyInEffect,
} from "./proxy.ts";
export { redactProxyUrl, safeMessage } from "./redact.ts";
export { GrokBuildSession } from "./session.ts";
export {
	GrokBuildCredentialStore,
	grokBuildAuthPath,
	OAuthCredentialFileStore,
	oauthCredentialPath,
} from "./store.ts";
export type { OwnerRequestPolicy, OwnerRequestPolicyConfig } from "./web-origin.ts";
export {
	createOwnerRequestPolicy,
	LOOPBACK_OWNER_REQUEST_POLICY,
	OWNER_CSRF_HEADER,
	OWNER_PROOF_HEADER,
} from "./web-origin.ts";

/** Stable Cordis plugin name. */
export const name = "llm-grok-build-oauth";

/** Separate API-key credential used only by official xAI Imagine REST calls. */
export const XAI_API_KEY_CREDENTIAL = "XAI_API_KEY";
/** Validate locally because `credentialRef()` is a value export of the optional credentials peer. */
const XAI_API_KEY_REF = fixedCredentialRef(XAI_API_KEY_CREDENTIAL);

function fixedCredentialRef(value: string): CredentialRef {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
		throw new TypeError(`invalid credential reference ${JSON.stringify(value)}`);
	}
	return value as CredentialRef;
}

/** Owner-private artifact directory below the resolved DSH home. */
export { IMAGINE_MEDIA_STORE_DIRNAME } from "./ids.ts";

/** Optional host services are acquired inside the elected child fiber. */
export const inject = [] as const;

/** Plugin configuration; every field is optional. */
export interface Config {
	/** HTTP(S) proxy URL for the audited coding-subscription host allowlist. */
	proxy?: string;
	/** Kimi China traffic stays direct unless explicitly opted into the proxy. */
	proxyKimi?: boolean;
	/**
	 * Optional provider retry policy override for the four OAuth routes. When
	 * omitted, the plugin retries transient failures (rate limit, server,
	 * timeout, transport, empty response) plus AUTH — the latter is safe because
	 * the stored credential is invalidated on every AUTH finish, so the retried
	 * step refreshes before reuse. Quota exhaustion is never retried.
	 */
	retryPolicy?: RetryPolicyConfig;
	/** Secret-free composition/YAML defaults below live user settings. */
	capabilities?: CapabilitySettingsPatch;
	/** Opt-in isolated local OpenAI-compatible gateway. Default off. */
	gateway?: Partial<GatewayConfig>;
	/** Owner-only request authorization for loopback, SSH tunnels, and trusted HTTPS proxies. */
	ownerRequest?: {
		loopbackAccessMode?: "loopback" | "ssh-tunnel";
		trustedProxy?: {
			peers?: string[];
			origins?: string[];
			ownerProof?: string;
			csrfToken?: string;
		};
	};
}

export const Config: z<Config> = z.object({
	proxy: z.string(),
	proxyKimi: z.boolean().default(false),
	retryPolicy: RetryPolicySchema,
	capabilities: CapabilitySettingsSchema,
	gateway: GatewayConfigSchema,
	ownerRequest: z.object({
		loopbackAccessMode: z.union([z.const("loopback"), z.const("ssh-tunnel")]),
		trustedProxy: z.object({
			peers: z.array(z.string()),
			origins: z.array(z.string()),
			ownerProof: z.string(),
			csrfToken: z.string(),
		}),
	}),
});

const CODEX_TOOL_NAMES = new Set<string>([CODEX_IMAGE_GENERATE_TOOL, CODEX_IMAGE_EDIT_TOOL]);
const IMAGINE_TOOL_NAMES = new Set<string>([
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
]);

function requireSubscription(
	subscriptions: readonly OAuthProviderSession[],
	nativeProviderId: string,
): OAuthProviderSession {
	const session = subscriptions.find((candidate) => candidate.definition.nativeProviderId === nativeProviderId);
	if (session === undefined) throw new Error(`missing built-in OAuth provider ${nativeProviderId}`);
	return session;
}

function asSourceCredential(credential: Credential | undefined): OAuthSourceCredential | undefined {
	if (credential === undefined) return undefined;
	if (credential.type !== "oauth") throw new Error("OAuth import destination contains a non-OAuth credential");
	const accountId =
		typeof credential.accountId === "string" && credential.accountId.length > 0 ? credential.accountId : undefined;
	return {
		type: "oauth",
		access: credential.access,
		refresh: credential.refresh,
		expires: credential.expires,
		...(accountId === undefined ? {} : { accountId }),
	};
}

function asStoredCredential(credential: OAuthSourceCredential): OAuthCredential {
	return {
		type: "oauth",
		access: credential.access,
		refresh: credential.refresh,
		expires: credential.expires,
		...(credential.accountId === undefined ? {} : { accountId: credential.accountId }),
	};
}

function oauthImportStore(store: OAuthCredentialFileStore): OAuthImportDestinationStore {
	return {
		filename: store.filename,
		async modify(providerId, fn) {
			const result = await store.modify(providerId, async (current) => {
				const next = await fn(asSourceCredential(current));
				return next === undefined ? current : asStoredCredential(next);
			});
			return asSourceCredential(result);
		},
	};
}

function oauthImportDestinations(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
): OAuthImportDestinations {
	const codex = requireSubscription(subscriptions, CODEX_PI_PROVIDER);
	const kimi = requireSubscription(subscriptions, KIMI_PI_PROVIDER);
	const claude = requireSubscription(subscriptions, CLAUDE_PI_PROVIDER);
	return {
		grok: { providerId: XAI_PI_PROVIDER, store: oauthImportStore(grok.store) },
		codex: { providerId: codex.definition.nativeProviderId, store: oauthImportStore(codex.store) },
		kimi: { providerId: kimi.definition.nativeProviderId, store: oauthImportStore(kimi.store) },
		claude: { providerId: claude.definition.nativeProviderId, store: oauthImportStore(claude.store) },
	};
}

async function describeImagineCredential(credentials: CredentialProvider | undefined): Promise<CredentialInfo> {
	if (credentials === undefined) return { configured: false, writable: false };
	return credentials.describe(XAI_API_KEY_REF);
}

async function resolveImagineApiKey(credentials: CredentialProvider, operation: ImagineOperation): Promise<string> {
	const resolved = await credentials.resolve(XAI_API_KEY_REF);
	if (resolved === undefined) {
		throw new GrokImagineError(
			"MISSING_CREDENTIAL",
			`${XAI_API_KEY_CREDENTIAL} is not configured for ${operation}. Grok Imagine does not use OAuth.`,
		);
	}
	return assertUsableApiKey(resolved.value, "dsh-coding-subscription-oauth", XAI_API_KEY_CREDENTIAL);
}

function unavailableImagineClient(): {
	generateImage(): Promise<never>;
	startVideo(): Promise<never>;
	videoStatus(): Promise<never>;
} {
	const unavailable = async (): Promise<never> => {
		throw new GrokImagineError("MISSING_CREDENTIAL", "Grok Imagine services are not composed");
	};
	return { generateImage: unavailable, startVideo: unavailable, videoStatus: unavailable };
}

/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
export function apply(ctx: Context, config: Config = {}): void {
	const host = createDshHostAdapter(ctx);
	const lease: CodingOAuthRuntime = acquireCodingOAuthRuntime(host.scope(), {
		id: "dsh-coding-subscription-oauth",
		role: "standalone",
		coreAbi: CODING_OAUTH_CORE_ABI,
		async activate() {
			let fiber: Fiber | undefined;
			let ownerMounted = false;
			fiber = ctx.inject([], async (injected) => {
				await applyOwned(injected, config);
				ownerMounted = true;
				return () => {
					ownerMounted = false;
				};
			});
			try {
				await fiber.await();
				if (!ownerMounted) throw new Error("standalone Coding OAuth owner fiber did not activate");
			} catch (error) {
				try {
					await fiber.dispose();
				} catch {
					// Preserve the startup error; Cordis already logs cleanup failures.
				}
				throw error;
			}
			return {
				async dispose() {
					await fiber?.dispose();
				},
			};
		},
	});
	ctx.effect(() => () => lease.release(), "dsh-coding-subscription-oauth: release shared runtime ownership");
}

/**
 * Owner runtime that survives optional LLM service churn. OAuth sessions and
 * same-origin Web routes are deliberately owned here, rather than by the LLM
 * child fiber, so a transient LLM unload cannot make account recovery vanish.
 */
async function applyOwned(ctx: Context, config: Config): Promise<void> {
	const host = createDshHostAdapter(ctx);
	const ownerRequestPolicy = safeguardOwnerRequestPolicy(
		host.ownerRequestPolicy() ?? createOwnerRequestPolicy(config.ownerRequest),
	);
	const proxyLease = acquireCodingOAuthProxy(
		config.proxy,
		config.proxyKimi === undefined ? {} : { proxyKimi: config.proxyKimi },
	);
	ctx.effect(() => () => proxyLease.release(), "dsh-coding-subscription-oauth: scoped proxy policy");
	const logger = ctx.logger(name);
	const baseCapabilities = resolveCapabilitySettings(config.capabilities);
	const runtime = new CapabilityRuntimeState(baseCapabilities, () => {
		logger.warn("an optional capability listener failed");
	});
	let active = true;
	ctx.effect(
		() => () => {
			active = false;
		},
		"dsh-coding-subscription-oauth: startup lifetime",
	);
	let invalidateOptionalAuthState = (): void => undefined;
	const notifyCatalogChange = (): void => {
		if (!active) return;
		try {
			ctx.emit("llm/adapters-updated");
		} catch (error) {
			// Catalog observers are advisory; a broken listener must not turn an
			// already-persisted OAuth login/logout into an apparent auth failure.
			logger.warn("an llm/adapters-updated listener failed");
			logger.warn(error);
		}
	};
	const grok = new GrokBuildSession(new GrokBuildCredentialStore(), notifyCatalogChange);
	const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
		(definition) =>
			new OAuthProviderSession(definition, () => {
				if (definition.nativeProviderId === CODEX_PI_PROVIDER) invalidateOptionalAuthState();
				notifyCatalogChange();
			}),
	);
	const codex = requireSubscription(subscriptions, CODEX_PI_PROVIDER);
	const codexAuth = codexAuthFromSession(codex);
	const usage = createCodexUsageReader({ auth: codexAuth });
	const codexModels = createCodexModelCapabilities({ auth: codexAuth });
	invalidateOptionalAuthState = () => {
		usage.clear();
		codexModels.clear();
		runtime.refresh();
	};

	void Promise.allSettled([grok.loadCachedCatalog(), ...subscriptions.map((session) => session.loadCachedModels())])
		.then(async (results) => {
			if (!active) return;
			if (results.some((result) => result.status === "rejected")) {
				logger.warn("one or more OAuth model caches could not be loaded; using in-memory fallbacks");
			}
			await grok.refreshLiveCatalog();
		})
		.catch(() => {
			// Contain every startup refresh failure so plugin activation cannot leave
			// an unhandled rejection. The static provider catalogs remain usable.
			if (active) logger.warn("background OAuth model catalog initialization failed; using static fallbacks");
		});

	let settingsOwner = 0;
	const createFallbackCapabilityController = (): ReturnType<typeof createCapabilitySettingsController> =>
		createCapabilitySettingsController({
			...(config.capabilities === undefined ? {} : { base: config.capabilities }),
			onListenerError: () => logger.warn("a capability settings listener failed"),
		});
	let capabilityController = createFallbackCapabilityController();
	const capabilityRoutesController = {
		snapshot: () => capabilityController.snapshot(),
		current: () => capabilityController.current(),
		patch: (patch: CapabilitySettingsPatch, expectedRevision: number) =>
			capabilityController.patch(patch, expectedRevision),
		replace: (section: CapabilitySettingsPatch, expectedRevision: number) =>
			capabilityController.replace(section, expectedRevision),
	};
	let releaseActiveSettings = (): void => undefined;
	ctx.effect(
		() => () => {
			releaseActiveSettings();
			capabilityController.dispose();
		},
		"dsh-coding-subscription-oauth: capability settings bridge",
	);
	ctx.inject(["settings"], (settingsCtx) => {
		// Re-injection may happen before Cordis runs the previous child effect's
		// disposer. Release it synchronously so an obsolete watcher cannot race a
		// newly attached settings service.
		releaseActiveSettings();
		const owner = ++settingsOwner;
		const previousController = capabilityController;
		const controller = createCapabilitySettingsController({
			settings: settingsCtx.get("settings") as CapabilitySettingsService,
			...(config.capabilities === undefined ? {} : { base: config.capabilities }),
			onListenerError: () => logger.warn("a capability settings listener failed"),
		});
		capabilityController = controller;
		previousController.dispose();
		runtime.set(controller.current());
		const unsubscribe = controller.subscribe((snapshot) => {
			runtime.set(snapshot.value);
		});
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;
			unsubscribe();
			controller.dispose();
			if (owner === settingsOwner) {
				releaseActiveSettings = (): void => undefined;
				capabilityController = createFallbackCapabilityController();
				runtime.set(capabilityController.current());
			}
		};
		releaseActiveSettings = release;
		settingsCtx.effect(() => release, "dsh-coding-subscription-oauth: capability settings");
	});

	const gateway = createCodingOAuthGatewayController({
		...(config.gateway === undefined ? {} : { config: config.gateway }),
		grok,
		subscriptions,
		onError: (error) => {
			logger.warn("local API gateway failed to start; LLM routes are unchanged");
			logger.warn(error);
		},
	});
	ctx.effect(() => {
		void gateway.startIfEnabled().then((started) => {
			if (started !== undefined) {
				logger.warn("local API gateway is enabled; exposing a subscription as a local API can violate provider ToS");
			}
		});
		return () => gateway.stop();
	}, "dsh-coding-subscription-oauth: local API gateway");

	let webRoutesMounted = false;
	const webRoutesFiber = ctx.inject(["webServer"], (webCtx) => {
		registerCapabilityRoutes(webCtx, {
			controller: capabilityRoutesController,
			usage: () => usage.read(),
			credentialInfo: () => describeImagineCredential(webCtx.get("credentials") as CredentialProvider | undefined),
			ownerRequestPolicy,
		});
		registerGatewayRoutes(webCtx, gateway, ownerRequestPolicy);
		registerCodingOAuthRoutes(webCtx, grok, subscriptions, ownerRequestPolicy, (accessMode) =>
			host.compatibility({
				accessMode,
				uiOwner: "standalone",
				diagnostics: ownerRequestPolicy.diagnostics(),
			}),
		);
		registerOAuthImportRoutes(webCtx, oauthImportDestinations(grok, subscriptions), {
			ownerRequestPolicy,
			onImported: (event) => {
				if (event.kind === "codex") invalidateOptionalAuthState();
				notifyCatalogChange();
			},
		});
		webRoutesMounted = true;
		webCtx.effect(
			() => () => {
				webRoutesMounted = false;
			},
			"dsh-coding-subscription-oauth: required web route readiness",
		);
	});

	const search = createCodexSearchProvider({
		auth: codexAuth,
		// Login, import, model selection, and catalog refreshes can all change the
		// first visible Codex model after plugin startup.
		model: () => codex.visibleModels()[0]?.id ?? "",
	});
	ctx.inject(["web"], (webCtx) => {
		const web = webCtx.get("web") as CapabilitySearchRegistry;
		webCtx.effect(() => bindCapabilitySearch(runtime, web, search), "dsh-coding-subscription-oauth: Codex search");
	});

	ctx.inject(["tools", "attachments", "credentials", "webServer"], async (toolCtx) => {
		const tools = toolCtx.get("tools") as CapabilityToolRegistry;
		const attachments = toolCtx.get("attachments") as AttachmentStore;
		const credentials = toolCtx.get("credentials") as CredentialProvider;
		const media = new MediaStore(join(dirname(grok.store.filename), IMAGINE_MEDIA_STORE_DIRNAME), {
			retentionMs: runtime.current().videoArtifactTtlMs,
		});
		const routeRegistry = registerImagineRoutes(toolCtx, {
			attachments,
			media: { readForDownload: (artifactId, authz) => media.openDownload(artifactId, authz) },
			ownerRequestPolicy,
		});
		const imagine = createGrokImagineClient({
			resolveApiKey: (operation) => resolveImagineApiKey(credentials, operation),
			attachments,
			media,
		});
		const routedImagine = {
			async generateImage(input: Parameters<typeof imagine.generateImage>[0], signal?: AbortSignal) {
				const result = await imagine.generateImage(input, signal);
				if (runtime.current().grokImagineImage) {
					routeRegistry.rememberImages(result.images.map((image) => image.attachment));
				}
				return result;
			},
			startVideo: (input: Parameters<typeof imagine.startVideo>[0], signal?: AbortSignal) =>
				imagine.startVideo(input, signal),
			async videoStatus(requestId: string, options?: Parameters<typeof imagine.videoStatus>[1]) {
				const result = await imagine.videoStatus(requestId, options);
				if (result.artifact !== undefined && runtime.current().grokImagineVideo) {
					routeRegistry.rememberArtifact(result.artifact);
				}
				return result;
			},
		};
		const definitions = (
			await createCapabilityTools({
				current: () => runtime.current(),
				auth: codexAuth,
				attachments,
				imagine: routedImagine,
			})
		).filter((definition) => IMAGINE_TOOL_NAMES.has(definition.name));
		let previousSettings = runtime.current();
		const releaseRetention = runtime.subscribe((settings) => {
			const previous = previousSettings;
			previousSettings = settings;
			if (previous.grokImagineImage && !settings.grokImagineImage) routeRegistry.revokeImages();
			if (previous.grokImagineVideo && !settings.grokImagineVideo) routeRegistry.revokeArtifacts();
			return media
				.applyRetentionMs(settings.videoArtifactTtlMs)
				.then(() => undefined)
				.catch(() => logger.warn("Imagine media retention cleanup failed"));
		});
		toolCtx.effect(
			() => bindCapabilityTools(runtime, tools, definitions),
			"dsh-coding-subscription-oauth: Grok Imagine tools",
		);
		toolCtx.effect(
			() => async () => {
				// Abort new/in-flight work before cleanup regardless of Cordis disposer
				// ordering. GrokImagineClient.dispose() is intentionally idempotent.
				imagine.dispose();
				releaseRetention();
				try {
					await media.cleanup();
				} catch {
					logger.warn("Imagine media cleanup failed");
				}
			},
			"dsh-coding-subscription-oauth: Imagine client and media lifetime",
		);
	});

	// Only adapters and LLM-backed model resolution depend on this service. Its
	// child fiber may unload and reload without disturbing OAuth/Web ownership.
	ctx.inject(["llm"], (llmCtx) =>
		applyOwnedLlm(llmCtx, config, { grok, subscriptions, runtime, codexAuth, codexModels, logger }),
	);

	await webRoutesFiber.await();
	if (!webRoutesMounted) throw new Error("required DSH webServer routes did not activate");
}

interface OwnedLlmDependencies {
	readonly grok: GrokBuildSession;
	readonly subscriptions: readonly OAuthProviderSession[];
	readonly runtime: CapabilityRuntimeState;
	readonly codexAuth: ReturnType<typeof codexAuthFromSession>;
	readonly codexModels: ReturnType<typeof createCodexModelCapabilities>;
	readonly logger: ReturnType<Context["logger"]>;
}

/** LLM-only child runtime, independently restarted by Cordis when LLM changes. */
function applyOwnedLlm(ctx: Context, config: Config, owner: OwnedLlmDependencies): void {
	createDshHostAdapter(ctx).assertCompatible();
	const resolveCodexImageRoute: ResolveCodexImageRoute = (exec) =>
		resolveCodexImageRouteFromLlm(exec, (provider, model, signal) => ctx.llm.resolveModelInfo(provider, model, signal));
	const adapterRegistration = ctx.llm.registerAdapter(
		[...CODING_OAUTH_ROUTES],
		createCodingOAuthAdapter(owner.grok, owner.subscriptions, () => ctx.get("attachments"), config.retryPolicy, {
			codexFast: {
				isEligible: (modelId) => owner.runtime.current().codexFast && owner.codexModels.isPriorityEligible(modelId),
			},
		}),
	);
	ctx.effect(() => adapterRegistration, "dsh-coding-subscription-oauth: OAuth LLM adapters");
	ctx.effect(
		() =>
			bindCodexFastRoute(owner.runtime, owner.codexModels, adapterRegistration, {
				onError: () => owner.logger.warn("Codex Fast eligibility refresh failed closed"),
			}),
		"dsh-coding-subscription-oauth: Codex Fast route",
	);
	ctx.inject(["tools", "attachments"], async (toolCtx) => {
		const tools = toolCtx.get("tools") as CapabilityToolRegistry;
		const attachments = toolCtx.get("attachments") as AttachmentStore;
		const definitions = (
			await createCapabilityTools({
				current: () => owner.runtime.current(),
				auth: owner.codexAuth,
				attachments,
				imagine: unavailableImagineClient(),
				resolveCodexImageRoute,
			})
		).filter((definition) => CODEX_TOOL_NAMES.has(definition.name));
		toolCtx.effect(
			() => bindCapabilityTools(owner.runtime, tools, definitions),
			"dsh-coding-subscription-oauth: Codex image tools",
		);
	});
}

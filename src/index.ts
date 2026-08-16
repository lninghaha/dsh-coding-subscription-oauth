/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and an account section inside dsh Settings.
 * @module dsh-coding-subscription-oauth
 */

import { dirname, join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { CredentialInfo, CredentialProvider, CredentialRef } from "@deepseek-ai/dsh-credentials";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { assertUsableApiKey, type RetryPolicyConfig, RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import type { Credential, OAuthCredential } from "@earendil-works/pi-ai";
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
import { ensureCodingOAuthProxy } from "./proxy.ts";
import { GrokBuildSession } from "./session.ts";
import { GrokBuildCredentialStore, type OAuthCredentialFileStore } from "./store.ts";

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
	ensureCodingOAuthProxy,
	ensureGrokBuildProxy,
	grokBuildProxyInEffect,
} from "./proxy.ts";
export { safeMessage } from "./redact.ts";
export { GrokBuildSession } from "./session.ts";
export {
	GrokBuildCredentialStore,
	grokBuildAuthPath,
	OAuthCredentialFileStore,
	oauthCredentialPath,
} from "./store.ts";

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
export const IMAGINE_MEDIA_STORE_DIRNAME = ".dsh-coding-subscription-oauth-media";

/** LLM registry required before the subscription route can register. */
export const inject = ["llm"];

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
}

export const Config: z<Config> = z.object({
	proxy: z.string(),
	proxyKimi: z.boolean().default(false),
	retryPolicy: RetryPolicySchema,
	capabilities: CapabilitySettingsSchema,
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
export function apply(ctx: Context, config: Config): void {
	ensureCodingOAuthProxy(config.proxy, config.proxyKimi === undefined ? {} : { proxyKimi: config.proxyKimi });
	const logger = ctx.logger(name);
	const runtime = new CapabilityRuntimeState(undefined, () => {
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
	const resolveCodexImageRoute: ResolveCodexImageRoute = (exec) =>
		resolveCodexImageRouteFromLlm(exec, (provider, model, signal) => ctx.llm.resolveModelInfo(provider, model, signal));
	invalidateOptionalAuthState = () => {
		usage.clear();
		codexModels.clear();
		runtime.refresh();
	};
	const adapterRegistration = ctx.llm.registerAdapter(
		[...CODING_OAUTH_ROUTES],
		createCodingOAuthAdapter(grok, subscriptions, () => ctx.get("attachments"), config.retryPolicy, {
			codexFast: {
				isEligible: (modelId) => runtime.current().codexFast && codexModels.isPriorityEligible(modelId),
			},
		}),
	);
	ctx.effect(
		() =>
			bindCodexFastRoute(runtime, codexModels, adapterRegistration, {
				onError: () => logger.warn("Codex Fast eligibility refresh failed closed"),
			}),
		"dsh-coding-subscription-oauth: Codex Fast route",
	);

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
	ctx.inject(["settings"], (settingsCtx) => {
		const owner = ++settingsOwner;
		const controller = createCapabilitySettingsController({
			settings: settingsCtx.get("settings") as CapabilitySettingsService,
			...(config.capabilities === undefined ? {} : { base: config.capabilities }),
		});
		runtime.set(controller.current());
		const unsubscribe = controller.subscribe((snapshot) => runtime.set(snapshot.value));
		settingsCtx.effect(
			() => () => {
				unsubscribe();
				controller.dispose();
				if (owner === settingsOwner) runtime.reset();
			},
			"dsh-coding-subscription-oauth: capability settings",
		);
		settingsCtx.inject(["webServer"], (webCtx) => {
			registerCapabilityRoutes(webCtx, {
				controller,
				usage: () => usage.read(),
				credentialInfo: () => describeImagineCredential(webCtx.get("credentials") as CredentialProvider | undefined),
			});
		});
	});

	ctx.inject(["webServer"], (webCtx) => {
		registerCodingOAuthRoutes(webCtx, grok, subscriptions);
		registerOAuthImportRoutes(webCtx, oauthImportDestinations(grok, subscriptions), {
			onImported: (event) => {
				if (event.kind === "codex") invalidateOptionalAuthState();
				notifyCatalogChange();
			},
		});
	});

	const search = createCodexSearchProvider({
		auth: codexAuth,
		model: codex.visibleModels()[0]?.id ?? "",
	});
	ctx.inject(["web"], (webCtx) => {
		const web = webCtx.get("web") as CapabilitySearchRegistry;
		webCtx.effect(() => bindCapabilitySearch(runtime, web, search), "dsh-coding-subscription-oauth: Codex search");
	});

	ctx.inject(["tools", "attachments"], async (toolCtx) => {
		const tools = toolCtx.get("tools") as CapabilityToolRegistry;
		const attachments = toolCtx.get("attachments") as AttachmentStore;
		const definitions = (
			await createCapabilityTools({
				current: () => runtime.current(),
				auth: codexAuth,
				attachments,
				imagine: unavailableImagineClient(),
				resolveCodexImageRoute,
			})
		).filter((definition) => CODEX_TOOL_NAMES.has(definition.name));
		toolCtx.effect(
			() => bindCapabilityTools(runtime, tools, definitions),
			"dsh-coding-subscription-oauth: Codex image tools",
		);
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
		});
		const imagine = createGrokImagineClient({
			resolveApiKey: (operation) => resolveImagineApiKey(credentials, operation),
			attachments,
			media,
		});
		const routedImagine = {
			async generateImage(input: Parameters<typeof imagine.generateImage>[0]) {
				const result = await imagine.generateImage(input);
				if (runtime.current().grokImagineImage) {
					routeRegistry.rememberImages(result.images.map((image) => image.attachment));
				}
				return result;
			},
			startVideo: (input: Parameters<typeof imagine.startVideo>[0]) => imagine.startVideo(input),
			async videoStatus(requestId: string) {
				const result = await imagine.videoStatus(requestId);
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
				resolveCodexImageRoute,
			})
		).filter((definition) => IMAGINE_TOOL_NAMES.has(definition.name));
		let previousSettings = runtime.current();
		const releaseRetention = runtime.subscribe((settings) => {
			media.setRetentionMs(settings.videoArtifactTtlMs);
			if (previousSettings.grokImagineImage && !settings.grokImagineImage) routeRegistry.revokeImages();
			if (previousSettings.grokImagineVideo && !settings.grokImagineVideo) routeRegistry.revokeArtifacts();
			previousSettings = settings;
		});
		toolCtx.effect(
			() => bindCapabilityTools(runtime, tools, definitions),
			"dsh-coding-subscription-oauth: Grok Imagine tools",
		);
		toolCtx.effect(
			() => () => {
				releaseRetention();
				void media.cleanup().catch(() => logger.warn("Imagine media cleanup failed"));
			},
			"dsh-coding-subscription-oauth: Imagine media cleanup",
		);
		void media.cleanup().catch(() => logger.warn("Imagine media startup cleanup failed"));
	});
}

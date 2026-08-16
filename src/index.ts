/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and an account section inside dsh Settings.
 * @module dsh-coding-subscription-oauth
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-attachment";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { RetryPolicyConfig } from "@deepseek-ai/dsh-llm";
import { RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { createCodingOAuthAdapter } from "./adapter.ts";
import { registerCodingOAuthRoutes } from "./auth-routes.ts";
import { CODING_OAUTH_ROUTES } from "./ids.ts";
import { OAUTH_PROVIDER_DEFINITIONS } from "./oauth-providers.ts";
import { OAuthProviderSession } from "./oauth-session.ts";
import { ensureCodingOAuthProxy } from "./proxy.ts";
import { GrokBuildSession } from "./session.ts";
import { GrokBuildCredentialStore } from "./store.ts";

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
}

export const Config: z<Config> = z.object({
	proxy: z.string(),
	proxyKimi: z.boolean().default(false),
	retryPolicy: RetryPolicySchema,
});

/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
export function apply(ctx: Context, config: Config): void {
	ensureCodingOAuthProxy(config.proxy, config.proxyKimi === undefined ? {} : { proxyKimi: config.proxyKimi });
	const logger = ctx.logger(name);
	const notifyCatalogChange = (): void => {
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
		(definition) => new OAuthProviderSession(definition, notifyCatalogChange),
	);
	void Promise.allSettled([grok.loadCachedCatalog(), ...subscriptions.map((session) => session.loadCachedModels())])
		.then(async (results) => {
			if (results.some((result) => result.status === "rejected")) {
				logger.warn("one or more OAuth model caches could not be loaded; using in-memory fallbacks");
			}
			await grok.refreshLiveCatalog();
		})
		.catch(() => {
			// Contain every startup refresh failure so plugin activation cannot leave
			// an unhandled rejection. The static provider catalogs remain usable.
			logger.warn("background OAuth model catalog initialization failed; using static fallbacks");
		});
	ctx.llm.registerAdapter(
		[...CODING_OAUTH_ROUTES],
		createCodingOAuthAdapter(grok, subscriptions, () => ctx.get("attachments"), config.retryPolicy),
	);
	ctx.inject(["webServer"], (webCtx) => registerCodingOAuthRoutes(webCtx, grok, subscriptions));
}

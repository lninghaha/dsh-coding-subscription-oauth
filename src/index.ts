/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and an account section inside dsh Settings.
 * @module dsh-grok-build
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { createCodingOAuthAdapter } from './adapter.ts'
import { registerCodingOAuthRoutes } from './auth-routes.ts'
import { CODING_OAUTH_ROUTES } from './ids.ts'
import { OAUTH_PROVIDER_DEFINITIONS } from './oauth-providers.ts'
import { OAuthProviderSession } from './oauth-session.ts'
import { ensureCodingOAuthProxy } from './proxy.ts'
import { GrokBuildSession } from './session.ts'
import { GrokBuildCredentialStore } from './store.ts'

export { createCodingOAuthAdapter, createGrokBuildAdapter, preferredGrokBuildModel } from './adapter.ts'
export { AliasLlmAdapter } from './alias-adapter.ts'
export type { AliasLlmRoutePolicy } from './alias-adapter.ts'
export {
  grokBuildAuthStatus,
  importGrokBuildFromGrok,
  importGrokBuildSession,
  loginGrokBuild,
  loginGrokBuildSession,
  logoutGrokBuild,
} from './auth.ts'
export type { GrokBuildAuthStatus } from './auth.ts'
export {
  SubscriptionWebAuth,
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_MODELS_PATH,
  CODING_OAUTH_STATUS_PATH,
  GrokBuildWebAuth,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_MODELS_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
  registerCodingOAuthRoutes,
  registerGrokBuildAuthRoutes,
} from './auth-routes.ts'
export type {
  CodingOAuthWebStatus,
  GrokBuildLoginMethod,
  GrokBuildWebAuthStatus,
  LoginChallenge,
  SubscriptionLoginChallenge,
  SubscriptionWebAuthStatus,
} from './auth-routes.ts'
export {
  extractModelIds,
  fetchLiveModelIds,
  materializeLiveModel,
  mergeLiveCatalog,
  preferredGrokBuildModelFrom,
} from './catalog.ts'
export type { CatalogSource } from './catalog.ts'
export { grokAuthPath, importGrokAuth, parseGrokAuthDocument, probeGrokAuth } from './grok-import.ts'
export type { GrokImportProbe } from './grok-import.ts'
export {
  ANTIGRAVITY_ROUTE,
  CLAUDE_CODE_OAUTH_AUTH_FILENAME,
  CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODING_OAUTH_ROUTES,
  CODEX_OAUTH_AUTH_FILENAME,
  CODEX_OAUTH_MODELS_CACHE_FILENAME,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
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
} from './ids.ts'
export type { CodingOAuthProviderSlug, CodingOAuthRoute } from './ids.ts'
export {
  GROK_BUILD_BASE_URL,
  GROK_BUILD_MODELS_URL,
  GROK_CLIENT_VERSION,
  grokBuildBaselineModels,
  grokBuildFingerprintHeaders,
  grokBuildProvider,
} from './provider.ts'
export {
  buildAuthorizeUrl,
  discoverOAuthEndpoints,
  extractCode,
  generatePkce,
  GrokBuildOAuthError,
  GROK_BUILD_OAUTH_CLIENT_ID,
  GROK_BUILD_OAUTH_DEFAULT_PORT,
  GROK_BUILD_OAUTH_ISSUER,
  GROK_BUILD_OAUTH_SCOPE,
  loginGrokBuildPkce,
  refreshGrokBuildToken,
  resolveOAuthParams,
} from './oauth.ts'
export type { GrokBuildOAuthErrorCode, GrokBuildOAuthParams, PkceLoginCallbacks } from './oauth.ts'
export {
  CLAUDE_CODE_OAUTH_PROVIDER,
  CODEX_OAUTH_PROVIDER,
  KIMI_CODE_OAUTH_PROVIDER,
  OAUTH_PROVIDER_DEFINITIONS,
  oauthProviderDefinition,
} from './oauth-providers.ts'
export type { OAuthProviderDefinition, SubscriptionLoginMethod, SubscriptionProviderSlug } from './oauth-providers.ts'
export { OAuthProviderSession, oauthModelsCachePath } from './oauth-session.ts'
export type { OAuthProviderStatus } from './oauth-session.ts'
export {
  codingOAuthProxyInEffect,
  ensureCodingOAuthProxy,
  ensureGrokBuildProxy,
  grokBuildProxyInEffect,
} from './proxy.ts'
export type { CodingOAuthProxyOptions } from './proxy.ts'
export { safeMessage } from './redact.ts'
export { GrokBuildSession } from './session.ts'
export {
  GrokBuildCredentialStore,
  OAuthCredentialFileStore,
  grokBuildAuthPath,
  oauthCredentialPath,
} from './store.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-grok-build-oauth'

/** LLM registry required before the subscription route can register. */
export const inject = ['llm']

/** Plugin configuration; every field is optional. */
export interface Config {
  /** HTTP(S) proxy URL for the audited coding-subscription host allowlist. */
  proxy?: string
  /** Kimi China traffic stays direct unless explicitly opted into the proxy. */
  proxyKimi?: boolean
}

export const Config: z<Config> = z.object({
  proxy: z.string(),
  proxyKimi: z.boolean().default(false),
})

/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
export function apply(ctx: Context, config: Config): void {
  ensureCodingOAuthProxy(config.proxy, { proxyKimi: config.proxyKimi })
  const logger = ctx.logger(name)
  const notifyCatalogChange = (): void => {
    try {
      ctx.emit('llm/adapters-updated')
    } catch (error) {
      // Catalog observers are advisory; a broken listener must not turn an
      // already-persisted OAuth login/logout into an apparent auth failure.
      logger.warn('an llm/adapters-updated listener failed')
      logger.warn(error)
    }
  }
  const grok = new GrokBuildSession(new GrokBuildCredentialStore(), notifyCatalogChange)
  const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(
    definition,
    notifyCatalogChange,
  ))
  void Promise.all([
    grok.loadCachedCatalog(),
    ...subscriptions.map(session => session.loadCachedModels()),
  ]).then(() => grok.refreshLiveCatalog())
  ctx.llm.registerAdapter(
    [...CODING_OAUTH_ROUTES],
    createCodingOAuthAdapter(grok, subscriptions, () => ctx.get('attachments')),
  )
  ctx.inject(['webServer'], webCtx => registerCodingOAuthRoutes(webCtx, grok, subscriptions))
}

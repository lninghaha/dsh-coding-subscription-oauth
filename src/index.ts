/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and (from M3) an account section inside dsh Settings.
 * @module dsh-grok-build
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { createGrokBuildAdapter } from './adapter.ts'
import { GROK_BUILD_ROUTE } from './ids.ts'
import { ensureGrokBuildProxy } from './proxy.ts'
import { GrokBuildSession } from './session.ts'
import { GrokBuildCredentialStore } from './store.ts'

export { createGrokBuildAdapter, preferredGrokBuildModel } from './adapter.ts'
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
  DEFAULT_GROK_BUILD_MODEL,
  GROK_BUILD_AUTH_FILENAME,
  GROK_BUILD_MODELS_CACHE_FILENAME,
  GROK_BUILD_ROUTE,
  GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
  XAI_PI_PROVIDER,
} from './ids.ts'
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
export { ensureGrokBuildProxy, grokBuildProxyInEffect } from './proxy.ts'
export { safeMessage } from './redact.ts'
export { GrokBuildSession } from './session.ts'
export { GrokBuildCredentialStore, grokBuildAuthPath } from './store.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-grok-build-oauth'

/** LLM registry required before the subscription route can register. */
export const inject = ['llm']

/** Plugin configuration; every field is optional. */
export interface Config {
  /**
   * HTTP(S) proxy URL for Grok Build traffic (auth.x.ai +
   * cli-chat-proxy.grok.com only — every other request stays direct).
   * Falls back to GROK_BUILD_PROXY / HTTPS_PROXY env vars.
   */
  proxy?: string
}

export const Config: z<Config> = z.object({
  proxy: z.string(),
})

/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
export function apply(ctx: Context, config: Config): void {
  ensureGrokBuildProxy(config.proxy)
  const session = new GrokBuildSession(new GrokBuildCredentialStore(), () => {
    ctx.emit('llm/adapters-updated')
  })
  void session.loadCachedCatalog().then(() => session.refreshLiveCatalog())
  ctx.llm.registerAdapter(
    [GROK_BUILD_ROUTE],
    createGrokBuildAdapter(session, () => ctx.get('attachments')),
  )
}

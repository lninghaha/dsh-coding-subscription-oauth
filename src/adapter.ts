/** Coding-subscription adapter assembled from public dsh-llm-pi-ai extension points. */

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { AliasLlmAdapter } from './alias-adapter.ts'
import type { AliasLlmRoutePolicy } from './alias-adapter.ts'
import { preferredGrokBuildModelFrom } from './catalog.ts'
import {
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  DEFAULT_GROK_BUILD_MODEL,
  GROK_BUILD_ROUTE,
  GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
  KIMI_CODE_OAUTH_ROUTE,
  KIMI_PI_PROVIDER,
  XAI_PI_PROVIDER,
} from './ids.ts'
import type { OAuthProviderSession } from './oauth-session.ts'
import { grokBuildBaselineModels, grokBuildFingerprintHeaders } from './provider.ts'
import type { GrokBuildSession } from './session.ts'

/** Prefer grok-4.6 when the current (live or baseline) list has it. */
export function preferredGrokBuildModel(
  models: readonly { id: string }[] = grokBuildBaselineModels(),
): string {
  return preferredGrokBuildModelFrom(models.length === 0 ? [{ id: DEFAULT_GROK_BUILD_MODEL }] : models)
}

function missingCredential(name: string): never {
  throw new LlmError(
    `${name} is not signed in. Open Settings → Coding OAuth and sign in with your subscription.`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * Minimum remaining validity demanded of an exported OAuth access token.
 * pi-ai 0.84+ already refreshes five minutes before the stored expiry; this
 * explicit floor documents the plugin contract and hard-fails a refresh that
 * returns an even-shorter-lived token instead of handing it to a request.
 */
const MIN_OAUTH_VALIDITY_MS = 60_000

/**
 * Provider retry policy for the coding-subscription routes. The harness
 * default retryable set (EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT)
 * deliberately excludes AUTH, so an upstream 401 — e.g. an access token the
 * server revoked before its local expiry — used to kill the turn outright.
 * AUTH is added here because {@link AliasLlmAdapter} invalidates the stored
 * credential on every AUTH finish, so the retried step refreshes first and
 * does not repeat the same rejected token. Quota exhaustion stays outside the
 * set: retrying a billing-limit 403 cannot succeed and only delays the real
 * message. Genuine credential death is converted to MISSING_CREDENTIAL (not
 * retryable) by the resolver below, so it cannot loop either.
 */
const CODING_OAUTH_RETRY_POLICY = {
  mode: 'normal' as const,
  maxRetries: 2,
  retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH'],
  backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 },
}

function profile(
  provider: string,
  displayName: string,
  piProvider: ResolvedPiAiProviderProfile['piProvider'],
  retryPolicy?: RetryPolicyConfig,
  headers?: Record<string, string>,
): ResolvedPiAiProviderProfile {
  return {
    provider,
    displayName,
    streamIdleTimeoutMs: GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(retryPolicy ?? CODING_OAUTH_RETRY_POLICY, 'dsh-coding-subscription-oauth retryPolicy'),
    configuredMaxTokens: new Map(),
    ...headers === undefined ? {} : { headers },
    piProvider,
  }
}

/** Existing Grok-only constructor retained for public API compatibility. */
export function createGrokBuildAdapter(
  session: GrokBuildSession,
  resolveAttachments: () => AttachmentStore | undefined,
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => new Map<string, ResolvedPiAiProviderProfile>([[GROK_BUILD_ROUTE, profile(
      GROK_BUILD_ROUTE,
      'xAI Grok Build',
      session.provider(),
      undefined,
      grokBuildFingerprintHeaders(),
    )]]),
    resolveApiKey: async () => resolveOAuthToken('Grok Build',
      () => session.models.getAuth(XAI_PI_PROVIDER, { minOAuthValidityMs: MIN_OAUTH_VALIDITY_MS })),
    resolveAttachments,
  })
}

/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
export function createCodingOAuthAdapter(
  grok: GrokBuildSession,
  subscriptions: readonly OAuthProviderSession[],
  resolveAttachments: () => AttachmentStore | undefined,
  retryPolicy?: RetryPolicyConfig,
): LlmAdapter {
  const byNativeId = new Map(subscriptions.map(session => [session.definition.nativeProviderId, session]))
  const aliases = new Map<string, string>([
    [GROK_BUILD_ROUTE, GROK_BUILD_ROUTE],
    [CODEX_OAUTH_ROUTE, CODEX_PI_PROVIDER],
    [KIMI_CODE_OAUTH_ROUTE, KIMI_PI_PROVIDER],
    [CLAUDE_CODE_OAUTH_ROUTE, CLAUDE_PI_PROVIDER],
  ])
  const policies = new Map<string, AliasLlmRoutePolicy>([[GROK_BUILD_ROUTE, {
    displayName: 'xAI Grok Build (OAuth)',
    isAuthenticated: async () => (await grok.store.read(XAI_PI_PROVIDER))?.type === 'oauth',
    onAuthFailure: () => grok.invalidateAccessToken(),
  }]])
  for (const session of subscriptions) {
    policies.set(session.definition.route, {
      displayName: `${session.definition.displayName.replace(/\s*\([^)]*\)$/u, '')} (OAuth)`,
      isAuthenticated: async () => (await session.status()).authenticated,
      onAuthFailure: () => session.invalidateAccessToken(),
    })
  }

  const inner = new PiAiAdapter({
    profiles: () => {
      const profiles = new Map<string, ResolvedPiAiProviderProfile>()
      profiles.set(GROK_BUILD_ROUTE, profile(
        GROK_BUILD_ROUTE,
        'xAI Grok Build',
        grok.provider(),
        retryPolicy,
        grokBuildFingerprintHeaders(),
      ))
      for (const session of subscriptions) {
        profiles.set(session.definition.nativeProviderId, profile(
          session.definition.nativeProviderId,
          session.definition.displayName,
          session.provider(),
          retryPolicy,
        ))
      }
      return profiles
    },
    resolveApiKey: async provider => {
      if (provider === GROK_BUILD_ROUTE) {
        return resolveOAuthToken('Grok Build',
          () => grok.models.getAuth(XAI_PI_PROVIDER, { minOAuthValidityMs: MIN_OAUTH_VALIDITY_MS }))
      }
      const session = byNativeId.get(provider)
      if (session === undefined) throw new LlmError(`Unknown OAuth provider "${provider}"`, 'NO_ADAPTER')
      return resolveOAuthToken(session.definition.displayName,
        () => session.models.getAuth(session.definition.nativeProviderId, { minOAuthValidityMs: MIN_OAUTH_VALIDITY_MS }))
    },
    resolveAttachments,
  })

  return new AliasLlmAdapter(inner, aliases, policies)
}

/**
 * Resolve an OAuth access token for one route, translating a failed refresh
 * (revoked refresh token, dead grant) into MISSING_CREDENTIAL so the failure
 * is not retried and the user is told to sign in again rather than shown a
 * bare upstream 401.
 */
async function resolveOAuthToken(
  displayName: string,
  getAuth: () => Promise<{ auth: { apiKey?: string } } | undefined>,
): Promise<string> {
  let auth: { auth: { apiKey?: string } } | undefined
  try {
    auth = await getAuth()
  } catch (error) {
    throw new LlmError(
      `${displayName} could not refresh its sign-in (${error instanceof Error ? error.message : String(error)}).`
      + ' Open Settings → Coding OAuth and sign in again.',
      'MISSING_CREDENTIAL',
      { cause: error },
    )
  }
  const apiKey = auth?.auth.apiKey
  if (apiKey === undefined || apiKey.length === 0) return missingCredential(displayName)
  return apiKey
}

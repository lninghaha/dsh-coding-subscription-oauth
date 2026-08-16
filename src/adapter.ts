/** Coding-subscription adapter assembled from public dsh-llm-pi-ai extension points. */

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
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

/** Prefer grok-4.5 when the current (live or baseline) list has it. */
export function preferredGrokBuildModel(
  models: readonly { id: string }[] = grokBuildBaselineModels(),
): string {
  return preferredGrokBuildModelFrom(models.length === 0 ? [{ id: DEFAULT_GROK_BUILD_MODEL }] : models)
}

function profile(
  provider: string,
  displayName: string,
  piProvider: ResolvedPiAiProviderProfile['piProvider'],
  headers?: Record<string, string>,
): ResolvedPiAiProviderProfile {
  return {
    provider,
    displayName,
    streamIdleTimeoutMs: GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-grok-build retryPolicy'),
    configuredMaxTokens: new Map(),
    ...headers === undefined ? {} : { headers },
    piProvider,
  }
}

function missingCredential(name: string): never {
  throw new LlmError(
    `${name} is not signed in. Open Settings → Coding OAuth and sign in with your subscription.`,
    'MISSING_CREDENTIAL',
  )
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
      grokBuildFingerprintHeaders(),
    )]]),
    resolveApiKey: async () => {
      const auth = await session.models.getAuth(XAI_PI_PROVIDER)
      const apiKey = auth?.auth.apiKey
      if (apiKey === undefined || apiKey.length === 0) return missingCredential('Grok Build')
      return apiKey
    },
    resolveAttachments,
  })
}

/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
export function createCodingOAuthAdapter(
  grok: GrokBuildSession,
  subscriptions: readonly OAuthProviderSession[],
  resolveAttachments: () => AttachmentStore | undefined,
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
  }]])
  for (const session of subscriptions) {
    policies.set(session.definition.route, {
      displayName: `${session.definition.displayName.replace(/\s*\([^)]*\)$/u, '')} (OAuth)`,
      isAuthenticated: async () => (await session.status()).authenticated,
    })
  }

  const inner = new PiAiAdapter({
    profiles: () => {
      const profiles = new Map<string, ResolvedPiAiProviderProfile>()
      profiles.set(GROK_BUILD_ROUTE, profile(
        GROK_BUILD_ROUTE,
        'xAI Grok Build',
        grok.provider(),
        grokBuildFingerprintHeaders(),
      ))
      for (const session of subscriptions) {
        profiles.set(session.definition.nativeProviderId, profile(
          session.definition.nativeProviderId,
          session.definition.displayName,
          session.provider(),
        ))
      }
      return profiles
    },
    resolveApiKey: async provider => {
      if (provider === GROK_BUILD_ROUTE) {
        const auth = await grok.models.getAuth(XAI_PI_PROVIDER)
        const apiKey = auth?.auth.apiKey
        if (apiKey === undefined || apiKey.length === 0) return missingCredential('Grok Build')
        return apiKey
      }
      const session = byNativeId.get(provider)
      if (session === undefined) throw new LlmError(`Unknown OAuth provider "${provider}"`, 'NO_ADAPTER')
      const token = await session.resolveAccessToken()
      if (token === undefined || token.length === 0) return missingCredential(session.definition.displayName)
      return token
    },
    resolveAttachments,
  })

  return new AliasLlmAdapter(inner, aliases, policies)
}

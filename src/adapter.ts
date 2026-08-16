/** Grok Build adapter assembled from public dsh-llm-pi-ai extension points. */

import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { preferredGrokBuildModelFrom } from './catalog.ts'
import {
  DEFAULT_GROK_BUILD_MODEL,
  GROK_BUILD_ROUTE,
  GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
  XAI_PI_PROVIDER,
} from './ids.ts'
import { grokBuildBaselineModels, grokBuildFingerprintHeaders } from './provider.ts'
import type { GrokBuildSession } from './session.ts'

/** Prefer grok-4.5 when the current (live or baseline) list has it. */
export function preferredGrokBuildModel(
  models: readonly { id: string }[] = grokBuildBaselineModels(),
): string {
  return preferredGrokBuildModelFrom(models.length === 0 ? [{ id: DEFAULT_GROK_BUILD_MODEL }] : models)
}

/**
 * Create the Grok Build adapter without a dsh fork.
 * The public pi-ai adapter owns streaming, tools, reasoning, and compaction;
 * this plugin supplies a refreshable OAuth token and an account model list.
 */
export function createGrokBuildAdapter(
  session: GrokBuildSession,
  resolveAttachments: () => AttachmentStore | undefined,
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => new Map<string, ResolvedPiAiProviderProfile>([[GROK_BUILD_ROUTE, {
      provider: GROK_BUILD_ROUTE,
      displayName: 'xAI Grok Build',
      streamIdleTimeoutMs: GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy: resolveRetryPolicy(undefined, 'dsh-grok-build retryPolicy'),
      configuredMaxTokens: new Map(),
      // PiAiAdapter passes profile.headers to every request — this is the
      // path that actually carries the CLI fingerprint onto the wire.
      headers: grokBuildFingerprintHeaders(),
      piProvider: session.provider(),
    }]]),
    resolveApiKey: async () => {
      const auth = await session.models.getAuth(XAI_PI_PROVIDER)
      const apiKey = auth?.auth.apiKey
      if (apiKey === undefined || apiKey.length === 0) {
        throw new LlmError(
          'Grok Build is not signed in. Open Settings → Grok Build and sign in with SuperGrok or X Premium.',
          'MISSING_CREDENTIAL',
        )
      }
      return apiKey
    },
    resolveAttachments,
  })
}

/**
 * Grok Build provider: a pi-ai provider pointed at the official Grok CLI
 * coding backend (`cli-chat-proxy.grok.com`) carrying the CLI fingerprint
 * headers the risk-control middleware requires.
 * @module dsh-grok-build/provider
 */

import { createProvider } from '@earendil-works/pi-ai'
import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { GROK_BUILD_ROUTE } from './ids.ts'

/** Inference backend base URL (Responses API lives under `${baseUrl}/responses`). */
export const GROK_BUILD_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'

/** Account model catalog endpoint fetched by the official CLI. */
export const GROK_BUILD_MODELS_URL = `${GROK_BUILD_BASE_URL}/models-v2`

/**
 * Official Grok CLI version this plugin fingerprints as.
 * Track the `@xai-official/grok` npm release stream; make overridable via
 * GROK_BUILD_CLIENT_VERSION for urgent drift fixes without a release.
 */
export const GROK_CLIENT_VERSION: string =
  process.env['GROK_BUILD_CLIENT_VERSION'] ?? '0.1.220'

/**
 * Fingerprint headers required by the Grok Build middleware. Missing headers
 * are a known 403 trigger (codex-app-transfer field notes, 2026-07).
 */
export function grokBuildFingerprintHeaders(): Record<string, string> {
  return {
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-client-identifier': 'grok-shell',
    'x-grok-client-version': GROK_CLIENT_VERSION,
    'User-Agent': `grok-shell/${GROK_CLIENT_VERSION}`,
  }
}

/** Static baseline catalog, used until a live `/models-v2` listing succeeds. */
export function grokBuildBaselineModels(): Model<'openai-responses'>[] {
  return [
    {
      id: 'grok-4.5',
      name: 'Grok 4.5',
      api: 'openai-responses',
      provider: GROK_BUILD_ROUTE,
      baseUrl: GROK_BUILD_BASE_URL,
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 500_000,
      maxTokens: 128_000,
    },
    {
      id: 'grok-composer-2.5-fast',
      name: 'Grok Composer 2.5 Fast',
      api: 'openai-responses',
      provider: GROK_BUILD_ROUTE,
      baseUrl: GROK_BUILD_BASE_URL,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 64_000,
    },
  ]
}

/**
 * Build the Grok Build pi-ai provider. Auth is apiKey-shaped: the OAuth
 * access token is injected as the bearer key by the surrounding adapter
 * (`Models.getAuth` on the login provider performs refresh under the store
 * lock before the key ever reaches here).
 */
export function grokBuildProvider(models: readonly Model<Api>[]): Provider {
  return createProvider({
    id: GROK_BUILD_ROUTE,
    name: 'xAI Grok Build',
    baseUrl: GROK_BUILD_BASE_URL,
    headers: grokBuildFingerprintHeaders(),
    auth: {
      apiKey: {
        name: 'Grok Build OAuth access token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OAuth' }
        },
      },
    },
    models,
    api: { 'openai-responses': openAIResponsesApi() },
  })
}

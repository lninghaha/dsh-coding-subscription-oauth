/**
 * Standalone smoke for the Grok Build path — no dsh host required.
 * Usage: node scripts/smoke-infer.mjs [modelId]
 * Requires a stored credential (`dsh-grok-build login` or `import` first).
 */

import { createModels } from '@earendil-works/pi-ai'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import {
  ensureGrokBuildProxy,
  grokBuildFingerprintHeaders,
  grokBuildProxyInEffect,
  GrokBuildSession,
  XAI_PI_PROVIDER,
} from '../lib/index.js'

const modelId = process.argv[2] ?? 'grok-4.5'

ensureGrokBuildProxy()
console.log(`proxy: ${grokBuildProxyInEffect() ?? '(none — direct)'}`)

const session = new GrokBuildSession()
await session.loadCachedCatalog()
await session.refreshLiveCatalog()
console.log(`catalog (${session.catalogSource}): ${session.availableModels().map(m => m.id).join(', ')}`)
if (session.catalogError !== undefined) {
  console.error(`catalog error: ${session.catalogError}`)
}

// Resolve the OAuth access token (refreshing under the store lock if stale).
const models = createModels({ credentials: session.store })
models.setProvider(xaiProvider())
const auth = await models.getAuth(XAI_PI_PROVIDER)
const apiKey = auth?.auth.apiKey
if (apiKey === undefined || apiKey.length === 0) {
  console.error('not signed in — run `node lib/bin.js login` first')
  process.exit(1)
}

const provider = session.provider()
const model = provider.getModels().find(m => m.id === modelId)
if (model === undefined) {
  console.error(`model ${modelId} not in visible catalog`)
  process.exit(1)
}

console.log(`streaming ${modelId} …`)
// createProvider dispatches on model.api; pass the CLI fingerprint headers
// explicitly (the PiAiAdapter path does this via profile.headers instead).
const stream = provider.stream(model, {
  messages: [{ role: 'user', content: 'Reply with exactly: OK', timestamp: Date.now() }],
}, { apiKey, headers: grokBuildFingerprintHeaders(), signal: AbortSignal.timeout(120_000) })

let text = ''
for await (const event of stream) {
  if (event.type === 'text_delta') text += event.delta
  else if (event.type === 'error') {
    const detail = event.error?.errorMessage ?? JSON.stringify(event.error ?? event)
    console.error(`stream error: ${detail}`)
    process.exit(1)
  }
}
console.log(`reply: ${JSON.stringify(text)}`)
console.log('smoke OK')

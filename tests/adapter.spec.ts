import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preferredGrokBuildModel } from '../src/adapter.ts'
import { DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_ROUTE } from '../src/ids.ts'
import { grokBuildBaselineModels, grokBuildFingerprintHeaders, GROK_BUILD_BASE_URL } from '../src/provider.ts'

describe('preferredGrokBuildModel', () => {
  it('prefers grok-4.5 from the baseline catalog', () => {
    expect(preferredGrokBuildModel()).toBe(DEFAULT_GROK_BUILD_MODEL)
    expect(preferredGrokBuildModel([{ id: 'grok-4.6' }, { id: 'grok-4.5' }])).toBe('grok-4.5')
  })
})

describe('grokBuildBaselineModels', () => {
  it('ships responses-API descriptors on the grok-build route', () => {
    const models = grokBuildBaselineModels()
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.provider).toBe(GROK_BUILD_ROUTE)
      expect(model.api).toBe('openai-responses')
      expect(model.baseUrl).toBe(GROK_BUILD_BASE_URL)
    }
    const reasoning = models.find(model => model.id === 'grok-4.5')
    expect(reasoning?.reasoning).toBe(true)
    expect(reasoning?.thinkingLevelMap?.off).toBeNull()
  })
})

describe('grokBuildFingerprintHeaders', () => {
  it('carries the CLI fingerprint required by risk control', () => {
    const headers = grokBuildFingerprintHeaders()
    expect(headers['X-XAI-Token-Auth']).toBe('xai-grok-cli')
    expect(headers['x-grok-client-identifier']).toBe('grok-shell')
    expect(headers['x-grok-client-version']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(headers['User-Agent']).toContain('grok-shell/')
  })
})

describe('GrokBuildSession.provider', () => {
  it('registers models under the harness route so the picker can find them', async () => {
    const { createModels } = await import('@earendil-works/pi-ai')
    const { GrokBuildSession } = await import('../src/session.ts')
    const { GrokBuildCredentialStore } = await import('../src/store.ts')
    const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-session-'))
    const session = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, 'auth.json')))
    const provider = session.provider()
    expect(provider.id).toBe(GROK_BUILD_ROUTE)
    const models = createModels()
    models.setProvider(provider)
    const listed = models.getModels(GROK_BUILD_ROUTE)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every(model => model.provider === GROK_BUILD_ROUTE)).toBe(true)
  })
})

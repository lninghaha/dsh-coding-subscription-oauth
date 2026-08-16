import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodingOAuthAdapter, preferredGrokBuildModel } from '../src/adapter.ts'
import {
  CLAUDE_CODE_OAUTH_ROUTE,
  CODEX_OAUTH_ROUTE,
  DEFAULT_GROK_BUILD_MODEL,
  GROK_BUILD_ROUTE,
  KIMI_CODE_OAUTH_ROUTE,
  XAI_PI_PROVIDER,
} from '../src/ids.ts'
import { OAUTH_PROVIDER_DEFINITIONS } from '../src/oauth-providers.ts'
import { OAuthProviderSession } from '../src/oauth-session.ts'
import { GrokBuildSession } from '../src/session.ts'
import { GrokBuildCredentialStore, OAuthCredentialFileStore } from '../src/store.ts'
import { grokBuildBaselineModels, grokBuildFingerprintHeaders, GROK_BUILD_BASE_URL } from '../src/provider.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('preferredGrokBuildModel', () => {
  it('prefers grok-4.6 from the baseline catalog', () => {
    expect(preferredGrokBuildModel()).toBe(DEFAULT_GROK_BUILD_MODEL)
    expect(preferredGrokBuildModel([{ id: 'grok-4.6' }, { id: 'grok-4.5' }])).toBe('grok-4.6')
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
    const grok45 = models.find(model => model.id === 'grok-4.5')
    const grok46 = models.find(model => model.id === 'grok-4.6')
    expect(grok45?.reasoning).toBe(true)
    expect(grok45?.thinkingLevelMap?.off).toBeNull()
    expect(grok45?.thinkingLevelMap?.xhigh).toBeNull()
    expect(grok46?.thinkingLevelMap?.xhigh).toBe('xhigh')
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

  it('notifies model discovery after login even when the live catalog fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-notify-'))
    const store = new GrokBuildCredentialStore(join(dir, 'auth.json'))
    await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth', access: 'grok-access', refresh: 'grok-refresh', expires: Date.now() + 3_600_000,
    }))
    const notify = vi.fn()
    const session = new GrokBuildSession(store, notify)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    await session.refreshLiveCatalog()
    expect(notify).toHaveBeenCalledOnce()
    expect(session.catalogSource).toBe('fallback')
  })
})

describe('createCodingOAuthAdapter model discovery', () => {
  it('lists only authenticated OAuth routes and marks provider names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-coding-oauth-adapter-'))
    const grokStore = new GrokBuildCredentialStore(join(dir, 'grok.json'))
    const grok = new GrokBuildSession(grokStore)
    const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(
      definition,
      undefined,
      new OAuthCredentialFileStore(
        definition.nativeProviderId,
        join(dir, `${definition.slug}.json`),
        definition.route,
      ),
      join(dir, `${definition.slug}-models.json`),
    ))
    const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined)

    for (const route of [GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, KIMI_CODE_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]) {
      expect(await adapter.listModels(route)).toEqual([])
      expect(adapter.providerInfo(route).name).toMatch(/\(OAuth\)$/u)
    }

    const codex = subscriptions.find(session => session.definition.route === CODEX_OAUTH_ROUTE)!
    await codex.store.modify(codex.definition.nativeProviderId, async () => ({
      type: 'oauth', access: 'codex-access', refresh: 'codex-refresh', expires: Date.now() + 3_600_000,
    }))
    const listedCodex = await adapter.listModels(CODEX_OAUTH_ROUTE)
    expect(listedCodex.length).toBeGreaterThan(0)
    expect(await adapter.resolveModel(CODEX_OAUTH_ROUTE, listedCodex[0]!.id)).toMatchObject({
      provider: CODEX_OAUTH_ROUTE,
      id: listedCodex[0]!.id,
    })
    expect(await adapter.listModels(KIMI_CODE_OAUTH_ROUTE)).toEqual([])

    await grokStore.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth', access: 'grok-access', refresh: 'grok-refresh', expires: Date.now() + 3_600_000,
    }))
    expect((await adapter.listModels(GROK_BUILD_ROUTE)).length).toBeGreaterThan(0)
  })

  it('exposes a retry policy that retries AUTH and transient failures on every route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-coding-oauth-retry-'))
    const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, 'grok.json')))
    const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(
      definition,
      undefined,
      new OAuthCredentialFileStore(
        definition.nativeProviderId,
        join(dir, `${definition.slug}.json`),
        definition.route,
      ),
      join(dir, `${definition.slug}-models.json`),
    ))
    const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined)
    for (const route of [GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, KIMI_CODE_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]) {
      const policy = adapter.providerRetryPolicy(route)
      expect(policy?.mode).toBe('normal')
      expect(policy).toMatchObject({ maxRetries: 2 })
      const codes = policy?.mode === 'normal' ? policy.retryableCodes : []
      for (const code of ['AUTH', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']) {
        expect(codes).toContain(code)
      }
      // Quota exhaustion must fail fast with the real message, not retry.
      expect(codes).not.toContain('QUOTA')
      expect(codes).not.toContain('MISSING_CREDENTIAL')
    }
  })

  it('honours a retryPolicy override for every route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-coding-oauth-retry-override-'))
    const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, 'grok.json')))
    const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(
      definition,
      undefined,
      new OAuthCredentialFileStore(
        definition.nativeProviderId,
        join(dir, `${definition.slug}.json`),
        definition.route,
      ),
      join(dir, `${definition.slug}-models.json`),
    ))
    const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined, {
      mode: 'normal',
      maxRetries: 5,
      retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
      backoff: { initialDelayMs: 250, maxDelayMs: 5_000, jitterRatio: 0 },
    })
    const policy = adapter.providerRetryPolicy(KIMI_CODE_OAUTH_ROUTE)
    expect(policy).toMatchObject({ mode: 'normal', maxRetries: 5, initialDelayMs: 250, maxDelayMs: 5_000 })
    expect(policy?.mode === 'normal' && policy.retryableCodes).not.toContain('AUTH')
  })

  it('maps a failed token refresh to MISSING_CREDENTIAL instead of a bare 401', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-coding-oauth-dead-refresh-'))
    const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, 'grok.json')))
    const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(
      definition,
      undefined,
      new OAuthCredentialFileStore(
        definition.nativeProviderId,
        join(dir, `${definition.slug}.json`),
        definition.route,
      ),
      join(dir, `${definition.slug}-models.json`),
    ))
    const kimi = subscriptions.find(session => session.definition.route === KIMI_CODE_OAUTH_ROUTE)!
    vi.spyOn(kimi.models, 'getAuth').mockRejectedValue(new Error('OAuth refresh failed for kimi-coding: 401 invalid_grant'))
    const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined)
    const consume = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: KIMI_CODE_OAUTH_ROUTE, model: 'k3', messages: [],
      } as never)) {
        // Drain; the stream must reject before yielding anything.
      }
    }
    await expect(consume()).rejects.toThrow(/sign in/i)
    await consume().then(
      () => expect.unreachable('stream must reject'),
      (error: unknown) => expect((error as { code?: string }).code).toBe('MISSING_CREDENTIAL'),
    )
  })
})

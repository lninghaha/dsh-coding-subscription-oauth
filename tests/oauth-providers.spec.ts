import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '@earendil-works/pi-ai'
import {
  CLAUDE_CODE_OAUTH_PROVIDER,
  CODEX_OAUTH_PROVIDER,
  KIMI_CODE_OAUTH_PROVIDER,
} from '../src/oauth-providers.ts'
import {
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  KIMI_CODE_OAUTH_ROUTE,
  KIMI_PI_PROVIDER,
} from '../src/ids.ts'

const ctx: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth request providers', () => {
  it('bridges a Codex OAuth token through the apiKey override seam', async () => {
    const provider = CODEX_OAUTH_PROVIDER.requestProvider()
    const auth = await provider.auth.apiKey?.resolve({
      ctx,
      credential: { type: 'api_key', key: 'codex-token' },
      signal: new AbortController().signal,
    })
    expect(provider.id).toBe(CODEX_PI_PROVIDER)
    expect(provider.getModels().every(model => model.provider === CODEX_PI_PROVIDER)).toBe(true)
    expect(auth?.auth).toEqual({ apiKey: 'codex-token' })
  })

  it('bridges a Kimi OAuth token only as Authorization Bearer', async () => {
    const provider = KIMI_CODE_OAUTH_PROVIDER.requestProvider()
    const auth = await provider.auth.apiKey?.resolve({
      ctx,
      credential: { type: 'api_key', key: 'kimi-token' },
      signal: new AbortController().signal,
    })
    expect(provider.id).toBe(KIMI_PI_PROVIDER)
    expect(provider.getModels().every(model => model.provider === KIMI_PI_PROVIDER)).toBe(true)
    expect(auth?.auth).toEqual({ headers: { Authorization: 'Bearer kimi-token' } })
    expect(auth?.auth.apiKey).toBeUndefined()
  })

  it('removes the Kimi apiKey carrier before the Anthropic SDK builds wire headers', async () => {
    let requestHeaders: Headers | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requestHeaders = request.headers
      return new Response(JSON.stringify({ error: { message: 'fixture stop' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }))
    const provider = KIMI_CODE_OAUTH_PROVIDER.requestProvider()
    const model = provider.getModels()[0]!
    const stream = provider.streamSimple(model, { messages: [] }, {
      apiKey: 'kimi-access-token',
      headers: { Authorization: 'Bearer kimi-access-token' },
    })
    expect((await stream.result()).stopReason).toBe('error')
    expect(requestHeaders?.get('authorization')).toBe('Bearer kimi-access-token')
    expect(requestHeaders?.get('x-api-key')).toBeNull()
  })

  it('keeps Claude model identity native and filters selected ids', () => {
    const all = CLAUDE_CODE_OAUTH_PROVIDER.requestProvider().getModels()
    expect(all.length).toBeGreaterThan(1)
    const chosen = all[0]!
    const provider = CLAUDE_CODE_OAUTH_PROVIDER.requestProvider([chosen.id])
    expect(provider.id).toBe(CLAUDE_PI_PROVIDER)
    expect(provider.getModels().map(model => model.id)).toEqual([chosen.id])
    expect(provider.getModels()[0]?.provider).toBe(CLAUDE_PI_PROVIDER)
  })

  it('uses collision-free Harness route aliases', () => {
    expect(CODEX_OAUTH_PROVIDER.route).toBe(CODEX_OAUTH_ROUTE)
    expect(KIMI_CODE_OAUTH_PROVIDER.route).toBe(KIMI_CODE_OAUTH_ROUTE)
    expect(CLAUDE_CODE_OAUTH_PROVIDER.route).toBe(CLAUDE_CODE_OAUTH_ROUTE)
    expect(new Set([
      CODEX_OAUTH_PROVIDER.route,
      KIMI_CODE_OAUTH_PROVIDER.route,
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    ]).size).toBe(3)
  })
})

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  extractCode,
  generatePkce,
  loginGrokBuildPkce,
  refreshGrokBuildToken,
} from '../src/oauth.ts'

interface MockIdP {
  issuer: string
  lastAuthorizeQuery: () => URLSearchParams | undefined
  lastTokenForm: () => URLSearchParams | undefined
  close(): Promise<void>
}

/** Loopback OIDC issuer double: discovery + authorize (302) + token exchange. */
async function startMockIdP(options: { omitRefreshOnRefreshGrant?: boolean } = {}): Promise<MockIdP> {
  const challenges = new Map<string, string>()
  let lastAuthorizeQuery: URLSearchParams | undefined
  let lastTokenForm: URLSearchParams | undefined
  let issuer = ''
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
      }))
      return
    }
    if (url.pathname === '/oauth2/authorize') {
      lastAuthorizeQuery = url.searchParams
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      const challenge = url.searchParams.get('code_challenge') ?? ''
      const code = `mock-code-${challenges.size}`
      challenges.set(code, challenge)
      res.writeHead(302, { location: `${redirectUri}?code=${code}&state=${state}` }).end()
      return
    }
    if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        lastTokenForm = new URLSearchParams(body)
        const grant = lastTokenForm.get('grant_type')
        if (grant === 'authorization_code') {
          const code = lastTokenForm.get('code') ?? ''
          const verifier = lastTokenForm.get('code_verifier') ?? ''
          const expected = challenges.get(code)
          const actual = createHash('sha256').update(verifier).digest('base64url')
          if (expected === undefined || actual !== expected) {
            res.writeHead(400, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            access_token: 'mock-access',
            refresh_token: 'mock-refresh',
            expires_in: 3600,
          }))
          return
        }
        if (grant === 'refresh_token') {
          const payload: Record<string, unknown> = { access_token: 'mock-access-2', expires_in: 3600 }
          if (!options.omitRefreshOnRefreshGrant) payload['refresh_token'] = 'mock-refresh-2'
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
          return
        }
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unsupported_grant_type' }))
      })
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    issuer,
    lastAuthorizeQuery: () => lastAuthorizeQuery,
    lastTokenForm: () => lastTokenForm,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

function urlSignal(): { promise: Promise<string>; deliver(url: string): void } {
  let deliver: (url: string) => void = () => {}
  const promise = new Promise<string>(resolve => { deliver = resolve })
  return { promise, deliver }
}

describe('generatePkce', () => {
  it('produces an S256 verifier/challenge pair', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
  })
})

describe('extractCode', () => {
  it('passes a bare code through and parses a full redirect URL', () => {
    expect(extractCode('  abc123  ')).toBe('abc123')
    expect(extractCode('http://127.0.0.1:56121/callback?code=xyz789&state=s')).toBe('xyz789')
    expect(extractCode('not-a-url-no-query')).toBe('not-a-url-no-query')
  })
})

describe('loginGrokBuildPkce', () => {
  it('completes a PKCE login via the loopback channel', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: value => url.deliver(value) },
        { issuer: idp.issuer, clientId: 'test-client', port: 0 },
      )
      const authorizeUrl = await url.promise
      // Simulate the browser: authorize → 302 → loopback callback.
      const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
      expect(authResponse.status).toBe(302)
      const location = authResponse.headers.get('location')!
      const callbackResponse = await fetch(location)
      expect(callbackResponse.status).toBe(200)
      const credential = await login
      expect(credential).toMatchObject({ type: 'oauth', access: 'mock-access', refresh: 'mock-refresh' })
      expect(credential.expires).toBeGreaterThan(Date.now())
      const query = idp.lastAuthorizeQuery()!
      expect(query.get('client_id')).toBe('test-client')
      expect(query.get('response_type')).toBe('code')
      expect(query.get('code_challenge_method')).toBe('S256')
      expect(query.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      expect(query.get('scope')).toContain('grok-cli:access')
      // The mock only answers when code_verifier matches the challenge.
      expect(idp.lastTokenForm()?.get('grant_type')).toBe('authorization_code')
    } finally {
      await idp.close()
    }
  })

  it('completes via the manual paste channel (full redirect URL accepted)', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        {
          onAuthorizeUrl: value => url.deliver(value),
          awaitCode: async () => {
            const authorizeUrl = await url.promise
            const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
            return authResponse.headers.get('location') ?? ''
          },
        },
        { issuer: idp.issuer, clientId: 'test-client', port: 0 },
      )
      const credential = await login
      expect(credential.access).toBe('mock-access')
    } finally {
      await idp.close()
    }
  })

  it('rejects with state_mismatch on a forged callback', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: value => url.deliver(value) },
        { issuer: idp.issuer, clientId: 'test-client', port: 0 },
      )
      // Attach a handler up front: the rejection lands mid-test, and a
      // late-attached .rejects would trip Node's unhandled-rejection hook.
      const outcome = login.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const authorizeUrl = await url.promise
      const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
      const location = authResponse.headers.get('location')!
      const forged = location.replace(/state=[^&]+/, 'state=forged')
      const page = await fetch(forged)
      expect(page.status).toBe(400)
      const result = await outcome
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatchObject({ code: 'state_mismatch' })
    } finally {
      await idp.close()
    }
  })

  it('rejects with timeout when nothing completes', async () => {
    const idp = await startMockIdP()
    try {
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: () => {}, timeoutMs: 150 },
        { issuer: idp.issuer, clientId: 'test-client', port: 0 },
      )
      await expect(login).rejects.toMatchObject({ code: 'timeout' })
    } finally {
      await idp.close()
    }
  })
})

describe('refreshGrokBuildToken', () => {
  it('adopts a rotated refresh token', async () => {
    const idp = await startMockIdP()
    try {
      const credential = await refreshGrokBuildToken('old-refresh', { issuer: idp.issuer, clientId: 'test-client' })
      expect(credential).toMatchObject({ type: 'oauth', access: 'mock-access-2', refresh: 'mock-refresh-2' })
      expect(idp.lastTokenForm()?.get('refresh_token')).toBe('old-refresh')
    } finally {
      await idp.close()
    }
  })

  it('keeps the previous refresh token when the issuer does not rotate', async () => {
    const idp = await startMockIdP({ omitRefreshOnRefreshGrant: true })
    try {
      const credential = await refreshGrokBuildToken('old-refresh', { issuer: idp.issuer, clientId: 'test-client' })
      expect(credential.refresh).toBe('old-refresh')
      expect(credential.access).toBe('mock-access-2')
    } finally {
      await idp.close()
    }
  })
})

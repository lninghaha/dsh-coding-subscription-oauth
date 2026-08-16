/**
 * Grok Build OAuth authorization-code + PKCE flow (primary login path).
 *
 * Mirrors the official Grok CLI: OIDC discovery, S256 PKCE, dual-channel code
 * capture (loopback listener + manual paste), form POST token exchange.
 * The device-code flow remains the fallback (see auth.ts / bin.ts).
 * @module dsh-coding-subscription-oauth/oauth
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { OAuthCredential } from '@earendil-works/pi-ai'

/** OIDC issuer for both Grok CLI and Grok Build. */
export const GROK_BUILD_OAUTH_ISSUER = 'https://auth.x.ai'

/**
 * Public client id known to work for the device flow; reused as the default
 * for the authorization-code flow until the official CLI's own id is
 * confirmed (T2.1). Override with GROK_OAUTH2_CLIENT_ID.
 */
export const GROK_BUILD_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'

/** Scopes the official CLI requests (grok-cli:access = CLI inference pass). */
export const GROK_BUILD_OAUTH_SCOPE =
  'openid profile email offline_access grok-cli:access api:access'

/** Default loopback port observed for the official CLI (codex-app-transfer). */
export const GROK_BUILD_OAUTH_DEFAULT_PORT = 56121

const DISCOVERY_PATH = '/.well-known/openid-configuration'
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const PORT_SCAN_ATTEMPTS = 10

export type GrokBuildOAuthErrorCode =
  | 'discovery'
  | 'loopback'
  | 'state_mismatch'
  | 'token_exchange'
  | 'cancelled'
  | 'timeout'

/** OAuth failure with a stable, secret-free machine code. */
export class GrokBuildOAuthError extends Error {
  readonly code: GrokBuildOAuthErrorCode

  constructor(code: GrokBuildOAuthErrorCode, message: string) {
    super(`grok-build oauth: ${message}`)
    this.name = 'GrokBuildOAuthError'
    this.code = code
  }
}

export interface GrokBuildOAuthParams {
  issuer: string
  clientId: string
  scope: string
  /** Loopback port for the redirect URI; falls forward on EADDRINUSE. */
  port: number
  /** Optional xAI extension parameter. */
  referrer?: string
}

/** Resolve OAuth parameters from overrides then GROK_OAUTH2_* env vars. */
export function resolveOAuthParams(overrides: Partial<GrokBuildOAuthParams> = {}): GrokBuildOAuthParams {
  const env = process.env
  return {
    issuer: overrides.issuer ?? env['GROK_OAUTH2_ISSUER'] ?? GROK_BUILD_OAUTH_ISSUER,
    clientId: overrides.clientId ?? env['GROK_OAUTH2_CLIENT_ID'] ?? GROK_BUILD_OAUTH_CLIENT_ID,
    scope: overrides.scope ?? env['GROK_OAUTH2_SCOPES'] ?? GROK_BUILD_OAUTH_SCOPE,
    port: overrides.port ?? (env['GROK_OAUTH2_PORT'] !== undefined ? Number(env['GROK_OAUTH2_PORT']) : GROK_BUILD_OAUTH_DEFAULT_PORT),
    ...overrides.referrer ?? env['GROK_OAUTH2_REFERRER']
      ? { referrer: overrides.referrer ?? env['GROK_OAUTH2_REFERRER'] }
      : {},
  }
}

interface DiscoveryDocument {
  authorization_endpoint: string
  token_endpoint: string
}

let discoveryCache: { issuer: string; document: DiscoveryDocument; fetchedAt: number } | undefined

/** Fetch (and cache for the process) the issuer's discovery document. */
export async function discoverOAuthEndpoints(
  issuer: string,
  signal?: AbortSignal,
): Promise<DiscoveryDocument> {
  if (discoveryCache !== undefined && discoveryCache.issuer === issuer
    && Date.now() - discoveryCache.fetchedAt < 60 * 60 * 1000) {
    return discoveryCache.document
  }
  let response: Response
  try {
    response = await fetch(`${issuer}${DISCOVERY_PATH}`, {
      headers: { accept: 'application/json' },
      signal,
    })
  } catch {
    throw new GrokBuildOAuthError('discovery', `issuer ${issuer} is unreachable`)
  }
  if (!response.ok) {
    throw new GrokBuildOAuthError('discovery', `issuer ${issuer} discovery failed (HTTP ${response.status})`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GrokBuildOAuthError('discovery', `issuer ${issuer} discovery returned invalid JSON`)
  }
  const document = body as Partial<DiscoveryDocument>
  if (typeof document.authorization_endpoint !== 'string' || typeof document.token_endpoint !== 'string') {
    throw new GrokBuildOAuthError('discovery', `issuer ${issuer} discovery lacks OAuth endpoints`)
  }
  const parsed: DiscoveryDocument = {
    authorization_endpoint: document.authorization_endpoint,
    token_endpoint: document.token_endpoint,
  }
  discoveryCache = { issuer, document: parsed, fetchedAt: Date.now() }
  return parsed
}

/** Generate an S256 PKCE verifier/challenge pair (Web Crypto compatible). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function randomToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Build the authorization URL for one login attempt. */
export function buildAuthorizeUrl(
  endpoints: DiscoveryDocument,
  params: GrokBuildOAuthParams,
  redirectUri: string,
  challenge: string,
  state: string,
  nonce: string,
): string {
  const url = new URL(endpoints.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  if (params.referrer !== undefined) url.searchParams.set('referrer', params.referrer)
  return url.href
}

const LOOPBACK_OK_PAGE = '<!doctype html><meta charset="utf-8"><title>Grok Build</title>'
  + '<body style="font-family:system-ui;text-align:center;padding:4rem">'
  + '<h2>Grok Build sign-in complete</h2><p>You can close this tab and return to dsh.</p></body>'

const LOOPBACK_ERROR_PAGE = '<!doctype html><meta charset="utf-8"><title>Grok Build</title>'
  + '<body style="font-family:system-ui;text-align:center;padding:4rem">'
  + '<h2>Sign-in failed</h2><p>State mismatch or missing code — try again in dsh.</p></body>'

interface LoopbackResult {
  code: string
}

/**
 * Listen on 127.0.0.1 for the IdP redirect. Falls forward across a small port
 * scan on EADDRINUSE. Any request path is accepted; only the query matters.
 */
async function listenForCode(
  port: number,
  state: string,
  signal: AbortSignal,
): Promise<{ server: Server; port: number; wait: Promise<LoopbackResult> }> {
  let lastError: unknown
  for (let attempt = 0; attempt < PORT_SCAN_ATTEMPTS; attempt += 1) {
    const candidate = port + attempt
    const server = createServer()
    const wait = new Promise<LoopbackResult>((resolvePromise, rejectPromise) => {
      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        if (error !== null) {
          response.writeHead(400, { 'content-type': 'text/html' }).end(LOOPBACK_ERROR_PAGE)
          rejectPromise(new GrokBuildOAuthError('token_exchange', `authorization returned error: ${error}`))
          return
        }
        if (code === null || returnedState !== state) {
          response.writeHead(400, { 'content-type': 'text/html' }).end(LOOPBACK_ERROR_PAGE)
          rejectPromise(new GrokBuildOAuthError('state_mismatch', 'loopback redirect carried a mismatched state'))
          return
        }
        response.writeHead(200, { 'content-type': 'text/html' }).end(LOOPBACK_OK_PAGE)
        resolvePromise({ code })
      })
      server.on('error', error => rejectPromise(error))
      signal.addEventListener('abort', () => {
        // Plain error on purpose: the caller maps aborts to cancelled/timeout.
        rejectPromise(new Error('loopback listener aborted'))
      }, { once: true })
    })
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise)
        server.listen(candidate, '127.0.0.1', resolvePromise)
      })
      // Swallow late errors after a successful settle of the wait promise.
      wait.catch(() => {})
      const address = server.address()
      const boundPort = typeof address === 'object' && address !== null ? address.port : candidate
      return { server, port: boundPort, wait }
    } catch (error) {
      lastError = error
      server.removeAllListeners()
      await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
      if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') break
    }
  }
  throw new GrokBuildOAuthError(
    'loopback',
    `could not bind a loopback listener near port ${port}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

function credentialFromTokenResponse(body: TokenResponse, previousRefresh?: string): OAuthCredential {
  const access = body.access_token
  if (typeof access !== 'string' || access.length === 0) {
    throw new GrokBuildOAuthError('token_exchange', 'token response missing access_token')
  }
  // xAI may omit refresh_token when the token is not rotated.
  const refresh = typeof body.refresh_token === 'string' && body.refresh_token.length > 0
    ? body.refresh_token
    : previousRefresh
  if (refresh === undefined) {
    throw new GrokBuildOAuthError('token_exchange', 'token response missing refresh_token')
  }
  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
    ? body.expires_in
    : 3600
  return { type: 'oauth', access, refresh, expires: Date.now() + expiresIn * 1000 }
}

async function postTokenForm(
  tokenEndpoint: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
  previousRefresh?: string,
): Promise<OAuthCredential> {
  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new GrokBuildOAuthError('cancelled', 'request was cancelled')
    throw new GrokBuildOAuthError('token_exchange', `token endpoint is unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let body: TokenResponse & { error?: unknown; error_description?: unknown }
  try {
    body = await response.json() as TokenResponse
  } catch {
    throw new GrokBuildOAuthError('token_exchange', `token endpoint returned invalid JSON (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
    const detail = typeof body.error_description === 'string' ? `: ${body.error_description}` : ''
    throw new GrokBuildOAuthError('token_exchange', `token endpoint rejected the request (${code})${detail}`)
  }
  return credentialFromTokenResponse(body, previousRefresh)
}

/** Exchange a refresh token for a fresh credential (rotation-tolerant). */
export async function refreshGrokBuildToken(
  refreshToken: string,
  overrides: Partial<GrokBuildOAuthParams> = {},
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  const params = resolveOAuthParams(overrides)
  const endpoints = await discoverOAuthEndpoints(params.issuer, signal)
  return postTokenForm(endpoints.token_endpoint, {
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: refreshToken,
  }, signal, refreshToken)
}

export interface PkceLoginCallbacks {
  /** Invoked with the authorization URL to display/open for the user. */
  onAuthorizeUrl(url: string): void
  /**
   * Manual-paste channel: resolve with the code (or full redirect URL) the
   * user pasted. Return undefined to disable this channel. Rejects on cancel.
   */
  awaitCode?: (signal: AbortSignal) => Promise<string | undefined>
  signal?: AbortSignal
  timeoutMs?: number
}

/** Extract a bare code from user input that may be a full redirect URL. */
export function extractCode(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return trimmed
  try {
    const url = new URL(trimmed)
    return url.searchParams.get('code') ?? trimmed
  } catch {
    return trimmed
  }
}

/**
 * Run the authorization-code + PKCE login. The code arrives via the loopback
 * listener or the manual-paste channel, whichever wins. The caller persists
 * the returned credential (store.modify under the file lock).
 */
export async function loginGrokBuildPkce(
  callbacks: PkceLoginCallbacks,
  overrides: Partial<GrokBuildOAuthParams> = {},
): Promise<OAuthCredential> {
  const params = resolveOAuthParams(overrides)
  const timeoutMs = callbacks.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const controller = new AbortController()
  /** Aborts the losing code-capture channel once one channel wins. */
  const channelsController = new AbortController()
  const onParentAbort = (): void => { controller.abort() }
  callbacks.signal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const endpoints = await discoverOAuthEndpoints(params.issuer, controller.signal)
    const { verifier, challenge } = generatePkce()
    const state = randomToken()
    const nonce = randomToken()
    const listener = await listenForCode(params.port, state, controller.signal)
    const redirectUri = `http://127.0.0.1:${listener.port}/callback`
    const url = buildAuthorizeUrl(endpoints, params, redirectUri, challenge, state, nonce)
    try {
      callbacks.onAuthorizeUrl(url)
      const channels: Promise<string>[] = [listener.wait.then(result => result.code)]
      if (callbacks.awaitCode !== undefined) {
        channels.push(
          callbacks.awaitCode(channelsController.signal).then(input =>
            input === undefined || extractCode(input).length === 0
              ? new Promise<string>(() => {}) // channel disabled: never settles
              : extractCode(input)),
        )
      }
      const code = await Promise.race(channels)
      channelsController.abort() // release the losing channel (e.g. a pending paste prompt)
      return await postTokenForm(endpoints.token_endpoint, {
        grant_type: 'authorization_code',
        client_id: params.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }, controller.signal)
    } finally {
      listener.server.close()
    }
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof GrokBuildOAuthError)) {
      const timedOut = !callbacks.signal?.aborted
      throw new GrokBuildOAuthError(timedOut ? 'timeout' : 'cancelled',
        timedOut ? `no authorization completed within ${Math.round(timeoutMs / 60000)} minutes` : 'login was cancelled')
    }
    throw error
  } finally {
    clearTimeout(timer)
    callbacks.signal?.removeEventListener('abort', onParentAbort)
  }
}

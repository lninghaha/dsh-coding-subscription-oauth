/** Same-origin Web settings routes for Grok Build OAuth. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  grokBuildAuthStatus,
  importGrokBuildSession,
  loginGrokBuildSession,
} from './auth.ts'
import type { CatalogSource } from './catalog.ts'
import { probeGrokAuth } from './grok-import.ts'
import { XAI_PI_PROVIDER } from './ids.ts'
import { loginGrokBuildPkce } from './oauth.ts'
import { safeMessage } from './redact.ts'
import type { GrokBuildSession } from './session.ts'

export const GROK_BUILD_AUTH_STATUS_PATH = '/plugins/dsh-grok-build/auth/status'
export const GROK_BUILD_AUTH_LOGIN_PATH = '/plugins/dsh-grok-build/auth/login'
export const GROK_BUILD_AUTH_LOGIN_CODE_PATH = '/plugins/dsh-grok-build/auth/login/code'
export const GROK_BUILD_AUTH_LOGIN_CANCEL_PATH = '/plugins/dsh-grok-build/auth/login/cancel'
export const GROK_BUILD_AUTH_IMPORT_PATH = '/plugins/dsh-grok-build/auth/import'
export const GROK_BUILD_AUTH_LOGOUT_PATH = '/plugins/dsh-grok-build/auth/logout'
export const GROK_BUILD_AUTH_MODELS_PATH = '/plugins/dsh-grok-build/auth/models'

export type GrokBuildLoginMethod = 'pkce' | 'device'

export type GrokBuildWebAuthStatus =
  | { status: 'signed-out'; grokImportAvailable: boolean }
  | {
    status: 'signing-in'
    method: GrokBuildLoginMethod
    url?: string
    userCode?: string
    grokImportAvailable: boolean
  }
  | {
    status: 'signed-in'
    models: string[]
    available: string[]
    selected: string[]
    catalogSource: CatalogSource
    catalogError?: string
    grokImportAvailable: boolean
  }
  | { status: 'error'; message: string; grokImportAvailable: boolean }

export interface LoginChallenge {
  method: GrokBuildLoginMethod
  url: string
  userCode?: string
}

function waitForPromptAbort(prompt: AuthPrompt): Promise<string> {
  const signal = prompt.signal
  if (signal === undefined) return new Promise<string>(() => {})
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<string>((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
  })
}

async function grokImportAvailable(): Promise<boolean> {
  return (await probeGrokAuth()).available
}

/**
 * One lifecycle owner for the pending login (PKCE or device), the published
 * challenge, the pasted-code channel, and the public status.
 */
export class GrokBuildWebAuth {
  private state: GrokBuildWebAuthStatus = { status: 'signed-out', grokImportAvailable: false }
  private operation: Promise<void> | undefined
  private cancellation: AbortController | undefined
  private method: GrokBuildLoginMethod = 'pkce'
  private challenge: LoginChallenge | undefined
  private challengeWaiters: Array<{ resolve(value: LoginChallenge): void; reject(error: unknown): void }> = []
  private codeResolver: ((code: string) => void) | undefined

  constructor(private readonly session: GrokBuildSession) {}

  async status(): Promise<GrokBuildWebAuthStatus> {
    if (this.operation !== undefined) return this.state
    if (this.state.status === 'error') {
      return { ...this.state, grokImportAvailable: await grokImportAvailable() }
    }
    return this.readStoredStatus()
  }

  /** Start (or join) a login. A different method aborts and restarts the flow. */
  async signIn(method: GrokBuildLoginMethod): Promise<LoginChallenge> {
    if (this.operation !== undefined && this.method !== method) {
      await this.cancel()
    }
    if (this.operation === undefined) this.start(method)
    if (this.challenge !== undefined) return this.challenge
    return new Promise<LoginChallenge>((resolve, reject) => {
      this.challengeWaiters.push({ resolve, reject })
    })
  }

  /** Hand a pasted authorization code (or redirect URL) to a pending PKCE login. */
  async submitCode(code: string): Promise<void> {
    const resolver = this.codeResolver
    if (resolver === undefined) {
      throw new Error('grok-build: no authorization-code login is waiting for a code')
    }
    this.codeResolver = undefined
    resolver(code)
  }

  /** Abort a pending login without touching any stored credential. */
  async cancel(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  async importGrok(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    await importGrokBuildSession(this.session)
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  async setModels(ids: readonly string[]): Promise<void> {
    await this.session.setSelectedModels(ids)
    this.state = await this.readStoredStatus()
  }

  async signOut(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    await this.session.logout()
    this.state = { status: 'signed-out', grokImportAvailable: await grokImportAvailable() }
    this.challenge = undefined
  }

  async dispose(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: plugin disposed'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
  }

  private start(method: GrokBuildLoginMethod): void {
    const cancellation = new AbortController()
    this.cancellation = cancellation
    this.method = method
    this.challenge = undefined
    this.state = { status: 'signing-in', method, grokImportAvailable: false }
    const run = method === 'pkce' ? this.runPkce(cancellation) : this.runDevice(cancellation)
    this.operation = run.then(
      async () => {
        this.state = await this.readStoredStatus()
      },
      (error: unknown) => {
        this.rejectChallenge(error)
        this.state = { status: 'error', message: safeMessage(error), grokImportAvailable: false }
      },
    ).finally(() => {
      this.operation = undefined
      this.cancellation = undefined
      this.codeResolver = undefined
    })
  }

  private async runPkce(cancellation: AbortController): Promise<void> {
    const credential = await loginGrokBuildPkce({
      signal: cancellation.signal,
      onAuthorizeUrl: url => this.acceptChallenge({ method: 'pkce', url }),
      awaitCode: signal => new Promise<string>((resolve, reject) => {
        this.codeResolver = resolve
        const onAbort = (): void => {
          this.codeResolver = undefined
          reject(new Error('grok-build: sign-in cancelled'))
        }
        if (signal.aborted) { onAbort(); return }
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    })
    const written = await this.session.store.modify(XAI_PI_PROVIDER, async () => credential)
    if (written === undefined || written.type !== 'oauth') {
      throw new Error('grok-build: failed to persist the login credential')
    }
    await this.session.refreshLiveCatalog()
  }

  private async runDevice(cancellation: AbortController): Promise<void> {
    await loginGrokBuildSession({
      signal: cancellation.signal,
      prompt: prompt => prompt.type === 'select'
        ? Promise.resolve(prompt.options.some(option => option.id === 'oauth') ? 'oauth' : prompt.options[0]?.id ?? 'oauth')
        : waitForPromptAbort(prompt),
      notify: event => { this.onEvent(event) },
    }, this.session)
  }

  private onEvent(event: AuthEvent): void {
    if (event.type === 'device_code') {
      this.acceptChallenge({
        method: 'device',
        url: event.verificationUri,
        ...event.userCode.length > 0 ? { userCode: event.userCode } : {},
      })
      return
    }
    if (event.type === 'auth_url') {
      this.acceptChallenge({ method: this.method, url: event.url })
    }
  }

  private acceptChallenge(challenge: LoginChallenge): void {
    try {
      const url = new URL(challenge.url)
      if (url.protocol !== 'https:') {
        const error = new Error('xAI returned an unsafe authorization URL')
        this.cancellation?.abort(error)
        this.rejectChallenge(error)
        return
      }
    } catch {
      const error = new Error('xAI returned an invalid authorization URL')
      this.cancellation?.abort(error)
      this.rejectChallenge(error)
      return
    }
    this.challenge = challenge
    this.state = {
      status: 'signing-in',
      method: challenge.method,
      url: challenge.url,
      grokImportAvailable: false,
      ...challenge.userCode === undefined ? {} : { userCode: challenge.userCode },
    }
    for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge)
  }

  private async readStoredStatus(): Promise<GrokBuildWebAuthStatus> {
    const [stored, grok] = await Promise.all([grokBuildAuthStatus(this.session.store), grokImportAvailable()])
    if (!stored.authenticated) return { status: 'signed-out', grokImportAvailable: grok }
    const available = this.session.availableModels().map(model => model.id)
    const selected = this.session.selectedModelIds()
    return {
      status: 'signed-in',
      models: this.session.visibleModels().map(model => model.id),
      available,
      selected: selected ?? available,
      catalogSource: this.session.catalogSource,
      grokImportAvailable: grok,
      ...this.session.catalogError === undefined ? {} : { catalogError: this.session.catalogError },
    }
  }

  private rejectChallenge(error: unknown): void {
    for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error)
  }
}

function trustedRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (host === undefined) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  return JSON.parse(text) as unknown
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function readLoginMethod(body: unknown): GrokBuildLoginMethod {
  if (typeof body === 'object' && body !== null && 'method' in body && body.method === 'device') return 'device'
  return 'pkce'
}

/** Register the plugin-owned OAuth routes when the Web server is composed. */
export function registerGrokBuildAuthRoutes(
  ctx: Context,
  session: GrokBuildSession,
): void {
  const auth = new GrokBuildWebAuth(session)
  ctx.effect(() => {
    const routes = [
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_STATUS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          json(res, 200, await auth.status())
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          try {
            json(res, 200, await auth.signIn(readLoginMethod(await readJson(req))))
          } catch (error: unknown) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_CODE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          try {
            const body = await readJson(req)
            const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined
            if (typeof code !== 'string' || code.trim().length === 0) {
              return json(res, 400, { error: 'code must be a non-empty string' })
            }
            await auth.submitCode(code)
            json(res, 200, { ok: true })
          } catch (error: unknown) {
            json(res, 409, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          await auth.cancel()
          json(res, 200, await auth.status())
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_IMPORT_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          try {
            await auth.importGrok()
            json(res, 200, await auth.status())
          } catch (error: unknown) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_MODELS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          try {
            const body = await readJson(req)
            const selected = typeof body === 'object' && body !== null && 'selected' in body
              ? body.selected
              : undefined
            if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string')) {
              return json(res, 400, { error: 'selected must be an array of model ids' })
            }
            await auth.setModels(selected)
            json(res, 200, await auth.status())
          } catch (error: unknown) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGOUT_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
          await auth.signOut()
          json(res, 200, { ok: true })
        },
      }),
    ]
    return async () => {
      for (const dispose of routes) dispose()
      await auth.dispose()
    }
  }, 'dsh-grok-build: Web OAuth routes')
}

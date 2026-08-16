/**
 * Scoped egress proxy for coding-subscription OAuth and inference traffic.
 * @module dsh-coding-subscription-oauth/proxy
 */

import { Dispatcher, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'

const DEFAULT_PROXIED_HOSTS = [
  'auth.x.ai',
  'cli-chat-proxy.grok.com',
  'auth.openai.com',
  'chatgpt.com',
  'claude.ai',
  'platform.claude.com',
  'api.anthropic.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'cloudcode-pa.googleapis.com',
  'www.googleapis.com',
] as const

const KIMI_PROXIED_HOSTS = ['auth.kimi.com', 'api.kimi.com'] as const

class CodingOAuthDispatcher extends Dispatcher {
  constructor(
    private readonly proxied: Dispatcher,
    private readonly fallback: Dispatcher,
    private readonly hosts: ReadonlySet<string>,
  ) {
    super()
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin = options.origin
    const host = origin instanceof URL
      ? origin.hostname
      : typeof origin === 'string'
        ? new URL(origin).hostname
        : ''
    if (this.hosts.has(host)) return this.proxied.dispatch(options, handler)
    return this.fallback.dispatch(options, handler)
  }

  override async close(): Promise<void> {
    await this.proxied.close()
  }

  override async destroy(): Promise<void> {
    await this.proxied.destroy()
  }
}

let installedProxy: string | undefined
let installed = false

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

export interface CodingOAuthProxyOptions {
  proxyKimi?: boolean
}

/** Install one process-wide dispatcher that proxies only the audited host list. */
export function ensureCodingOAuthProxy(
  explicit?: string,
  options: CodingOAuthProxyOptions = {},
): string | undefined {
  if (installed) return installedProxy
  const url = explicit ?? firstEnv([
    'CODING_OAUTH_PROXY',
    'GROK_BUILD_PROXY',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
  ])
  if (url === undefined) return undefined
  const hosts = new Set<string>(DEFAULT_PROXIED_HOSTS)
  if (options.proxyKimi === true) {
    for (const host of KIMI_PROXIED_HOSTS) hosts.add(host)
  }
  const fallback = getGlobalDispatcher()
  setGlobalDispatcher(new CodingOAuthDispatcher(new ProxyAgent(url), fallback, hosts))
  installed = true
  installedProxy = url
  return url
}

/** Backward-compatible name retained for existing callers. */
export function ensureGrokBuildProxy(explicit?: string): string | undefined {
  return ensureCodingOAuthProxy(explicit)
}

export function codingOAuthProxyInEffect(): string | undefined {
  return installedProxy
}

/** Backward-compatible status accessor. */
export function grokBuildProxyInEffect(): string | undefined {
  return codingOAuthProxyInEffect()
}

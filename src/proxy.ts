/**
 * Scoped egress proxy for Grok Build traffic.
 *
 * Node's global fetch ignores HTTP(S)_PROXY on every supported runtime, and
 * dsh installs no dispatcher of its own. Grok Build endpoints
 * (auth.x.ai / cli-chat-proxy.grok.com) are unreachable from some networks
 * without a proxy, so this module installs a process-wide undici dispatcher
 * that forwards ONLY those hosts through the configured proxy and leaves
 * every other request on the previous (direct) dispatcher.
 *
 * Proxy URL resolution order:
 *   explicit argument → GROK_BUILD_PROXY → HTTPS_PROXY → https_proxy
 *   → HTTP_PROXY → http_proxy
 * With no proxy configured the dispatcher is left untouched.
 * @module dsh-grok-build/proxy
 */

import { Dispatcher, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'

/** Origins that must traverse the proxy when one is configured. */
const PROXIED_HOSTS: readonly string[] = [
  'auth.x.ai',
  'cli-chat-proxy.grok.com',
]

class GrokBuildDispatcher extends Dispatcher {
  constructor(
    private readonly proxied: Dispatcher,
    private readonly fallback: Dispatcher,
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
    if (PROXIED_HOSTS.includes(host)) return this.proxied.dispatch(options, handler)
    return this.fallback.dispatch(options, handler)
  }

  override async close(): Promise<void> {
    // Never close the shared fallback dispatcher we captured at install time.
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

/**
 * Install the scoped dispatcher once. Returns the proxy URL in effect, or
 * undefined when no proxy is configured (traffic then stays fully direct).
 */
export function ensureGrokBuildProxy(explicit?: string): string | undefined {
  if (installed) return installedProxy
  const url = explicit ?? firstEnv([
    'GROK_BUILD_PROXY',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
  ])
  if (url === undefined) return undefined
  const fallback = getGlobalDispatcher()
  setGlobalDispatcher(new GrokBuildDispatcher(new ProxyAgent(url), fallback))
  installed = true
  installedProxy = url
  return url
}

/** The proxy URL installed by {@link ensureGrokBuildProxy}, if any. */
export function grokBuildProxyInEffect(): string | undefined {
  return installedProxy
}

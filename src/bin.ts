#!/usr/bin/env node
/** Standalone credential CLI for the Grok Build bundle. */

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import {
  GrokBuildSession,
  grokBuildAuthPath,
  grokBuildAuthStatus,
  importGrokBuildSession,
  loginGrokBuildSession,
} from './index.ts'
import { grokAuthPath } from './grok-import.ts'
import { ensureGrokBuildProxy, grokBuildProxyInEffect } from './proxy.ts'
import { safeMessage } from './redact.ts'

type Action = 'login' | 'logout' | 'status' | 'import'

function openBrowser(rawUrl: string): void {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error(`refusing to open non-HTTPS authorization URL from ${url.host}`)
  const command = process.platform === 'win32'
    ? { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url.href] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url.href] }
      : { file: 'xdg-open', args: [url.href] }
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The printed URL remains the manual fallback.
  }
}

function notify(event: AuthEvent, useBrowser: boolean): void {
  switch (event.type) {
    case 'auth_url':
      process.stdout.write(`Open this URL to sign in:\n${event.url}\n`)
      if (event.instructions !== undefined) process.stdout.write(`${event.instructions}\n`)
      if (useBrowser) openBrowser(event.url)
      break
    case 'device_code':
      process.stdout.write(`Open this URL to sign in:\n${event.verificationUri}\n`)
      if (event.userCode.length > 0) process.stdout.write(`Enter code: ${event.userCode}\n`)
      if (useBrowser) openBrowser(event.verificationUri)
      break
    case 'info':
    case 'progress':
      process.stdout.write(`${event.message}\n`)
      break
    default:
      event satisfies never
  }
}

async function answerPrompt(
  prompt: AuthPrompt,
  question: (text: string, options: { signal?: AbortSignal }) => Promise<string>,
): Promise<string> {
  if (prompt.type === 'select') {
    const oauth = prompt.options.find(option => option.id === 'oauth' || option.id.includes('oauth'))
    return oauth?.id ?? prompt.options[0]?.id ?? 'oauth'
  }
  const suffix = prompt.placeholder === undefined ? '' : ` (${prompt.placeholder})`
  return question(`${prompt.message}${suffix}: `, {
    ...prompt.signal === undefined ? {} : { signal: prompt.signal },
  })
}

function printHelp(): void {
  process.stdout.write([
    'Usage: dsh-grok-build <login|logout|status|import>',
    '',
    '  login   sign in with SuperGrok or X Premium (device code)',
    '  import  copy ~/.grok/auth.json into the dsh store (does not modify Grok CLI)',
    '  logout  remove the dsh credential without changing ~/.grok',
    '  status  report non-secret dsh credential state and visible models',
    '',
    'Network: auth.x.ai and cli-chat-proxy.grok.com need a proxy on some',
    'networks. Set GROK_BUILD_PROXY or HTTPS_PROXY (e.g. http://127.0.0.1:7890);',
    'only Grok Build / xAI auth hosts are routed through it.',
    '',
  ].join('\n'))
}

export async function run(argv: readonly string[]): Promise<number> {
  ensureGrokBuildProxy()
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return 0
  }
  const [rawAction, ...flags] = argv
  if (rawAction !== 'login' && rawAction !== 'logout' && rawAction !== 'status' && rawAction !== 'import') {
    process.stderr.write(`dsh-grok-build: expected login, logout, status, or import; got ${JSON.stringify(rawAction)}\n`)
    return 1
  }
  const action: Action = rawAction
  if (flags.length > 0) {
    process.stderr.write(`dsh-grok-build: invalid options for ${action}: ${flags.join(' ')}\n`)
    return 1
  }
  try {
    switch (action) {
      case 'status': {
        const session = new GrokBuildSession()
        await session.loadCachedCatalog()
        const status = await grokBuildAuthStatus(session.store)
        if (!status.authenticated) {
          process.stdout.write('Grok Build for dsh: signed out\n')
          return 1
        }
        await session.refreshLiveCatalog()
        const expires = status.expiresAt
        const suffix = expires === undefined || Number.isNaN(expires.valueOf())
          ? ''
          : `; access token expires ${expires.toISOString()} (refresh is automatic)`
        const models = session.visibleModels().map(model => model.id).join(', ')
        process.stdout.write(`Grok Build for dsh: signed in${suffix}\n`)
        process.stdout.write(`models (${session.catalogSource}): ${models}\n`)
        if (session.catalogError !== undefined) {
          process.stderr.write(`dsh-grok-build: live models-v2 failed: ${session.catalogError}\n`)
        }
        return 0
      }
      case 'logout':
        await new GrokBuildSession().logout()
        process.stdout.write(`Grok Build for dsh: signed out; removed ${grokBuildAuthPath()}\n`)
        return 0
      case 'import': {
        const session = new GrokBuildSession()
        await importGrokBuildSession(session)
        process.stdout.write(`Grok Build for dsh: imported ${grokAuthPath()} into ${grokBuildAuthPath()}\n`)
        process.stdout.write('The Grok CLI file was not modified. Later dsh refresh may rotate the token.\n')
        const models = session.visibleModels().map(model => model.id).join(', ')
        process.stdout.write(`models (${session.catalogSource}): ${models}\n`)
        return 0
      }
      case 'login': {
        const proxy = grokBuildProxyInEffect()
        if (proxy !== undefined) process.stdout.write(`Using proxy ${proxy} for xAI/Grok Build hosts\n`)
        const session = new GrokBuildSession()
        const readline = createInterface({ input: process.stdin, output: process.stdout })
        try {
          await loginGrokBuildSession({
            prompt: prompt => answerPrompt(prompt, (text, options) => readline.question(text, options)),
            notify: event => notify(event, true),
          }, session)
        } finally {
          readline.close()
        }
        process.stdout.write(`Grok Build for dsh: signed in; credentials saved to ${grokBuildAuthPath()}\n`)
        process.stdout.write(`models (${session.catalogSource}): ${session.visibleModels().map(model => model.id).join(', ')}\n`)
        return 0
      }
    }
  } catch (error: unknown) {
    process.stderr.write(`dsh-grok-build: ${action} failed: ${safeMessage(error)}\n`)
    return 1
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2))
}

/**
 * Owner-only persistent OAuth credential storage for the Grok Build route.
 * @module dsh-grok-build/store
 */

import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Credential, CredentialInfo, CredentialStore, OAuthCredential } from '@earendil-works/pi-ai'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { GROK_BUILD_AUTH_FILENAME, XAI_PI_PROVIDER } from './ids.ts'

/** Current on-disk format; readers reject every other version. */
const AUTH_FORMAT_VERSION = 1

interface AuthDocument {
  version: typeof AUTH_FORMAT_VERSION
  credential: OAuthCredential
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (isENOENT(error)) return
    throw error
  }
  if (process.platform === 'win32') return
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `grok-build: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
      + ` run "chmod 600 ${filename}" before starting again`,
    )
  }
}

function parseDocument(text: string, filename: string): AuthDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`grok-build: ${filename} is not valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`grok-build: ${filename} must contain an object`)
  }
  const document = value as Record<string, unknown>
  if (document['version'] !== AUTH_FORMAT_VERSION) {
    throw new Error(`grok-build: ${filename} has unsupported auth format version ${String(document['version'])}`)
  }
  if (Object.keys(document).some(key => key !== 'version' && key !== 'credential')) {
    throw new Error(`grok-build: ${filename} contains an unknown top-level field`)
  }
  const raw = document['credential']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`grok-build: ${filename} credential must be an object`)
  }
  const credential = raw as Record<string, unknown>
  const allowed = new Set(['type', 'access', 'refresh', 'expires', 'accountId'])
  if (Object.keys(credential).some(key => !allowed.has(key))) {
    throw new Error(`grok-build: ${filename} credential contains an unknown field`)
  }
  if (credential['type'] !== 'oauth') throw new Error(`grok-build: ${filename} credential type must be oauth`)
  for (const key of ['access', 'refresh'] as const) {
    if (typeof credential[key] !== 'string' || credential[key].length === 0) {
      throw new Error(`grok-build: ${filename} credential ${key} must be a non-empty string`)
    }
  }
  if (credential['accountId'] !== undefined && (typeof credential['accountId'] !== 'string' || credential['accountId'].length === 0)) {
    throw new Error(`grok-build: ${filename} credential accountId must be a non-empty string when present`)
  }
  if (typeof credential['expires'] !== 'number' || !Number.isFinite(credential['expires']) || credential['expires'] <= 0) {
    throw new Error(`grok-build: ${filename} credential expires must be a positive finite number`)
  }
  return { version: AUTH_FORMAT_VERSION, credential: credential as unknown as OAuthCredential }
}

function cloneCredential(credential: OAuthCredential): OAuthCredential {
  return structuredClone(credential)
}

/** Resolve the default OAuth document path. */
export function grokBuildAuthPath(dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), GROK_BUILD_AUTH_FILENAME))
}

/** File-backed pi-ai store scoped to the single xAI OAuth credential. */
export class GrokBuildCredentialStore implements CredentialStore {
  readonly filename: string

  constructor(filename: string = grokBuildAuthPath()) {
    this.filename = resolve(filename)
  }

  private async readCurrent(): Promise<OAuthCredential | undefined> {
    await assertOwnerOnly(this.filename)
    let text: string
    try {
      text = await readFile(this.filename, 'utf8')
    } catch (error) {
      if (isENOENT(error)) return undefined
      throw error
    }
    return cloneCredential(parseDocument(text, this.filename).credential)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === XAI_PI_PROVIDER ? this.readCurrent() : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return await this.readCurrent() === undefined
      ? []
      : [{ providerId: XAI_PI_PROVIDER, type: 'oauth' }]
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== XAI_PI_PROVIDER) {
      throw new Error(`grok-build: credential store does not own provider "${providerId}"`)
    }
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const current = await this.readCurrent()
      const candidate = await fn(current)
      if (candidate === undefined) return current
      const document = parseDocument(JSON.stringify({
        version: AUTH_FORMAT_VERSION,
        credential: candidate,
      }), this.filename)
      await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
      return cloneCredential(document.credential)
    })
  }

  async delete(providerId: string): Promise<void> {
    if (providerId !== XAI_PI_PROVIDER) return
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, () => rm(this.filename, { force: true }))
  }
}

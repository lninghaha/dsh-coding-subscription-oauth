/**
 * Persistent OAuth session and static model selection for one subscription provider.
 * @module dsh-coding-subscription-oauth/oauth-session
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import type { Api, AuthInteraction, Credential, Model, MutableModels, OAuthCredential, Provider } from '@earendil-works/pi-ai'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { OAuthProviderDefinition } from './oauth-providers.ts'
import { oauthCredentialPath, OAuthCredentialFileStore } from './store.ts'

const MODELS_CACHE_VERSION = 1

interface ModelsCacheDocument {
  version: typeof MODELS_CACHE_VERSION
  selected: string[]
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function parseCache(text: string): string[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const document = value as Record<string, unknown>
  if (document['version'] !== MODELS_CACHE_VERSION) return undefined
  const selected = parseIdList(document['selected'])
  return selected.length === 0 ? undefined : selected
}

export function oauthModelsCachePath(basename: string, dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), basename))
}

export interface OAuthProviderStatus {
  authenticated: boolean
  expiresAt?: number
}

export class OAuthProviderSession {
  readonly store: OAuthCredentialFileStore
  readonly models: MutableModels
  private readonly catalog: readonly Model<Api>[]
  private readonly cacheFile: string
  private selectedIds: string[] | undefined

  constructor(
    readonly definition: OAuthProviderDefinition,
    onCatalogChange?: () => void,
    store: OAuthCredentialFileStore = new OAuthCredentialFileStore(
      definition.nativeProviderId,
      oauthCredentialPath(definition.authFilename),
      definition.route,
    ),
    cacheFile: string = oauthModelsCachePath(definition.modelsCacheFilename),
  ) {
    this.store = store
    this.cacheFile = resolve(cacheFile)
    const provider = definition.providerFactory()
    this.catalog = [...provider.getModels()]
    this.models = createModels({ credentials: store })
    this.models.setProvider(provider)
    this.onCatalogChange = onCatalogChange
  }

  private onCatalogChange: (() => void) | undefined

  availableModels(): Model<Api>[] {
    return [...this.catalog]
  }

  selectedModelIds(): string[] | undefined {
    return this.selectedIds === undefined ? undefined : [...this.selectedIds]
  }

  visibleModels(): Model<Api>[] {
    if (this.selectedIds === undefined || this.selectedIds.length === 0) return this.availableModels()
    const byId = new Map(this.catalog.map(model => [model.id, model]))
    return this.selectedIds.flatMap(id => {
      const model = byId.get(id)
      return model === undefined ? [] : [model]
    })
  }

  provider(): Provider {
    return this.definition.requestProvider(this.visibleModels().map(model => model.id))
  }

  async loadCachedModels(): Promise<void> {
    try {
      this.selectedIds = parseCache(await readFile(this.cacheFile, 'utf8'))
    } catch (error) {
      if (!isENOENT(error)) throw error
    }
  }

  async setSelectedModels(ids: readonly string[]): Promise<void> {
    const available = new Set(this.catalog.map(model => model.id))
    const selected = [...new Set(ids.filter(id => available.has(id)))]
    this.selectedIds = selected.length === 0 ? undefined : selected
    await this.writeCache()
    this.onCatalogChange?.()
  }

  async status(): Promise<OAuthProviderStatus> {
    const credential = await this.store.read(this.definition.nativeProviderId)
    if (credential?.type !== 'oauth') return { authenticated: false }
    return { authenticated: true, expiresAt: credential.expires }
  }

  async login(interaction: AuthInteraction): Promise<Credential> {
    const credential = await this.models.login(this.definition.nativeProviderId, 'oauth', interaction)
    this.onCatalogChange?.()
    return credential
  }

  async resolveAccessToken(): Promise<string | undefined> {
    const resolved = await this.models.getAuth(this.definition.nativeProviderId)
    if (resolved === undefined) return undefined
    const credential = await this.store.read(this.definition.nativeProviderId)
    return credential?.type === 'oauth' ? credential.access : undefined
  }

  /**
   * Backdate the stored token's expiry so the next `getAuth()` refreshes.
   * Called after an upstream 401 rejected a locally-valid token.
   */
  async invalidateAccessToken(): Promise<void> {
    await this.store.invalidate(this.definition.nativeProviderId)
  }

  async storedCredential(): Promise<OAuthCredential | undefined> {
    const credential = await this.store.read(this.definition.nativeProviderId)
    return credential?.type === 'oauth' ? credential : undefined
  }

  async logout(): Promise<void> {
    try {
      await this.models.logout(this.definition.nativeProviderId)
      this.selectedIds = undefined
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
      await rm(this.cacheFile, { force: true })
    } finally {
      // Credential deletion may succeed before cache cleanup fails. Always
      // refresh discovery so an open selector cannot retain stale models.
      this.onCatalogChange?.()
    }
  }

  private async writeCache(): Promise<void> {
    const document: ModelsCacheDocument = {
      version: MODELS_CACHE_VERSION,
      selected: this.selectedIds === undefined ? [] : [...this.selectedIds],
    }
    await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.cacheFile, `${JSON.stringify(document)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}

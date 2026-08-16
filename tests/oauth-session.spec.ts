import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { KIMI_CODE_OAUTH_PROVIDER } from '../src/oauth-providers.ts'
import { OAuthProviderSession } from '../src/oauth-session.ts'
import { OAuthCredentialFileStore } from '../src/store.ts'

describe('OAuthProviderSession', () => {
  it('persists model selection and resolves the refreshed store token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-session-'))
    const authFile = join(dir, 'auth.json')
    const cacheFile = join(dir, 'models.json')
    const store = new OAuthCredentialFileStore(
      KIMI_CODE_OAUTH_PROVIDER.nativeProviderId,
      authFile,
      KIMI_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(KIMI_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'kimi-access',
      refresh: 'kimi-refresh',
      expires: Date.now() + 60_000,
    }))
    const first = new OAuthProviderSession(KIMI_CODE_OAUTH_PROVIDER, undefined, store, cacheFile)
    const chosen = first.availableModels()[0]!
    await first.setSelectedModels([chosen.id])
    expect(first.visibleModels().map(model => model.id)).toEqual([chosen.id])
    expect(await first.resolveAccessToken()).toBe('kimi-access')

    const second = new OAuthProviderSession(KIMI_CODE_OAUTH_PROVIDER, undefined, store, cacheFile)
    await second.loadCachedModels()
    expect(second.selectedModelIds()).toEqual([chosen.id])
    expect(second.provider().id).toBe(KIMI_CODE_OAUTH_PROVIDER.nativeProviderId)
  })

  it('notifies the LLM registry after a successful login', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-login-notify-'))
    const notify = vi.fn()
    const session = new OAuthProviderSession(
      KIMI_CODE_OAUTH_PROVIDER,
      notify,
      new OAuthCredentialFileStore(
        KIMI_CODE_OAUTH_PROVIDER.nativeProviderId,
        join(dir, 'auth.json'),
        KIMI_CODE_OAUTH_PROVIDER.route,
      ),
      join(dir, 'models.json'),
    )
    vi.spyOn(session.models, 'login').mockResolvedValue({
      type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60_000,
    })
    await session.login({ prompt: async () => '', notify: () => {} })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('deletes only its credential and cache on logout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-logout-'))
    const store = new OAuthCredentialFileStore(
      KIMI_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      KIMI_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(KIMI_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60_000,
    }))
    const notify = vi.fn()
    const session = new OAuthProviderSession(KIMI_CODE_OAUTH_PROVIDER, notify, store, join(dir, 'models.json'))
    await session.logout()
    expect(await session.status()).toEqual({ authenticated: false })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('notifies discovery when cache cleanup fails after credential deletion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-logout-cleanup-failure-'))
    const store = new OAuthCredentialFileStore(
      KIMI_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      KIMI_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(KIMI_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60_000,
    }))
    const blockedParent = join(dir, 'not-a-directory')
    await writeFile(blockedParent, 'blocked')
    const notify = vi.fn()
    const session = new OAuthProviderSession(
      KIMI_CODE_OAUTH_PROVIDER,
      notify,
      store,
      join(blockedParent, 'models.json'),
    )
    await expect(session.logout()).rejects.toThrow()
    expect(await session.status()).toEqual({ authenticated: false })
    expect(notify).toHaveBeenCalledOnce()
  })
})

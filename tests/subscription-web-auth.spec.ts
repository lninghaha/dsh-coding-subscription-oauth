import { setImmediate as waitImmediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { AuthInteraction, Credential, Model } from '@earendil-works/pi-ai'
import { SubscriptionWebAuth } from '../src/auth-routes.ts'
import { CODEX_OAUTH_PROVIDER } from '../src/oauth-providers.ts'
import type { OAuthProviderSession } from '../src/oauth-session.ts'

function fakeModel(): Model<'openai-codex-responses'> {
  return CODEX_OAUTH_PROVIDER.providerFactory().getModels()[0] as Model<'openai-codex-responses'>
}

function fakeSession(login: (interaction: AuthInteraction) => Promise<Credential>): OAuthProviderSession {
  let authenticated = false
  const model = fakeModel()
  return {
    definition: CODEX_OAUTH_PROVIDER,
    availableModels: () => [model],
    visibleModels: () => [model],
    selectedModelIds: () => undefined,
    status: async () => ({ authenticated }),
    login: async (interaction: AuthInteraction) => {
      const credential = await login(interaction)
      authenticated = true
      return credential
    },
    setSelectedModels: async () => {},
    logout: async () => { authenticated = false },
  } as unknown as OAuthProviderSession
}

const credential: Credential = {
  type: 'oauth', access: 'secret-access', refresh: 'secret-refresh', expires: Date.now() + 60_000,
}

describe('SubscriptionWebAuth', () => {
  it('answers the Codex select prompt with device_code and publishes a device challenge', async () => {
    let selected = ''
    const session = fakeSession(async interaction => {
      selected = await interaction.prompt({
        type: 'select',
        message: 'method',
        options: [
          { id: 'browser', label: 'Browser login' },
          { id: 'device_code', label: 'Device code login' },
        ],
      })
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.example/device',
      })
      await new Promise<void>((_resolve, reject) => {
        interaction.signal?.addEventListener('abort', () => reject(interaction.signal?.reason), { once: true })
      })
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    const challenge = await auth.signIn('device')
    expect(selected).toBe('device_code')
    expect(challenge).toEqual({
      method: 'device', url: 'https://auth.example/device', userCode: 'ABCD-EFGH',
    })
    await auth.cancel()
  })

  it('accepts a pasted browser redirect without exposing credentials in status', async () => {
    let pasted = ''
    const session = fakeSession(async interaction => {
      const selected = await interaction.prompt({
        type: 'select',
        message: 'method',
        options: [{ id: 'browser', label: 'Browser login' }],
      })
      expect(selected).toBe('browser')
      interaction.notify({ type: 'auth_url', url: 'https://auth.example/authorize' })
      pasted = await interaction.prompt({ type: 'manual_code', message: 'paste redirect' })
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    expect(await auth.signIn('browser')).toEqual({
      method: 'browser', url: 'https://auth.example/authorize',
    })
    await auth.submitCode('http://localhost:1455/auth/callback?code=abc')
    await waitImmediate()
    expect(pasted).toContain('code=abc')
    const status = await auth.status()
    expect(status.status).toBe('signed-in')
    expect(JSON.stringify(status)).not.toContain('secret-access')
    expect(JSON.stringify(status)).not.toContain('secret-refresh')
  })

  it('times out and aborts a provider that never emits an OAuth challenge', async () => {
    const session = fakeSession(async interaction => new Promise<Credential>((_resolve, reject) => {
      interaction.signal?.addEventListener('abort', () => reject(interaction.signal?.reason), { once: true })
    }))
    const auth = new SubscriptionWebAuth(session, 5)
    await expect(auth.signIn('device')).rejects.toThrow(/timed out waiting/)
    await waitImmediate()
    expect((await auth.status()).status).toBe('signed-out')
  })

  it('turns a credential-store failure into a provider-local error status', async () => {
    const session = fakeSession(async () => credential)
    ;(session as unknown as { status(): Promise<never> }).status = async () => {
      throw new Error('Authorization: Bearer credential-secret')
    }
    const status = await new SubscriptionWebAuth(session).status()
    expect(status.status).toBe('error')
    expect(JSON.stringify(status)).not.toContain('credential-secret')
  })

  it('rejects unsupported login methods before starting OAuth', async () => {
    const auth = new SubscriptionWebAuth(fakeSession(async () => credential))
    await expect(auth.signIn('pkce' as never)).rejects.toThrow(/not supported/)
    await auth.dispose()
  })
})

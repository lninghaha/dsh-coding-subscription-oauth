/** Plugin-owned Grok Build account section inside the dsh Settings shell. */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GrokBuildSettingsKey } from './locales.ts'

const STATUS_PATH = '/plugins/dsh-grok-build/auth/status'
const LOGIN_PATH = '/plugins/dsh-grok-build/auth/login'
const LOGIN_CODE_PATH = '/plugins/dsh-grok-build/auth/login/code'
const LOGIN_CANCEL_PATH = '/plugins/dsh-grok-build/auth/login/cancel'
const IMPORT_PATH = '/plugins/dsh-grok-build/auth/import'
const LOGOUT_PATH = '/plugins/dsh-grok-build/auth/logout'
const MODELS_PATH = '/plugins/dsh-grok-build/auth/models'
const POLL_INTERVAL_MS = 1_000

type LoginMethod = 'pkce' | 'device'
type CatalogSource = 'live' | 'cache' | 'fallback'

type AccountStatus =
  | { status: 'loading' }
  | { status: 'signed-out'; grokImportAvailable?: boolean }
  | { status: 'signing-in'; method?: LoginMethod; url?: string; userCode?: string; grokImportAvailable?: boolean }
  | {
    status: 'signed-in'
    models?: string[]
    available?: string[]
    selected?: string[]
    catalogSource?: CatalogSource
    catalogError?: string
    grokImportAvailable?: boolean
  }
  | { status: 'error'; message: string; grokImportAvailable?: boolean }

interface LoginChallenge {
  method: LoginMethod
  url: string
  userCode?: string
}

export interface GrokBuildSettingsInjected {
  t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string
}

export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }
const titleStyle: CSSProperties = { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const bodyStyle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' }
const cardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }
const statusStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const buttonStyle: CSSProperties = { boxSizing: 'border-box', minHeight: 34, padding: '6px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 18, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 14, cursor: 'pointer' }
const primaryButtonStyle: CSSProperties = { ...buttonStyle, borderColor: 'var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'white' }
const errorStyle: CSSProperties = { ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }
const codeStyle: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 20, letterSpacing: '0.08em', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const linkStyle: CSSProperties = { color: 'var(--dsw-alias-brand-primary)', wordBreak: 'break-all' }
const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }
const checkRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const inputStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', minHeight: 34, padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13 }

function dotStyle(status: AccountStatus['status']): CSSProperties {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : status === 'signing-in' || status === 'loading'
        ? 'var(--dsw-alias-brand-primary, #1677ff)'
        : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: color }
}

async function jsonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...body === undefined ? {} : { 'content-type': 'application/json' } },
    credentials: 'same-origin',
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return value as T
}

/** Grok Build account status and OAuth actions. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
  if (t === undefined) throw new Error('Grok Build settings requires its translation function')
  const [status, setStatus] = useState<AccountStatus>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setStatus(await jsonRequest<AccountStatus>(STATUS_PATH))
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (status.status !== 'signing-in') return
    const timer = window.setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [refresh, status.status])

  const signIn = async (method: LoginMethod): Promise<void> => {
    const popup = window.open('about:blank', '_blank')
    if (popup !== null) popup.opener = null
    setBusy(true)
    setCodeError(undefined)
    setStatus({ status: 'signing-in', method })
    try {
      const challenge = await jsonRequest<LoginChallenge>(LOGIN_PATH, 'POST', { method })
      if (popup === null) {
        setStatus({ status: 'signing-in', method: challenge.method, url: challenge.url, ...challenge.userCode === undefined ? {} : { userCode: challenge.userCode } })
        return
      }
      popup.location.replace(challenge.url)
      setStatus({ status: 'signing-in', method: challenge.method, url: challenge.url, ...challenge.userCode === undefined ? {} : { userCode: challenge.userCode } })
    } catch (error: unknown) {
      popup?.close()
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (): Promise<void> => {
    const code = codeInput.trim()
    if (code.length === 0) return
    setBusy(true)
    setCodeError(undefined)
    try {
      await jsonRequest<{ ok: true }>(LOGIN_CODE_PATH, 'POST', { code })
      setCodeInput('')
      await refresh()
    } catch (error: unknown) {
      setCodeError(error instanceof Error ? error.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelLogin = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await jsonRequest<AccountStatus>(LOGIN_CANCEL_PATH, 'POST'))
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const importGrok = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await jsonRequest<AccountStatus>(IMPORT_PATH, 'POST'))
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const saveModels = async (selected: string[]): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await jsonRequest<AccountStatus>(MODELS_PATH, 'POST', { selected }))
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await jsonRequest<{ ok: true }>(LOGOUT_PATH, 'POST')
      setStatus({ status: 'signed-out' })
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const label = status.status === 'signed-in'
    ? t('signedIn')
    : status.status === 'loading'
      ? t('loadingAccount')
      : status.status === 'signing-in'
        ? t('signingIn')
        : status.status === 'error'
          ? t('requestFailed')
          : t('signedOut')

  const signingInMethod: LoginMethod = status.status === 'signing-in' && status.method === 'device' ? 'device' : 'pkce'

  return (
    <section style={pageStyle} aria-labelledby="grok-build-settings-title">
      <div>
        <h2 id="grok-build-settings-title" style={titleStyle}>{t('title')}</h2>
        <p style={{ ...bodyStyle, marginTop: 6 }}>{t('intro')}</p>
      </div>
      <div style={cardStyle}>
        <div style={rowStyle}>
          <div style={statusStyle} role="status">
            <span aria-hidden="true" style={dotStyle(status.status)} />
            <span>{label}</span>
          </div>
          {status.status === 'loading'
            ? null
            : status.status === 'signed-in'
              ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void signOut() }}>{busy ? t('working') : t('logout')}</button>
              : status.status === 'signing-in'
                ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void signIn(signingInMethod === 'pkce' ? 'device' : 'pkce') }}>
                        {signingInMethod === 'pkce' ? t('useDevice') : t('usePkce')}
                      </button>
                      <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void cancelLogin() }}>{t('cancelLogin')}</button>
                    </div>
                  )
                : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => { void signIn('pkce') }}>{busy ? t('working') : status.status === 'error' ? t('loginAgain') : t('login')}</button>
                      {status.grokImportAvailable === true
                        ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void importGrok() }}>{t('importGrok')}</button>
                        : null}
                    </div>
                  )}
        </div>
        {status.status === 'error' ? <p style={errorStyle}>{status.message}</p> : null}
        {status.status !== 'signed-in' && status.status !== 'loading' && status.grokImportAvailable === true
          ? <p style={bodyStyle}>{t('importHint')}</p>
          : null}
        {status.status === 'signed-in'
          ? (
              <div>
                <div style={rowStyle}>
                  <h3 style={{ ...titleStyle, fontSize: 14 }}>{t('models')}</h3>
                  <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void saveModels([]) }}>{t('selectAll')}</button>
                </div>
                <p style={bodyStyle}>
                  {status.catalogSource === 'live' ? t('catalogLive')
                    : status.catalogSource === 'cache' ? t('catalogCache')
                      : t('catalogFallback')}
                </p>
                <p style={bodyStyle}>{t('modelHint')}</p>
                <ul style={listStyle}>
                  {(status.available ?? status.models ?? []).map(id => {
                    const checked = (status.selected ?? status.models ?? []).includes(id)
                    return (
                      <li key={id}>
                        <label style={checkRowStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => {
                              const current = new Set(status.selected ?? status.available ?? [])
                              if (checked) current.delete(id)
                              else current.add(id)
                              void saveModels([...current])
                            }}
                          />
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{id}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {status.catalogError === undefined ? null : <p style={errorStyle}>{t('catalogError')}</p>}
              </div>
            )
          : null}
        {status.status === 'signing-in' && signingInMethod === 'device' && status.userCode !== undefined
          ? <p style={bodyStyle}>{t('userCode')} <span style={codeStyle}>{status.userCode}</span></p>
          : null}
        {status.status === 'signing-in' && status.url !== undefined
          ? (
              <p style={bodyStyle}>
                {t(status.userCode === undefined && window.open === undefined ? 'popupBlocked' : 'openUrl')}
                {' '}
                <a href={status.url} target="_blank" rel="noreferrer" style={linkStyle}>{status.url}</a>
              </p>
            )
          : null}
        {status.status === 'signing-in' && signingInMethod === 'pkce'
          ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={bodyStyle}>{t('pasteCodeHint')}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={inputStyle}
                    value={codeInput}
                    placeholder={t('pasteCodePlaceholder')}
                    disabled={busy}
                    onChange={event => setCodeInput(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitCode() } }}
                  />
                  <button type="button" style={primaryButtonStyle} disabled={busy || codeInput.trim().length === 0} onClick={() => { void submitCode() }}>
                    {t('submitCode')}
                  </button>
                </div>
                {codeError === undefined ? null : <p style={errorStyle}>{codeError}</p>}
              </div>
            )
          : null}
      </div>
    </section>
  )
}

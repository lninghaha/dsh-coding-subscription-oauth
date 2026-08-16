import { describe, expect, it } from 'vitest'
import { safeMessage } from '../src/redact.ts'

describe('safeMessage', () => {
  it('redacts jwt-shaped tokens and oauth query values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart'
    expect(safeMessage(new Error(`failed ${jwt} access_token=abc.def refresh_token=xyz`))).toBe(
      'failed [redacted token] access_token=[redacted] refresh_token=[redacted]',
    )
  })

  it('redacts pasted authorization codes', () => {
    expect(safeMessage(new Error('exchange failed for code=abc123def&state=x'))).toBe(
      'exchange failed for code=[redacted]&state=x',
    )
  })

  it('redacts Claude OAuth and bearer tokens in text or JSON', () => {
    expect(safeMessage('Authorization: Bearer kimi-secret access_token":"json-secret" sk-ant-oat01-secret')).toBe(
      'Authorization: Bearer [redacted] access_token":"[redacted]" [redacted token]',
    )
  })

  it('caps diagnostic length', () => {
    expect(safeMessage('x'.repeat(2000)).length).toBe(1000)
  })
})

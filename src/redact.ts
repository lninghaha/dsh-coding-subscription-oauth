/** Remove token-like strings from an external OAuth diagnostic. */
export function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/\bsk-ant-oat[A-Za-z0-9_-]*\b/giu, '[redacted token]')
    .replace(/(\bBearer\s+)[^\s"',}]+/giu, '$1[redacted]')
    .replace(/(\b(?:code|user_code|token|id_token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/(["']?(?:code|user_code|id_token|refresh_token|access_token)["']?\s*:\s*["'])[^"']+/giu, '$1[redacted]')
    .slice(0, 1000)
}

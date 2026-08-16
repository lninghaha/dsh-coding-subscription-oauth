import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('bundle composition', () => {
  it('inserts the grok-build host plugin and a Grok Build default model', async () => {
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('provider: grok-build')
    expect(patch).toMatch(/model: grok-4\./)
    expect(patch).toContain('id: llm-grok-build-oauth')
    expect(patch).toContain('name: dsh-grok-build')
  })

  it('declares a dsh bundle and web client half', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name: string
      dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
      exports: Record<string, unknown>
    }
    expect(manifest.name).toBe('dsh-grok-build')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    expect(manifest.exports['./client']).toBe('./lib/client.js')
  })
})

import { describe, expect, it } from 'vitest'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { AliasLlmAdapter } from '../src/alias-adapter.ts'

class FakeAdapter extends LlmAdapter {
  seenProvider: string | undefined
  seenOptions: GenerateOptions | undefined

  constructor(private readonly chunks: readonly StreamChunk[] = []) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: `Native ${provider}` }
  }

  listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'm1', name: 'Model 1', inputModalities: ['text'] }])
  }

  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seenProvider = options.provider
    this.seenOptions = options
    yield* this.chunks
  }
}

describe('AliasLlmAdapter', () => {
  it('maps public route metadata while preserving native dispatch', async () => {
    const inner = new FakeAdapter()
    const adapter = new AliasLlmAdapter(inner, new Map([['codex-oauth', 'openai-codex']]))

    expect(adapter.providerInfo('codex-oauth')).toEqual({
      id: 'codex-oauth',
      name: 'Native openai-codex',
    })
    expect(await adapter.listModels('codex-oauth')).toEqual([{
      provider: 'codex-oauth', id: 'm1', name: 'Model 1', inputModalities: ['text'],
    }])
    expect(await adapter.resolveModel('codex-oauth', 'm1')).toMatchObject({
      provider: 'codex-oauth', id: 'm1',
    })

    for await (const _chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'm1',
      messages: [],
    } as unknown as GenerateOptions)) {
      // Empty fake stream.
    }
    expect(inner.seenProvider).toBe('openai-codex')
  })

  it('normalizes pi-ai replay state at both alias boundaries', async () => {
    const inner = new FakeAdapter([{
      type: 'finish',
      reason: { kind: 'stop' },
      replayState: { kind: 'pi-ai', version: 1, provider: 'openai-codex', model: 'm1' },
    }])
    const adapter = new AliasLlmAdapter(inner, new Map([
      ['codex-oauth', 'openai-codex'],
      ['kimi-code-oauth', 'kimi-coding'],
    ]))
    const sameRouteReplay = { kind: 'pi-ai', version: 1, provider: 'openai-codex', model: 'm1' }
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'first reply' }],
      source: { kind: 'model', provider: 'codex-oauth', model: 'm1', replayState: sameRouteReplay },
    }, {
      id: 'assistant-2',
      role: 'assistant',
      content: [{ type: 'text', text: 'foreign reply' }],
      source: {
        kind: 'model', provider: 'kimi-code-oauth', model: 'k3',
        replayState: { kind: 'pi-ai', version: 1, provider: 'kimi-coding', model: 'k3' },
      },
    }] as unknown as GenerateOptions['messages']

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth', model: 'm1', messages,
    } as unknown as GenerateOptions)) chunks.push(chunk)

    expect(inner.seenProvider).toBe('openai-codex')
    expect(inner.seenOptions?.messages[0]?.source).toMatchObject({
      provider: 'codex-oauth',
      replayState: { kind: 'pi-ai', provider: 'codex-oauth', model: 'm1' },
    })
    expect(inner.seenOptions?.messages[1]?.source).not.toHaveProperty('replayState')
    expect(chunks).toMatchObject([{
      type: 'finish',
      replayState: { kind: 'pi-ai', provider: 'codex-oauth', model: 'm1' },
    }])
    expect(sameRouteReplay.provider).toBe('openai-codex')
  })

  it('hides unauthenticated models and labels visible providers as OAuth', async () => {
    let authenticated = false
    const adapter = new AliasLlmAdapter(
      new FakeAdapter(),
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([['codex-oauth', {
        displayName: 'OpenAI Codex (OAuth)',
        isAuthenticated: async () => authenticated,
      }]]),
    )
    expect(adapter.providerInfo('codex-oauth').name).toBe('OpenAI Codex (OAuth)')
    expect(await adapter.listModels('codex-oauth')).toEqual([])
    authenticated = true
    expect(await adapter.listModels('codex-oauth')).toMatchObject([{
      provider: 'codex-oauth', id: 'm1',
    }])
  })

  it('treats credential-read failures as unauthenticated for discovery', async () => {
    const adapter = new AliasLlmAdapter(
      new FakeAdapter(),
      new Map([['claude-code-oauth', 'anthropic']]),
      new Map([['claude-code-oauth', {
        isAuthenticated: async () => { throw new Error('corrupt credential') },
      }]]),
    )
    expect(await adapter.listModels('claude-code-oauth')).toEqual([])
  })

  it('fails loudly for an unowned route', () => {
    const adapter = new AliasLlmAdapter(new FakeAdapter(), new Map())
    expect(() => adapter.providerInfo('unknown')).toThrow(/does not own provider/)
  })

  it('invokes onAuthFailure once for an AUTH finish and passes the chunk through', async () => {
    const authFailure: StreamChunk = {
      type: 'finish',
      reason: { kind: 'error', failure: { message: '401 authentication_error', code: 'AUTH' } },
    }
    const inner = new FakeAdapter([
      { type: 'text-delta', index: 0, text: 'partial' } as StreamChunk,
      authFailure,
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['kimi-code-oauth', 'kimi-coding']]),
      new Map([['kimi-code-oauth', { onAuthFailure: async () => { calls += 1 } }]]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'kimi-code-oauth', model: 'k3', messages: [],
    } as unknown as GenerateOptions)) {
      seen.push(chunk)
    }
    expect(calls).toBe(1)
    expect(seen[seen.length - 1]).toEqual(authFailure)
  })

  it('invalidates AUTH finishes before rewriting replay state', async () => {
    const inner = new FakeAdapter([{
      type: 'finish',
      reason: { kind: 'error', failure: { message: '401 authentication_error', code: 'AUTH' } },
      replayState: { kind: 'pi-ai', version: 1, provider: 'openai-codex', model: 'gpt' },
    }])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([['codex-oauth', { onAuthFailure: async () => { calls += 1 } }]]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth', model: 'gpt', messages: [],
    } as unknown as GenerateOptions)) {
      seen.push(chunk)
    }
    expect(calls).toBe(1)
    expect(seen).toMatchObject([{
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH' } },
      replayState: { kind: 'pi-ai', provider: 'codex-oauth', model: 'gpt' },
    }])
  })

  it('does not invoke onAuthFailure for non-AUTH finishes or other routes', async () => {
    const inner = new FakeAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: '429 slow down', code: 'RATE_LIMIT' } } },
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['kimi-code-oauth', 'kimi-coding']]),
      new Map([['kimi-code-oauth', { onAuthFailure: async () => { calls += 1 } }]]),
    )
    for await (const _chunk of adapter.stream({
      provider: 'kimi-code-oauth', model: 'k3', messages: [],
    } as unknown as GenerateOptions)) {
      // Drain the stream.
    }
    expect(calls).toBe(0)
  })

  it('swallows onAuthFailure errors so the original AUTH failure surfaces', async () => {
    const inner = new FakeAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: '401', code: 'AUTH' } } },
    ])
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([['codex-oauth', { onAuthFailure: async () => { throw new Error('store locked') } }]]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth', model: 'gpt', messages: [],
    } as unknown as GenerateOptions)) {
      seen.push(chunk)
    }
    expect(seen[seen.length - 1]).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } },
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  extractModelIds,
  materializeLiveModel,
  mergeLiveCatalog,
  preferredGrokBuildModelFrom,
} from '../src/catalog.ts'
import { GROK_BUILD_ROUTE } from '../src/ids.ts'
import { grokBuildBaselineModels } from '../src/provider.ts'

const catalog = grokBuildBaselineModels()

describe('extractModelIds', () => {
  it('reads OpenAI-shaped data arrays', () => {
    expect(extractModelIds({ data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }, { object: 'model' }] })).toEqual([
      'grok-4.6',
      'grok-4.5',
    ])
  })

  it('accepts a bare string list and a models field', () => {
    expect(extractModelIds(['grok-4.6', 'grok-4.6'])).toEqual(['grok-4.6'])
    expect(extractModelIds({ models: [{ id: 'grok-4.20-multi-agent' }] })).toEqual(['grok-4.20-multi-agent'])
  })

  it('returns an empty list for unrecognized envelopes', () => {
    expect(extractModelIds({ unexpected: true })).toEqual([])
  })
})

describe('mergeLiveCatalog', () => {
  it('keeps the baseline catalog when live ids are missing', () => {
    expect(mergeLiveCatalog(catalog, undefined).map(model => model.id)).toEqual(catalog.map(model => model.id))
    expect(mergeLiveCatalog(catalog, []).map(model => model.id)).toEqual(catalog.map(model => model.id))
  })

  it('narrows to live ids and inherits baseline metadata', () => {
    const merged = mergeLiveCatalog(catalog, ['grok-4.5', 'grok-4.6'])
    expect(merged.map(model => model.id)).toEqual(['grok-4.5', 'grok-4.6'])
    const known = merged.find(model => model.id === 'grok-4.5')
    const extra = merged.find(model => model.id === 'grok-4.6')
    expect(known?.api).toBe('openai-responses')
    expect(extra?.api).toBe('openai-responses')
    expect(extra?.name).toBe('Grok 4.6')
    // Materialized reasoning models inherit the no-"none"-effort guard.
    expect(extra?.reasoning).toBe(true)
    expect(extra?.thinkingLevelMap?.off).toBeNull()
  })
})

describe('materializeLiveModel', () => {
  it('uses the composer template for fast/composer ids', () => {
    const model = materializeLiveModel('grok-composer-2.5-fast', catalog)
    expect(model.reasoning).toBe(false)
    expect(model.contextWindow).toBe(200_000)
  })

  it('defaults unknown ids to the grok-4.5 template on the grok-build route', () => {
    const model = materializeLiveModel('grok-9-future', catalog)
    expect(model.provider).toBe(GROK_BUILD_ROUTE)
    expect(model.api).toBe('openai-responses')
    expect(model.name).toBe('Grok 9 Future')
  })
})

describe('preferredGrokBuildModelFrom', () => {
  it('prefers grok-4.5, then the first listed model', () => {
    expect(preferredGrokBuildModelFrom([{ id: 'grok-4.6' }, { id: 'grok-4.5' }])).toBe('grok-4.5')
    expect(preferredGrokBuildModelFrom([{ id: 'grok-4.6' }])).toBe('grok-4.6')
  })
})

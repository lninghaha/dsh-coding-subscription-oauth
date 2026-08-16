/**
 * Account-specific Grok Build catalog: live GET /v1/models-v2 merged onto the
 * static baseline descriptors. Failures keep the last good list, then the
 * static baseline.
 * @module dsh-grok-build/catalog
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import { DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_ROUTE } from './ids.ts'
import { grokBuildBaselineModels, GROK_BUILD_MODELS_URL, grokBuildFingerprintHeaders } from './provider.ts'

const BODY_LIMIT_BYTES = 4 * 1024 * 1024

export type CatalogSource = 'live' | 'cache' | 'fallback'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Pull model ids from a listing body. The `/v1/models-v2` response shape is
 * not a published contract, so accept the common envelopes: a bare array, an
 * OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
 * ids or objects with an `id` field.
 */
export function extractModelIds(body: unknown): string[] {
  const rows = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body['data'])
      ? body['data']
      : isRecord(body) && Array.isArray(body['models'])
        ? body['models']
        : []
  const ids: string[] = []
  for (const row of rows) {
    if (typeof row === 'string' && row.length > 0) ids.push(row)
    else if (isRecord(row) && typeof row['id'] === 'string' && row['id'].length > 0) ids.push(row['id'])
  }
  return [...new Set(ids)]
}

function titleCaseId(id: string): string {
  return id
    .split(/[-_]/g)
    .map(part => part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1))
    .join(' ')
}

function catalogModels(baseline: readonly Model<Api>[] = grokBuildBaselineModels()): readonly Model<Api>[] {
  return baseline
}

function templateFor(id: string, catalog: readonly Model<Api>[]): Model<Api> {
  const exact = catalog.find(model => model.id === id)
  if (exact !== undefined) return exact
  const lower = id.toLowerCase()
  const fallback = catalog.find(model => model.id === DEFAULT_GROK_BUILD_MODEL) ?? catalog[0]
  if (fallback === undefined) throw new Error('grok-build: baseline catalog is empty')
  if (lower.includes('composer') || lower.includes('fast')) {
    return catalog.find(model => model.id === 'grok-composer-2.5-fast') ?? fallback
  }
  return fallback
}

/** Turn a live id into a pi-ai model, inheriting baseline metadata when possible. */
export function materializeLiveModel(id: string, catalog: readonly Model<Api>[] = catalogModels()): Model<Api> {
  const template = templateFor(id, catalog)
  if (template.id === id) return template
  return { ...template, id, name: titleCaseId(id) }
}

/**
 * If `liveIds` is missing or empty, serve the baseline catalog.
 * Otherwise serve only the live ids, each materialized against the baseline.
 */
export function mergeLiveCatalog(
  catalog: readonly Model<Api>[],
  liveIds: readonly string[] | undefined,
): Model<Api>[] {
  if (liveIds === undefined || liveIds.length === 0) return [...catalog]
  return liveIds.map(id => materializeLiveModel(id, catalog))
}

export function preferredGrokBuildModelFrom(models: readonly { id: string }[]): string {
  const ids = new Set(models.map(model => model.id))
  if (ids.has(DEFAULT_GROK_BUILD_MODEL)) return DEFAULT_GROK_BUILD_MODEL
  return models[0]?.id ?? DEFAULT_GROK_BUILD_MODEL
}

/**
 * Fetch the account-visible model ids from `/v1/models-v2` with the CLI
 * fingerprint headers. Throws a secret-free error on failure.
 */
export async function fetchLiveModelIds(
  accessToken: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let response: Response
  try {
    response = await fetch(GROK_BUILD_MODELS_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...grokBuildFingerprintHeaders(),
      },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('Live model listing was cancelled')
    throw new Error('Grok Build model listing is unreachable (proxy required on some networks)')
  }
  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > BODY_LIMIT_BYTES) {
    throw new Error('Grok Build model listing exceeded the 4 MiB read ceiling')
  }
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error(`Grok Build model listing returned invalid JSON (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const code = isRecord(body) && typeof body['error'] === 'string' ? body['error'] : undefined
    throw new Error(`Grok Build model listing failed (HTTP ${response.status})${code === undefined ? '' : `: ${code}`}`)
  }
  const ids = extractModelIds(body)
  if (ids.length === 0) throw new Error('Grok Build model listing contained no model ids')
  return ids
}

/** Re-exported so callers can normalise cached descriptors onto the route. */
export function asRouteModel(model: Model<Api>): Model<Api> {
  return model.provider === GROK_BUILD_ROUTE ? model : { ...model, provider: GROK_BUILD_ROUTE }
}

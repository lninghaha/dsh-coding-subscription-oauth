/**
 * Account-specific Grok Build catalog: live GET /v1/models-v2 merged onto the
 * static baseline descriptors. Failures keep the last good list, then the
 * static baseline.
 * @module dsh-coding-subscription-oauth/catalog
 */
import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
export type CatalogSource = "live" | "cache" | "fallback";
/** Vendor listing fields we keep after a live `/models-v2` fetch. */
export interface LiveModelDescriptor {
    id: string;
    name?: string;
    contextWindow?: number;
    reasoning?: boolean;
    thinkingLevelMap?: ThinkingLevelMap;
}
/**
 * Translate Grok Build `reasoning_efforts` into a pi-ai map. Undeclared
 * extended levels (especially `xhigh`) must be pinned to null — pi-ai treats
 * an absent xhigh/max key as unsupported, and an absent low/medium/high key
 * as supported.
 */
export declare function thinkingLevelMapFromLiveEfforts(efforts: unknown): ThinkingLevelMap | undefined;
/** Pull the live listing, including per-model reasoning levels when present. */
export declare function extractLiveModels(body: unknown): LiveModelDescriptor[];
/**
 * Pull model ids from a listing body. The `/v1/models-v2` response shape is
 * not a published contract, so accept the common envelopes: a bare array, an
 * OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
 * ids or objects with an `id` field.
 */
export declare function extractModelIds(body: unknown): string[];
/** Turn a live id into a pi-ai model, inheriting baseline metadata when possible. */
export declare function materializeLiveModel(id: string, catalog?: readonly Model<Api>[], overlay?: LiveModelDescriptor): Model<Api>;
/**
 * If `liveIds` is missing or empty, serve the baseline catalog.
 * Otherwise serve only the live ids, each materialized against the baseline
 * and optionally overlaid with live `/models-v2` reasoning metadata.
 */
export declare function mergeLiveCatalog(catalog: readonly Model<Api>[], liveIds: readonly string[] | undefined, liveModels?: readonly LiveModelDescriptor[]): Model<Api>[];
export declare function preferredGrokBuildModelFrom(models: readonly {
    id: string;
}[]): string;
/**
 * Fetch the account-visible models from `/v1/models-v2` with the CLI
 * fingerprint headers. Throws a secret-free error on failure.
 */
export declare function fetchLiveModels(accessToken: string, signal?: AbortSignal): Promise<LiveModelDescriptor[]>;
/** Fetch only the account-visible model ids from `/v1/models-v2`. */
export declare function fetchLiveModelIds(accessToken: string, signal?: AbortSignal): Promise<string[]>;
/** Re-exported so callers can normalise cached descriptors onto the route. */
export declare function asRouteModel(model: Model<Api>): Model<Api>;
//# sourceMappingURL=catalog.d.ts.map
/**
 * Account-specific Grok Build catalog: live GET /v1/models-v2 merged onto the
 * static baseline descriptors. Failures keep the last good list, then the
 * static baseline.
 * @module dsh-coding-subscription-oauth/catalog
 */

import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_ROUTE } from "./ids.ts";
import { GROK_BUILD_MODELS_URL, grokBuildBaselineModels, grokBuildFingerprintHeaders } from "./provider.ts";

const BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type CatalogSource = "live" | "cache" | "fallback";

/** Vendor listing fields we keep after a live `/models-v2` fetch. */
export interface LiveModelDescriptor {
	id: string;
	name?: string;
	contextWindow?: number;
	reasoning?: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listingRows(body: unknown): unknown[] {
	return Array.isArray(body)
		? body
		: isRecord(body) && Array.isArray(body["data"])
			? body["data"]
			: isRecord(body) && Array.isArray(body["models"])
				? body["models"]
				: [];
}

function isPiThinkingLevel(value: string): value is (typeof PI_THINKING_LEVELS)[number] {
	return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Translate Grok Build `reasoning_efforts` into a pi-ai map. Undeclared
 * extended levels (especially `xhigh`) must be pinned to null — pi-ai treats
 * an absent xhigh/max key as unsupported, and an absent low/medium/high key
 * as supported.
 */
export function thinkingLevelMapFromLiveEfforts(efforts: unknown): ThinkingLevelMap | undefined {
	if (!Array.isArray(efforts)) return undefined;
	const offered: ThinkingLevelMap = { off: null };
	let sawOffered = false;
	for (const row of efforts) {
		if (!isRecord(row)) continue;
		const id = typeof row["id"] === "string" ? row["id"] : typeof row["value"] === "string" ? row["value"] : "";
		const value = typeof row["value"] === "string" && row["value"].length > 0 ? row["value"] : id;
		if (!isPiThinkingLevel(id) || id === "off" || value.length === 0) continue;
		offered[id] = value;
		sawOffered = true;
	}
	if (!sawOffered) return undefined;
	const map: ThinkingLevelMap = { off: null };
	for (const level of PI_THINKING_LEVELS) {
		if (level === "off") continue;
		map[level] = offered[level] ?? null;
	}
	return map;
}

function parseLiveRow(row: unknown): LiveModelDescriptor | undefined {
	if (typeof row === "string" && row.length > 0) return { id: row };
	if (!isRecord(row) || typeof row["id"] !== "string" || row["id"].length === 0) return undefined;
	const descriptor: LiveModelDescriptor = { id: row["id"] };
	if (typeof row["name"] === "string" && row["name"].length > 0) descriptor.name = row["name"];
	const contextWindow = row["context_window"] ?? row["contextWindow"];
	if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
		descriptor.contextWindow = contextWindow;
	}
	if (row["supports_reasoning_effort"] === false) {
		descriptor.reasoning = false;
	} else {
		const thinkingLevelMap = thinkingLevelMapFromLiveEfforts(row["reasoning_efforts"]);
		if (thinkingLevelMap !== undefined) {
			descriptor.reasoning = true;
			descriptor.thinkingLevelMap = thinkingLevelMap;
		} else if (row["supports_reasoning_effort"] === true) {
			descriptor.reasoning = true;
		}
	}
	return descriptor;
}

/** Pull the live listing, including per-model reasoning levels when present. */
export function extractLiveModels(body: unknown): LiveModelDescriptor[] {
	const seen = new Set<string>();
	const models: LiveModelDescriptor[] = [];
	for (const row of listingRows(body)) {
		const parsed = parseLiveRow(row);
		if (parsed === undefined || seen.has(parsed.id)) continue;
		seen.add(parsed.id);
		models.push(parsed);
	}
	return models;
}

/**
 * Pull model ids from a listing body. The `/v1/models-v2` response shape is
 * not a published contract, so accept the common envelopes: a bare array, an
 * OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
 * ids or objects with an `id` field.
 */
export function extractModelIds(body: unknown): string[] {
	return extractLiveModels(body).map((model) => model.id);
}

function titleCaseId(id: string): string {
	return id
		.split(/[-_]/g)
		.map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
		.join(" ");
}

function catalogModels(baseline: readonly Model<Api>[] = grokBuildBaselineModels()): readonly Model<Api>[] {
	return baseline;
}

function templateFor(id: string, catalog: readonly Model<Api>[]): Model<Api> {
	const exact = catalog.find((model) => model.id === id);
	if (exact !== undefined) return exact;
	const lower = id.toLowerCase();
	const fallback = catalog.find((model) => model.id === DEFAULT_GROK_BUILD_MODEL) ?? catalog[0];
	if (fallback === undefined) throw new Error("grok-build: baseline catalog is empty");
	if (lower.includes("composer") || lower.includes("fast")) {
		return catalog.find((model) => model.id === "grok-composer-2.5-fast") ?? fallback;
	}
	// grok-4.5 is the last generation without xhigh; later ids inherit 4.6.
	if (/(^|[-_])4\.5($|[-_])/u.test(lower)) {
		return catalog.find((model) => model.id === "grok-4.5") ?? fallback;
	}
	return catalog.find((model) => model.id === "grok-4.6") ?? fallback;
}

function applyLiveOverlay(model: Model<Api>, overlay: LiveModelDescriptor | undefined): Model<Api> {
	if (overlay === undefined) return model;
	return {
		...model,
		id: overlay.id,
		...(overlay.name === undefined ? {} : { name: overlay.name }),
		...(overlay.contextWindow === undefined ? {} : { contextWindow: overlay.contextWindow }),
		...(overlay.reasoning === undefined ? {} : { reasoning: overlay.reasoning }),
		...(overlay.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: overlay.thinkingLevelMap }),
	};
}

/** Turn a live id into a pi-ai model, inheriting baseline metadata when possible. */
export function materializeLiveModel(
	id: string,
	catalog: readonly Model<Api>[] = catalogModels(),
	overlay?: LiveModelDescriptor,
): Model<Api> {
	const template = templateFor(id, catalog);
	const base = template.id === id ? template : { ...template, id, name: titleCaseId(id) };
	return applyLiveOverlay(base, overlay);
}

/**
 * If `liveIds` is missing or empty, serve the baseline catalog.
 * Otherwise serve only the live ids, each materialized against the baseline
 * and optionally overlaid with live `/models-v2` reasoning metadata.
 */
export function mergeLiveCatalog(
	catalog: readonly Model<Api>[],
	liveIds: readonly string[] | undefined,
	liveModels: readonly LiveModelDescriptor[] = [],
): Model<Api>[] {
	if (liveIds === undefined || liveIds.length === 0) return [...catalog];
	const overlays = new Map(liveModels.map((model) => [model.id, model]));
	return liveIds.map((id) => materializeLiveModel(id, catalog, overlays.get(id)));
}

export function preferredGrokBuildModelFrom(models: readonly { id: string }[]): string {
	const ids = new Set(models.map((model) => model.id));
	if (ids.has(DEFAULT_GROK_BUILD_MODEL)) return DEFAULT_GROK_BUILD_MODEL;
	return models[0]?.id ?? DEFAULT_GROK_BUILD_MODEL;
}

/**
 * Fetch the account-visible models from `/v1/models-v2` with the CLI
 * fingerprint headers. Throws a secret-free error on failure.
 */
export async function fetchLiveModels(accessToken: string, signal?: AbortSignal): Promise<LiveModelDescriptor[]> {
	let response: Response;
	try {
		response = await fetch(GROK_BUILD_MODELS_URL, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
				...grokBuildFingerprintHeaders(),
			},
			...(signal === undefined ? {} : { signal }),
		});
	} catch {
		if (signal?.aborted) throw new Error("Live model listing was cancelled");
		throw new Error("Grok Build model listing is unreachable (proxy required on some networks)");
	}
	const raw = Buffer.from(await response.arrayBuffer());
	if (raw.byteLength > BODY_LIMIT_BYTES) {
		throw new Error("Grok Build model listing exceeded the 4 MiB read ceiling");
	}
	let body: unknown;
	try {
		body = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error(`Grok Build model listing returned invalid JSON (HTTP ${response.status})`);
	}
	if (!response.ok) {
		const code = isRecord(body) && typeof body["error"] === "string" ? body["error"] : undefined;
		throw new Error(
			`Grok Build model listing failed (HTTP ${response.status})${code === undefined ? "" : `: ${code}`}`,
		);
	}
	const models = extractLiveModels(body);
	if (models.length === 0) throw new Error("Grok Build model listing contained no model ids");
	return models;
}

/** Fetch only the account-visible model ids from `/v1/models-v2`. */
export async function fetchLiveModelIds(accessToken: string, signal?: AbortSignal): Promise<string[]> {
	return (await fetchLiveModels(accessToken, signal)).map((model) => model.id);
}

/** Re-exported so callers can normalise cached descriptors onto the route. */
export function asRouteModel(model: Model<Api>): Model<Api> {
	return model.provider === GROK_BUILD_ROUTE ? model : { ...model, provider: GROK_BUILD_ROUTE };
}

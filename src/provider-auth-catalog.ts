/**
 * Reusable provider takeover helpers: directory enrichment, multi-model enable,
 * and credential reverse-injection into DSH `llm-pi-ai` settings.
 *
 * OpenCode Go is the first complete consumer; other subscription providers can
 * reuse the same merge / reinject shapes without copying UI or route code.
 */

export type ProviderReasoningEfforts = Partial<
	Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>
>;

export interface ProviderDirectoryModel {
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly input?: readonly ("text" | "image")[];
	readonly reasoningEfforts?: false | ProviderReasoningEfforts;
	readonly compat?: Record<string, unknown>;
	readonly protocol?: string;
}

export interface ProviderKnownModel extends ProviderDirectoryModel {
	readonly protocol: string;
}

export interface CredentialReinjectPlan {
	readonly path: readonly ["providers", string, "apiKeyEnv"];
	readonly credentialRef: string;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * Shape `reasoningEfforts` for DSH `llm-pi-ai`:
 * - `false` stays (non-reasoning model)
 * - only `off` may be null ("supported, send nothing")
 * - every other level needs a non-empty wire string; drop illegal null/empty
 * - refuse an empty dict / efforts that only declare invalid keys
 */
export function normalizeReasoningEfforts(efforts: unknown): false | ProviderReasoningEfforts | undefined {
	if (efforts === false) return false;
	if (efforts === undefined || efforts === null) return undefined;
	const raw = record(efforts);
	if (raw === undefined) return undefined;
	const out: ProviderReasoningEfforts = {};
	for (const level of THINKING_LEVELS) {
		if (!(level in raw)) continue;
		const wire = raw[level];
		if (wire === null) {
			if (level === "off") out.off = null;
			continue;
		}
		if (typeof wire !== "string") continue;
		const trimmed = wire.trim();
		if (trimmed.length === 0) {
			if (level === "off") out.off = null;
			continue;
		}
		out[level] = trimmed;
	}
	const keys = Object.keys(out);
	if (keys.length === 0) return undefined;
	if (!keys.some((level) => level !== "off")) return undefined;
	return out;
}

/**
 * Merge a live directory row with optional known metadata. Known fields fill
 * gaps only; caller-supplied directory values win so a fresher listing can
 * override a stale embedded catalog. Efforts are normalized so illegal null
 * levels never reach DSH settings.
 */
export function enrichDirectoryModel(
	directory: ProviderDirectoryModel,
	known?: ProviderKnownModel,
): ProviderDirectoryModel {
	const mergedEfforts = normalizeReasoningEfforts(
		directory.reasoningEfforts !== undefined ? directory.reasoningEfforts : known?.reasoningEfforts,
	);
	if (known === undefined) {
		const { reasoningEfforts: _drop, ...rest } = directory;
		return {
			...rest,
			...(mergedEfforts === undefined ? {} : { reasoningEfforts: mergedEfforts }),
		};
	}
	return {
		id: directory.id,
		...(known.name === undefined && directory.name === undefined ? {} : { name: directory.name ?? known.name }),
		...(known.contextWindow === undefined && directory.contextWindow === undefined
			? {}
			: { contextWindow: directory.contextWindow ?? known.contextWindow }),
		...(known.maxTokens === undefined && directory.maxTokens === undefined
			? {}
			: { maxTokens: directory.maxTokens ?? known.maxTokens }),
		...(known.input === undefined && directory.input === undefined ? {} : { input: directory.input ?? known.input }),
		...(mergedEfforts === undefined ? {} : { reasoningEfforts: mergedEfforts }),
		...(known.compat === undefined && directory.compat === undefined
			? {}
			: { compat: directory.compat ?? known.compat }),
		...(known.protocol === undefined && directory.protocol === undefined
			? {}
			: { protocol: directory.protocol ?? known.protocol }),
	};
}

function priorNeedsCapabilityBackfill(prior: unknown, catalog: ProviderDirectoryModel | undefined): boolean {
	if (catalog === undefined) return false;
	const entry = record(prior);
	if (entry === undefined) return true;
	if (catalog.reasoningEfforts !== undefined && entry["reasoningEfforts"] === undefined) return true;
	if (catalog.compat !== undefined && entry["compat"] === undefined) return true;
	if (catalog.name !== undefined && entry["name"] === undefined) return true;
	if (catalog.contextWindow !== undefined && entry["contextWindow"] === undefined) return true;
	if (catalog.maxTokens !== undefined && entry["maxTokens"] === undefined) return true;
	if (catalog.input !== undefined && entry["input"] === undefined) return true;
	// Illegal array / non-object efforts from older writes must be replaced.
	if (catalog.reasoningEfforts !== undefined && entry["reasoningEfforts"] !== false) {
		const efforts = entry["reasoningEfforts"];
		if (Array.isArray(efforts) || (efforts !== undefined && record(efforts) === undefined)) return true;
		if (record(efforts) !== undefined && normalizeReasoningEfforts(efforts) === undefined) return true;
	}
	return false;
}

function mergePriorWithCatalog(prior: unknown, catalog: ProviderDirectoryModel): Record<string, unknown> {
	const entry = record(structuredClone(prior)) ?? { id: catalog.id };
	const fromCatalog = settingsModelEntry(catalog);
	const next: Record<string, unknown> = { ...fromCatalog, ...entry, id: catalog.id };
	if (entry["reasoningEfforts"] === undefined || priorNeedsCapabilityBackfill(entry, catalog)) {
		if (fromCatalog["reasoningEfforts"] !== undefined) next["reasoningEfforts"] = fromCatalog["reasoningEfforts"];
		else delete next["reasoningEfforts"];
	} else if (entry["reasoningEfforts"] !== false) {
		const normalized = normalizeReasoningEfforts(entry["reasoningEfforts"]);
		if (normalized !== undefined) next["reasoningEfforts"] = normalized;
		else if (fromCatalog["reasoningEfforts"] !== undefined) next["reasoningEfforts"] = fromCatalog["reasoningEfforts"];
		else delete next["reasoningEfforts"];
	}
	if (entry["compat"] === undefined && fromCatalog["compat"] !== undefined) next["compat"] = fromCatalog["compat"];
	if (entry["name"] === undefined && fromCatalog["name"] !== undefined) next["name"] = fromCatalog["name"];
	if (entry["contextWindow"] === undefined && fromCatalog["contextWindow"] !== undefined)
		next["contextWindow"] = fromCatalog["contextWindow"];
	if (entry["maxTokens"] === undefined && fromCatalog["maxTokens"] !== undefined)
		next["maxTokens"] = fromCatalog["maxTokens"];
	if (entry["input"] === undefined && fromCatalog["input"] !== undefined) next["input"] = fromCatalog["input"];
	return next;
}

/**
 * Build the settings `models` array for apply: keep existing entries (and their
 * user overrides) when re-enabled, but backfill missing `reasoningEfforts` /
 * `compat` from the enriched catalog so a prior thin `{ id }` still gets a
 * runnable thinking map. Drop disabled ids; append newly enabled enriched rows.
 */
export function mergeEnabledModels(input: {
	readonly existing: unknown;
	readonly enabledIds: readonly string[];
	readonly catalog: readonly ProviderDirectoryModel[];
}): unknown[] {
	const existingRaw = Array.isArray(input.existing) ? input.existing : [];
	const existingById = new Map<string, unknown>();
	for (const entry of existingRaw) {
		const id = text(record(entry)?.["id"]);
		if (id !== undefined) existingById.set(id, structuredClone(entry));
	}
	const catalogById = new Map(input.catalog.map((model) => [model.id, model]));
	const seen = new Set<string>();
	const merged: unknown[] = [];
	for (const id of input.enabledIds) {
		if (seen.has(id) || id.trim() === "") continue;
		seen.add(id);
		const prior = existingById.get(id);
		const fromCatalog = catalogById.get(id);
		if (prior !== undefined) {
			merged.push(fromCatalog === undefined ? prior : mergePriorWithCatalog(prior, fromCatalog));
			continue;
		}
		merged.push(fromCatalog === undefined ? { id } : settingsModelEntry(fromCatalog));
	}
	return merged;
}

/** Shape one directory/known model as a DSH `PiAiModelProfile` write. */
export function settingsModelEntry(model: ProviderDirectoryModel): Record<string, unknown> {
	const efforts = normalizeReasoningEfforts(model.reasoningEfforts);
	return {
		id: model.id,
		...(model.name === undefined ? {} : { name: model.name }),
		...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
		...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
		...(model.input === undefined ? {} : { input: [...model.input] }),
		...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
		...(model.compat === undefined ? {} : { compat: model.compat }),
	};
}

/**
 * When a provider route already lists models (or otherwise exists) but lacks a
 * usable `apiKeyEnv`, reinject the selected credential reference.
 */
export function planCredentialReinject(input: {
	readonly providerId: string;
	readonly provider: unknown;
	readonly credentialRef: string | undefined;
	readonly credentialConfigured: boolean;
}): CredentialReinjectPlan | undefined {
	const ref = text(input.credentialRef);
	if (ref === undefined || !input.credentialConfigured) return undefined;
	const provider = record(input.provider);
	if (provider === undefined) return undefined;
	const current = text(provider["apiKeyEnv"]);
	if (current === ref) return undefined;
	const hasModels = Array.isArray(provider["models"]) && provider["models"].length > 0;
	const claimed =
		hasModels ||
		text(provider["api"]) !== undefined ||
		text(provider["baseURL"]) !== undefined ||
		Object.keys(provider).length > 0;
	if (!claimed) return undefined;
	if (current !== undefined && current !== ref) {
		// Prefer not to clobber an explicit different ref the user set in DSH.
		return undefined;
	}
	return { path: ["providers", input.providerId, "apiKeyEnv"], credentialRef: ref };
}

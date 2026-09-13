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

const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * Merge a live directory row with optional known metadata. Known fields fill
 * gaps only; caller-supplied directory values win so a fresher listing can
 * override a stale embedded catalog.
 */
export function enrichDirectoryModel(
	directory: ProviderDirectoryModel,
	known?: ProviderKnownModel,
): ProviderDirectoryModel {
	if (known === undefined) return { ...directory };
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
		...(known.reasoningEfforts === undefined && directory.reasoningEfforts === undefined
			? {}
			: { reasoningEfforts: directory.reasoningEfforts ?? known.reasoningEfforts }),
		...(known.compat === undefined && directory.compat === undefined
			? {}
			: { compat: directory.compat ?? known.compat }),
		...(known.protocol === undefined && directory.protocol === undefined
			? {}
			: { protocol: directory.protocol ?? known.protocol }),
	};
}

/**
 * Build the settings `models` array for apply: keep existing entries (and their
 * user overrides) when re-enabled, drop disabled ids, append newly enabled
 * enriched rows.
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
		if (prior !== undefined) {
			merged.push(prior);
			continue;
		}
		const fromCatalog = catalogById.get(id);
		merged.push(fromCatalog === undefined ? { id } : settingsModelEntry(fromCatalog));
	}
	return merged;
}

/** Shape one directory/known model as a DSH `PiAiModelProfile` write. */
export function settingsModelEntry(model: ProviderDirectoryModel): Record<string, unknown> {
	return {
		id: model.id,
		...(model.name === undefined ? {} : { name: model.name }),
		...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
		...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
		...(model.input === undefined ? {} : { input: [...model.input] }),
		...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts }),
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

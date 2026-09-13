/**
 * Reusable provider takeover helpers: directory enrichment, multi-model enable,
 * and credential reverse-injection into DSH `llm-pi-ai` settings.
 *
 * OpenCode Go is the first complete consumer; other subscription providers can
 * reuse the same merge / reinject shapes without copying UI or route code.
 */
export type ProviderReasoningEfforts = Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
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
/**
 * Shape `reasoningEfforts` for DSH `llm-pi-ai`:
 * - `false` stays (non-reasoning model)
 * - only `off` may be null ("supported, send nothing")
 * - every other level needs a non-empty wire string; drop illegal null/empty
 * - refuse an empty dict / efforts that only declare invalid keys
 */
export declare function normalizeReasoningEfforts(efforts: unknown): false | ProviderReasoningEfforts | undefined;
/**
 * Merge a live directory row with optional known metadata. Known fields fill
 * gaps only; caller-supplied directory values win so a fresher listing can
 * override a stale embedded catalog. Efforts are normalized so illegal null
 * levels never reach DSH settings.
 */
export declare function enrichDirectoryModel(directory: ProviderDirectoryModel, known?: ProviderKnownModel): ProviderDirectoryModel;
/**
 * Build the settings `models` array for apply: keep existing entries (and their
 * user overrides) when re-enabled, but backfill missing `reasoningEfforts` /
 * `compat` from the enriched catalog so a prior thin `{ id }` still gets a
 * runnable thinking map. Drop disabled ids; append newly enabled enriched rows.
 */
export declare function mergeEnabledModels(input: {
    readonly existing: unknown;
    readonly enabledIds: readonly string[];
    readonly catalog: readonly ProviderDirectoryModel[];
}): unknown[];
/** Shape one directory/known model as a DSH `PiAiModelProfile` write. */
export declare function settingsModelEntry(model: ProviderDirectoryModel): Record<string, unknown>;
/**
 * When a provider route already lists models (or otherwise exists) but lacks a
 * usable `apiKeyEnv`, reinject the selected credential reference.
 */
export declare function planCredentialReinject(input: {
    readonly providerId: string;
    readonly provider: unknown;
    readonly credentialRef: string | undefined;
    readonly credentialConfigured: boolean;
}): CredentialReinjectPlan | undefined;
//# sourceMappingURL=provider-auth-catalog.d.ts.map
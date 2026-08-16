/**
 * Harness route aliases over a native-id PiAiAdapter.
 * @module dsh-coding-subscription-oauth/alias-adapter
 */
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
export interface AliasLlmRoutePolicy {
    /** User-facing provider name shown above models in the model selector. */
    displayName?: string;
    /** Return false to hide every model for this route from discovery. */
    isAuthenticated?: () => Promise<boolean>;
    /**
     * After authentication, keep only models this predicate accepts.
     * Used by opt-in routes (e.g. Codex Fast) so ineligible ids stay hidden
     * without hiding the whole authenticated catalog.
     */
    includeModel?: (modelId: string) => boolean;
    /**
     * Called once when a stream for this route finishes with an AUTH failure
     * (upstream rejected a locally-valid token). Implementations backdate the
     * stored credential's expiry so the retried step refreshes before reuse.
     * Awaiting it here keeps invalidation ordered before the retry executor
     * reruns the step; failures are swallowed so the original AUTH surfaces.
     */
    onAuthFailure?: () => Promise<void>;
}
/**
 * Keeps pi-ai model.provider identities native while exposing collision-free
 * Harness route names. Every public operation translates exactly once.
 */
export declare class AliasLlmAdapter extends LlmAdapter {
    private readonly inner;
    private readonly aliases;
    private readonly policies;
    constructor(inner: LlmAdapter, aliases: ReadonlyMap<string, string>, policies?: ReadonlyMap<string, AliasLlmRoutePolicy>);
    private nativeProvider;
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=alias-adapter.d.ts.map
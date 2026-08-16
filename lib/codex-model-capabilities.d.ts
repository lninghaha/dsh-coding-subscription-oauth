/**
 * Live Codex model service-tier cache and composable fast-route payload helpers.
 *
 * Fetches `GET /backend-api/codex/models?client_version=…`, caches `service_tiers`,
 * and never invents eligibility when the live catalog is missing or stale.
 * A stale TTL is unknown: Fast is default-deny until a live, non-stale catalog
 * explicitly lists `priority` for that model. `isEligible` is required and
 * fail-closed — omitting it or returning false injects nothing.
 *
 * Ordinary inference stays unchanged: the unwrapped provider is never mutated.
 * A wrapper may use a distinct profile provider id (`codex-oauth-fast`) while
 * restoring native `model.provider` for the base wire call and the same catalog.
 *
 * @module dsh-coding-subscription-oauth/codex-model-capabilities
 */
import { type CodexAuthSession, type CodexFetch, type CodexHttpClient } from "./codex-http.ts";
import { CODEX_OAUTH_FAST_ROUTE } from "./ids.ts";
/** Distinct optional Harness route; parent owns dynamic registration. */
export { CODEX_OAUTH_FAST_ROUTE };
export declare const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
export declare const DEFAULT_CODEX_CLIENT_VERSION = "0.144.0";
export declare const DEFAULT_CODEX_SERVICE_TIER = "priority";
export declare const CODEX_ROUTING_HINT_HEADER = "x-codex-routing-hint";
export interface CodexModelCapability {
    readonly id: string;
    readonly serviceTiers: readonly string[];
}
export interface CodexModelCapabilitiesOptions {
    readonly auth: CodexAuthSession;
    readonly http?: CodexHttpClient;
    readonly fetchImpl?: CodexFetch;
    readonly clientVersion?: string;
    readonly originator?: string;
    readonly userAgent?: string;
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    readonly now?: () => number;
    readonly ttlMs?: number;
}
export interface CodexModelCapabilities {
    refresh(signal?: AbortSignal): Promise<readonly CodexModelCapability[]>;
    getCached(): readonly CodexModelCapability[] | undefined;
    serviceTiers(modelId: string): readonly string[];
    isPriorityEligible(modelId: string): boolean;
    isTierEligible(modelId: string, tier: string): boolean;
}
export type CodexOnPayload = (payload: unknown, model: unknown) => unknown | undefined | Promise<unknown | undefined>;
export interface CodexFastStreamOptions {
    onPayload?: CodexOnPayload;
    headers?: Record<string, string | null>;
    [key: string]: unknown;
}
/**
 * Fast-route composition is default-deny.
 * `isEligible` is required; missing or false means no header and no `service_tier`.
 */
export interface CodexFastRoutingOptions {
    readonly isEligible: (modelId: string) => boolean;
    readonly serviceTier?: string;
    /** Distinct profile/route id for the wrapper (e.g. {@link CODEX_OAUTH_FAST_ROUTE}). */
    readonly profileProviderId?: string;
    /** Native provider id restored on `model.provider` before the base wire call. */
    readonly nativeProviderId?: string;
}
export interface CodexStreamModel {
    readonly id: string;
    readonly provider?: string;
    readonly [key: string]: unknown;
}
/** Structural pi-ai provider face; `never` parameters keep native Provider assignable. */
export interface CodexStreamableProvider {
    readonly id: string;
    readonly headers?: Record<string, string | null>;
    stream: (model: never, context: never, options?: never) => unknown;
    streamSimple: (model: never, context: never, options?: never) => unknown;
}
/** Wrapper face with callable stream methods and a possibly distinct profile id. */
export type CodexFastWrappedProvider<P extends CodexStreamableProvider> = Omit<P, "id" | "headers" | "stream" | "streamSimple"> & {
    readonly id: string;
    readonly headers?: Record<string, string | null>;
    stream: (model: CodexStreamModel, context: unknown, options?: CodexFastStreamOptions) => unknown;
    streamSimple: (model: CodexStreamModel, context: unknown, options?: CodexFastStreamOptions) => unknown;
};
/** Parse the live models envelope. Unknown shapes yield an empty catalog, never a hardcoded fallback. */
export declare function parseCodexModelCapabilities(value: unknown): CodexModelCapability[];
export declare function codexModelsUrl(clientVersion: string): string;
/** Exact per-model Fast header value. Never a bare static `priority`. */
export declare function codexRoutingHint(modelId: string, tier?: string): string;
/**
 * Compose an existing `onPayload` with service_tier injection.
 * Does not override a payload that already set `service_tier`.
 * Fail-closed: injection happens only when `isEligible(modelId)` is exactly true.
 */
export declare function composeCodexFastOnPayload(inner: CodexOnPayload | undefined, options: CodexFastRoutingOptions): CodexOnPayload;
/** Merge `x-codex-routing-hint=model=<slug>;tier=<tier>` without dropping existing keys. */
export declare function composeCodexFastHeaders(headers: Record<string, string | null> | undefined, modelId: string, tier?: string): Record<string, string | null>;
/** Apply fast-route payload + per-model header composition to one stream-options object. */
export declare function applyCodexFastStreamOptions<T extends CodexFastStreamOptions>(options: T | undefined, config: CodexFastRoutingOptions, modelId: string): T;
/**
 * Wrap a pi-ai provider for a future `codex-oauth-fast` route.
 * The original provider object is not mutated. The wrapper may advertise a
 * distinct profile provider id while restoring native `model.provider` so the
 * base wire call and model catalog stay on the native provider.
 */
export declare function withCodexFastRouting<P extends CodexStreamableProvider>(provider: P, options: CodexFastRoutingOptions): CodexFastWrappedProvider<P>;
/**
 * Live `/codex/models` cache. Fetch failures leave ordinary inference alone.
 * Eligibility is false until a live, non-stale catalog explicitly lists the tier.
 * A stale TTL is treated as unknown, not as the last known catalog.
 */
export declare function createCodexModelCapabilities(options: CodexModelCapabilitiesOptions): CodexModelCapabilities;
//# sourceMappingURL=codex-model-capabilities.d.ts.map
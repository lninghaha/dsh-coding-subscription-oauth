/**
 * Optional ChatGPT Codex quota reader (`GET /backend-api/wham/usage`).
 * Normalizes unknown/malformed optional fields instead of failing the card.
 *
 * Cache semantics:
 * - A successful `read()` stores the projection until `ttlMs` elapses.
 * - Concurrent non-force `read()` calls share one in-flight GET.
 * - `read({ force: true })` always issues a new GET and never joins an
 *   existing in-flight read (forced or not). A later completion of the
 *   abandoned in-flight GET cannot overwrite the forced result.
 * - `clear()` drops the stored projection and detaches any in-flight GET so
 *   its later completion cannot repopulate the cache.
 *
 * @module dsh-coding-subscription-oauth/codex-usage
 */
import { type CodexAuthSession, type CodexFetch, type CodexHttpClient } from "./codex-http.ts";
/** Official ChatGPT rate-limit usage endpoint used by the Codex client. */
export declare const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export interface CodexRateLimitWindow {
    readonly usedPercent: number;
    readonly remainingPercent: number;
    readonly windowSeconds: number;
    readonly resetsAt?: number;
}
export interface CodexRateLimit {
    readonly id: string;
    readonly name?: string;
    readonly windows: readonly CodexRateLimitWindow[];
}
export interface CodexCredits {
    readonly unlimited: boolean;
    readonly balance?: string;
}
export interface CodexIndividualLimit {
    readonly limit: string;
    readonly used: string;
    readonly remaining?: string;
    readonly remainingPercent: number;
    readonly resetsAt?: number;
}
export interface CodexUsage {
    readonly rateLimits: readonly CodexRateLimit[];
    readonly credits?: CodexCredits;
    readonly individualLimit?: CodexIndividualLimit;
    readonly spendControlReached?: boolean;
    readonly resetCredits?: {
        readonly availableCount: number;
    };
    readonly fetchedAt: number;
}
export interface CodexUsageReaderOptions {
    readonly auth: CodexAuthSession;
    readonly http?: CodexHttpClient;
    readonly fetchImpl?: CodexFetch;
    readonly originator?: string;
    readonly userAgent?: string;
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    readonly now?: () => number;
    readonly ttlMs?: number;
}
export interface CodexUsageReader {
    read(options?: {
        force?: boolean;
        signal?: AbortSignal;
    }): Promise<CodexUsage>;
    clear(): void;
}
/**
 * Reduce an opaque `wham/usage` payload to a secret-free quota projection.
 * Unknown extra fields are ignored; malformed optional buckets are skipped.
 */
export declare function normalizeCodexUsage(value: unknown, fetchedAt?: number): CodexUsage;
/**
 * Cached, injectable usage reader. Failures do not invent quota numbers.
 *
 * See the module doc for `force` / `clear` cache semantics.
 */
export declare function createCodexUsageReader(options: CodexUsageReaderOptions): CodexUsageReader;
//# sourceMappingURL=codex-usage.d.ts.map
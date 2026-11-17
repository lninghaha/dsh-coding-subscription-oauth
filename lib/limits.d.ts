/**
 * Secret-free subscription limit gauges for the provider behind the active chat model.
 *
 * Sources (all read with the provider's own OAuth token, never exposed to the browser):
 * - codex:  GET https://chatgpt.com/backend-api/wham/usage (existing opt-in reader)
 * - claude: GET https://api.anthropic.com/api/oauth/usage (5h / weekly utilization)
 * - kimi:   GET https://api.kimi.com/coding/v1/usages (weekly summary + windowed limits)
 * - qwen:   sg-entitlement.qwen.com agent/usage (the chat.qwen.ai usage page's own request,
 *           best effort: shape unverified, may reject the OAuth token) + plan from userinfo
 * - grok:   no limit endpoint is known; reported as "no-data"
 *
 * Failures never invent numbers: they yield status "error" with a stable code only.
 * @module dsh-coding-subscription-oauth/limits
 */
import type { CodexUsage } from "./codex-usage.js";
import type { OAuthProviderSession } from "./oauth-session.js";
export type LimitProvider = "codex" | "claude" | "kimi" | "qwen" | "grok";
export declare const LIMIT_PROVIDERS: readonly LimitProvider[];
export interface LimitWindow {
    /** Stable id, e.g. `five_hour`, `seven_day`, `kimi-summary`. */
    readonly id: string;
    /** Provider-supplied display name when it has one (Kimi row name, Codex limit name). */
    readonly name?: string;
    readonly usedPercent: number;
    readonly windowSeconds?: number;
    /** Epoch seconds. */
    readonly resetsAt?: number;
}
export type ProviderLimitsStatus = "ok" | "no-data" | "signed-out" | "disabled" | "error";
export interface ProviderLimits {
    readonly provider: LimitProvider;
    readonly status: ProviderLimitsStatus;
    readonly windows: readonly LimitWindow[];
    readonly plan?: string;
    /** Stable machine code for `error` (never a response body). */
    readonly code?: string;
    readonly fetchedAt: number;
}
export type LimitFetch = (input: string, init?: RequestInit) => Promise<Response>;
export declare const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export declare const KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages";
/** Request the chat.qwen.ai "usage & billing" page makes; the query mirrors its fixed params. */
export declare function qwenEntitlementUsageUrl(timeZone?: string): string;
/** Claude `/api/oauth/usage`: `{ five_hour: { utilization, resets_at }, seven_day: {...}, ... }`. */
export declare function parseClaudeUsage(body: unknown): LimitWindow[];
/** Kimi `/usages`: weekly `usage` summary plus `limits[]` with `{ window, detail }`. */
export declare function parseKimiUsage(body: unknown): LimitWindow[];
/**
 * Qwen entitlement `agent/usage`. The `data` shape is not documented anywhere public, so this
 * is deliberately tolerant: it walks `data` and keeps objects that carry a usable total plus
 * either `used` or `remaining`. Returns [] (never garbage) when nothing matches.
 */
export declare function parseQwenEntitlement(body: unknown): LimitWindow[];
/** Project the existing Codex reader output onto the shared gauge shape. */
export declare function codexWindows(usage: CodexUsage): LimitWindow[];
export interface LimitsReaderOptions {
    readonly sessions: readonly OAuthProviderSession[];
    /** Existing Codex quota reader; absent or disabled → status `disabled`. */
    readonly codex?: {
        read(): Promise<CodexUsage>;
        enabled(): boolean;
    };
    readonly fetchImpl?: LimitFetch;
    readonly now?: () => number;
}
export interface LimitsReader {
    read(provider: LimitProvider, options?: {
        force?: boolean;
        signal?: AbortSignal;
    }): Promise<ProviderLimits>;
    clear(): void;
}
export declare function createLimitsReader(options: LimitsReaderOptions): LimitsReader;
//# sourceMappingURL=limits.d.ts.map
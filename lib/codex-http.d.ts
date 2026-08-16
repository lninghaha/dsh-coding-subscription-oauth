/**
 * Shared ChatGPT Codex backend HTTP client.
 *
 * Token and account identity are injected by the plugin-owned OAuth resolver.
 * The JWT `chatgpt_account_id` claim is used in full (never truncated).
 * Status policy: 401 invalidate+refresh once; 403 entitlement; 429 rate;
 * limited 5xx/transport retries. Only private chatgpt.com backend-api URLs.
 *
 * @module dsh-coding-subscription-oauth/codex-http
 */
/** First-party ChatGPT host for every Codex optional-capability request. */
export declare const CODEX_CHATGPT_ORIGIN = "https://chatgpt.com";
/** Path prefix that every Codex backend URL must stay under. */
export declare const CODEX_BACKEND_API_PREFIX = "/backend-api/";
export type CodexHttpMethod = "GET" | "POST";
/** One resolved Codex access token plus the full ChatGPT account id. */
export interface CodexAccess {
    readonly accessToken: string;
    readonly accountId: string;
}
/**
 * Plugin-owned OAuth seam. Parent typically wraps `OAuthProviderSession`:
 * `resolve` calls `resolveAccessToken()` (which refreshes under the store lock);
 * `invalidate` calls `invalidateAccessToken()` after an upstream 401.
 */
export interface CodexAuthSession {
    resolve(): Promise<{
        accessToken: string;
        accountId?: string;
    } | undefined>;
    invalidate(): Promise<void>;
}
export interface CodexHttpRequest {
    readonly url: string;
    readonly method?: CodexHttpMethod;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly maxBytes?: number;
    /** Skip the one-shot 401 invalidate/refresh (used by the retry itself). */
    readonly skipAuthRetry?: boolean;
}
/** Injected fetch. Tests must pass a mock; production defaults to global fetch. */
export type CodexFetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface CodexHttpClientOptions {
    readonly auth: CodexAuthSession;
    readonly fetchImpl?: CodexFetch;
    readonly originator?: string;
    readonly userAgent?: string;
    readonly now?: () => number;
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    readonly maxServerRetries?: number;
}
export interface CodexHttpClient {
    requestJson(request: CodexHttpRequest): Promise<unknown>;
    resolveAccess(): Promise<CodexAccess>;
}
/** Adapt an `OAuthProviderSession`-shaped object without importing that class. */
export declare function codexAuthFromSession(session: {
    resolveAccessToken(): Promise<string | undefined>;
    invalidateAccessToken(): Promise<void>;
}): CodexAuthSession;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function optionalNonEmptyString(value: unknown): string | undefined;
/** Decode the full ChatGPT account id from a Codex access JWT. Never truncates. */
export declare function chatgptAccountIdFromAccessToken(accessToken: string): string | undefined;
/** Reject anything that is not a first-party ChatGPT backend-api URL. */
export declare function assertCodexBackendUrl(url: string): URL;
export declare function parseRetryAfterMs(value: string | null, now: () => number): number | undefined;
/** Redact every provider error body through {@link safeMessage}. */
export declare function providerDetail(value: unknown): string | undefined;
/** Create a ChatGPT-backend-only client with injected OAuth resolve/invalidate. */
export declare function createCodexHttpClient(options: CodexHttpClientOptions): CodexHttpClient;
//# sourceMappingURL=codex-http.d.ts.map
/**
 * Optional Codex subscription search against the private ChatGPT backend.
 * Default-off: parent registers the returned provider only when the user enables it.
 *
 * @module dsh-coding-subscription-oauth/codex-search
 */
import { type CodexAuthSession, type CodexFetch, type CodexHttpClient } from "./codex-http.ts";
/** Stable search-provider id. Parent must not write this into `web.searchProvider` by default. */
export declare const CODEX_SEARCH_PROVIDER_ID = "codex-oauth-search";
/** Official Codex standalone search endpoint. */
export declare const CODEX_SEARCH_URL = "https://chatgpt.com/backend-api/codex/alpha/search";
export declare const CODEX_SEARCH_CONTEXT_SIZES: readonly ["low", "medium", "high"];
export type CodexSearchContextSize = (typeof CODEX_SEARCH_CONTEXT_SIZES)[number];
export declare const CODEX_SEARCH_MODES: readonly ["live", "cached", "indexed"];
export type CodexSearchMode = (typeof CODEX_SEARCH_MODES)[number];
export type CodexExternalWebAccess = true | false | "indexed";
export interface CodexSearchSource {
    readonly url: string;
    readonly title?: string;
    readonly snippet?: string;
}
export interface CodexSearchRequest {
    readonly query: string;
    readonly maxResults?: number;
}
export interface CodexSearchResult {
    readonly content?: string;
    readonly sources: readonly CodexSearchSource[];
    readonly truncated: boolean;
}
export interface CodexSearchRequestBody {
    readonly id: string;
    readonly model: string;
    readonly input: readonly [
        {
            readonly type: "message";
            readonly role: "user";
            readonly content: readonly [{
                readonly type: "input_text";
                readonly text: string;
            }];
        }
    ];
    readonly commands: {
        readonly search_query: readonly [{
            readonly q: string;
        }];
    };
    readonly settings: {
        readonly search_context_size: CodexSearchContextSize;
        readonly allowed_callers: readonly ["direct"];
        readonly external_web_access: CodexExternalWebAccess;
    };
    readonly max_output_tokens: number;
}
export interface CodexSearchProviderOptions {
    readonly auth: CodexAuthSession;
    readonly http?: CodexHttpClient;
    readonly fetchImpl?: CodexFetch;
    readonly model: string;
    readonly mode?: CodexSearchMode;
    readonly contextSize?: CodexSearchContextSize;
    readonly maxOutputTokens?: number;
    readonly resolveRequestId?: () => string;
    readonly originator?: string;
    readonly userAgent?: string;
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
/** Structural `WebSearchProvider` so parent can register without this module importing dsh-web. */
export interface CodexSearchProvider {
    readonly id: typeof CODEX_SEARCH_PROVIDER_ID;
    available(): boolean;
    search(request: CodexSearchRequest, signal?: AbortSignal): Promise<CodexSearchResult>;
}
/** Map configured search mode onto the verified `external_web_access` field. */
export declare function externalWebAccess(mode: CodexSearchMode): CodexExternalWebAccess;
/** Accept only citeable http(s) URLs. */
export declare function citeableHttpUrl(value: unknown): string | undefined;
/** Reject `<1` / non-finite `maxResults` rather than treating them as unlimited. */
export declare function assertCodexSearchMaxResults(maxResults: number | undefined): void;
/**
 * Map the standalone endpoint's forward-compatible result DTOs.
 * Only `type === "text_result"` items with valid http(s) URLs are kept; URLs are de-duplicated.
 */
export declare function mapCodexSearchResponse(value: unknown, maxResults?: number): CodexSearchResult;
export declare function buildCodexSearchRequestBody(query: string, options: {
    id: string;
    model: string;
    mode: CodexSearchMode;
    contextSize: CodexSearchContextSize;
    maxOutputTokens: number;
}): CodexSearchRequestBody;
/** Factory for an injectable, default-off Codex search provider. */
export declare function createCodexSearchProvider(options: CodexSearchProviderOptions): CodexSearchProvider;
//# sourceMappingURL=codex-search.d.ts.map
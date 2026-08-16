/** pi-ai provider ids used by login, refresh, and credential storage. */
export declare const XAI_PI_PROVIDER = "xai";
export declare const CODEX_PI_PROVIDER = "openai-codex";
export declare const KIMI_PI_PROVIDER = "kimi-coding";
export declare const CLAUDE_PI_PROVIDER = "anthropic";
/** Harness LLM routes. OAuth aliases avoid the user's API-key route ids. */
export declare const GROK_BUILD_ROUTE = "grok-build";
export declare const CODEX_OAUTH_ROUTE = "codex-oauth";
export declare const KIMI_CODE_OAUTH_ROUTE = "kimi-code-oauth";
export declare const CLAUDE_CODE_OAUTH_ROUTE = "claude-code-oauth";
export declare const ANTIGRAVITY_ROUTE = "agy";
export declare const CODING_OAUTH_ROUTES: readonly ["grok-build", "codex-oauth", "kimi-code-oauth", "claude-code-oauth"];
export type CodingOAuthRoute = (typeof CODING_OAUTH_ROUTES)[number];
export type CodingOAuthProviderSlug = "grok" | "codex" | "kimi" | "claude";
/** Basenames of private OAuth documents inside the Harness home. */
export declare const GROK_BUILD_AUTH_FILENAME = ".grok-build-auth.json";
export declare const CODEX_OAUTH_AUTH_FILENAME = ".codex-oauth-auth.json";
export declare const KIMI_CODE_OAUTH_AUTH_FILENAME = ".kimi-code-oauth-auth.json";
export declare const CLAUDE_CODE_OAUTH_AUTH_FILENAME = ".claude-code-oauth-auth.json";
/** Basenames of model selection/catalog caches inside the Harness home. */
export declare const GROK_BUILD_MODELS_CACHE_FILENAME = ".grok-build-models.json";
export declare const CODEX_OAUTH_MODELS_CACHE_FILENAME = ".codex-oauth-models.json";
export declare const KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME = ".kimi-code-oauth-models.json";
export declare const CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME = ".claude-code-oauth-models.json";
/** Fallback model when no live Grok catalog listing is available. */
export declare const DEFAULT_GROK_BUILD_MODEL = "grok-4.6";
/** Provider idle ceiling used by every composite route. */
export declare const GROK_BUILD_STREAM_IDLE_TIMEOUT_MS = 300000;
//# sourceMappingURL=ids.d.ts.map
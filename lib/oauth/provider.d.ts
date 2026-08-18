/**
 * Grok Build provider: a pi-ai provider pointed at the official Grok CLI
 * coding backend (`cli-chat-proxy.grok.com`) carrying the CLI fingerprint
 * headers the risk-control middleware requires.
 * @module dsh-coding-subscription-oauth/provider
 */
import type { Api, Model, Provider, ThinkingLevelMap } from "@earendil-works/pi-ai";
/**
 * Grok Build cannot disable reasoning (`reasoning_effort: "none"` is 400).
 * pi-ai treats an absent `xhigh`/`max` key as unsupported, so those levels
 * must be declared explicitly when the model offers them.
 */
export declare function grokBuildReasoningMap(levels: readonly ("low" | "medium" | "high" | "xhigh")[]): ThinkingLevelMap;
/** Inference backend base URL (Responses API lives under `${baseUrl}/responses`). */
export declare const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Account model catalog endpoint fetched by the official CLI. */
export declare const GROK_BUILD_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models-v2";
/**
 * Official Grok CLI version this plugin fingerprints as.
 * Track the `@xai-official/grok` npm release stream; make overridable via
 * GROK_BUILD_CLIENT_VERSION for urgent drift fixes without a release.
 */
export declare const GROK_CLIENT_VERSION: string;
/**
 * Fingerprint headers required by the Grok Build middleware. Missing headers
 * are a known 403 trigger (codex-app-transfer field notes, 2026-07).
 */
export declare function grokBuildFingerprintHeaders(): Record<string, string>;
/** Static baseline catalog, used until a live `/models-v2` listing succeeds. */
export declare function grokBuildBaselineModels(): Model<"openai-responses">[];
/**
 * Build the Grok Build pi-ai provider. Auth is apiKey-shaped: the OAuth
 * access token is injected as the bearer key by the surrounding adapter
 * (`Models.getAuth` on the login provider performs refresh under the store
 * lock before the key ever reaches here).
 */
export declare function grokBuildProvider(models: readonly Model<Api>[]): Provider;
//# sourceMappingURL=provider.d.ts.map
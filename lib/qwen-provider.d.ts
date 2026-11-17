/**
 * Native-shaped pi-ai provider for Qwen Code subscription OAuth.
 * @module dsh-coding-subscription-oauth/qwen-provider
 */
import type { Model, Provider } from "@earendil-works/pi-ai";
/** Fixed OpenAI-compatible gateway used by the official Qwen Code subscription flow. */
export declare const QWEN_SUBSCRIPTION_BASE_URL = "https://api.qwen.ai/compatible-mode/v1";
/**
 * Baseline catalog used before the first live listing (and when listing fails). The
 * official CLI lists models from `GET {base}/models`; its default subscription model is
 * `qwen3.8-max`. The session replaces this with the live list after sign-in.
 */
export declare const QWEN_CODE_MODELS: readonly Model<"openai-completions">[];
/** Descriptor of one model returned by the live listing; materialized onto a baseline template. */
export interface LiveModelEntry {
    id: string;
    name: string;
    input: Model<"openai-completions">["input"];
    contextWindow: number;
    maxTokens: number;
}
/** Parse `GET /models`: `{ data: [{ id, input_modalities?, context_window_tokens? }] }`. */
export declare function parseQwenModelsResponse(body: unknown): LiveModelEntry[];
/** List the account's models from the subscription gateway (Bearer, no redirects). */
export declare function fetchQwenModels(accessToken: string, signal: AbortSignal, baseUrl?: string): Promise<LiveModelEntry[]>;
export declare function qwenCodeProvider(): Provider;
//# sourceMappingURL=qwen-provider.d.ts.map
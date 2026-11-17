/**
 * Native-shaped pi-ai provider for Qwen Code subscription OAuth.
 * @module dsh-coding-subscription-oauth/qwen-provider
 */
import type { Model, Provider } from "@earendil-works/pi-ai";
/** Fixed OpenAI-compatible gateway used by the official Qwen Code subscription flow. */
export declare const QWEN_SUBSCRIPTION_BASE_URL = "https://api.qwen.ai/compatible-mode/v1";
/**
 * Baseline catalog. The official CLI lists models from `GET {base}/models`; its default
 * subscription model is `qwen3.8-max`. Live listing is not wired here, so this is a
 * conservative static fallback that Settings model selection narrows.
 */
export declare const QWEN_CODE_MODELS: readonly Model<"openai-completions">[];
export declare function qwenCodeProvider(): Provider;
//# sourceMappingURL=qwen-provider.d.ts.map
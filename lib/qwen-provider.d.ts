/**
 * Native-shaped pi-ai provider for Qwen Code subscription OAuth.
 * @module dsh-coding-subscription-oauth/qwen-provider
 */
import type { Model, Provider } from "@earendil-works/pi-ai";
/** OpenAI-compatible inference host used by Qwen Code OAuth accounts. */
export declare const QWEN_PORTAL_BASE_URL = "https://portal.qwen.ai/v1";
/** Stable aliases the Qwen portal resolves server-side to the current coder/vision models. */
export declare const QWEN_CODE_MODELS: readonly Model<"openai-completions">[];
export declare function qwenCodeProvider(): Provider;
//# sourceMappingURL=qwen-provider.d.ts.map
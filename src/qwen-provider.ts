/**
 * Native-shaped pi-ai provider for Qwen Code subscription OAuth.
 * @module dsh-coding-subscription-oauth/qwen-provider
 */

import type { Model, Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { QWEN_PI_PROVIDER } from "./ids.ts";
import { qwenCodeOAuth } from "./qwen-oauth.ts";

/** Fixed OpenAI-compatible gateway used by the official Qwen Code subscription flow. */
export const QWEN_SUBSCRIPTION_BASE_URL = "https://api.qwen.ai/compatible-mode/v1";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

function qwenModel(
	id: string,
	name: string,
	input: Model<"openai-completions">["input"],
	contextWindow: number,
	maxTokens: number,
): Model<"openai-completions"> {
	return {
		id,
		name,
		api: "openai-completions",
		provider: QWEN_PI_PROVIDER,
		baseUrl: QWEN_SUBSCRIPTION_BASE_URL,
		reasoning: false,
		input,
		cost: ZERO_COST,
		contextWindow,
		maxTokens,
		headers: { "User-Agent": `QwenCode/unknown (${process.platform}; ${process.arch})` },
		compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false },
	};
}

/**
 * Baseline catalog. The official CLI lists models from `GET {base}/models`; its default
 * subscription model is `qwen3.8-max`. Live listing is not wired here, so this is a
 * conservative static fallback that Settings model selection narrows.
 */
export const QWEN_CODE_MODELS: readonly Model<"openai-completions">[] = [
	qwenModel("qwen3.8-max", "Qwen 3.8 Max", ["text"], 262_144, 65_536),
];

export function qwenCodeProvider(): Provider {
	return createProvider({
		id: QWEN_PI_PROVIDER,
		name: "Qwen Code",
		baseUrl: QWEN_SUBSCRIPTION_BASE_URL,
		auth: { oauth: qwenCodeOAuth },
		models: QWEN_CODE_MODELS,
		api: openAICompletionsApi(),
	}) as Provider;
}

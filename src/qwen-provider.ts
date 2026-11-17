/**
 * Native-shaped pi-ai provider for Qwen Code subscription OAuth.
 * @module dsh-coding-subscription-oauth/qwen-provider
 */

import type { Model, Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { QWEN_PI_PROVIDER } from "./ids.ts";
import { qwenCodeOAuth } from "./qwen-oauth.ts";

/** OpenAI-compatible inference host used by Qwen Code OAuth accounts. */
export const QWEN_PORTAL_BASE_URL = "https://portal.qwen.ai/v1";

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
		baseUrl: QWEN_PORTAL_BASE_URL,
		reasoning: false,
		input,
		cost: ZERO_COST,
		contextWindow,
		maxTokens,
		compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false },
	};
}

/** Stable aliases the Qwen portal resolves server-side to the current coder/vision models. */
export const QWEN_CODE_MODELS: readonly Model<"openai-completions">[] = [
	qwenModel("coder-model", "Qwen Coder", ["text"], 1_048_576, 65_536),
	qwenModel("vision-model", "Qwen Vision", ["text", "image"], 131_072, 32_768),
];

export function qwenCodeProvider(): Provider {
	return createProvider({
		id: QWEN_PI_PROVIDER,
		name: "Qwen Code",
		baseUrl: QWEN_PORTAL_BASE_URL,
		auth: { oauth: qwenCodeOAuth },
		models: QWEN_CODE_MODELS,
		api: openAICompletionsApi(),
	}) as Provider;
}

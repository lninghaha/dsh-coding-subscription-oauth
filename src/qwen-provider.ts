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
 * Baseline catalog used before the first live listing (and when listing fails). The
 * official CLI lists models from `GET {base}/models`; its default subscription model is
 * `qwen3.8-max`. The session replaces this with the live list after sign-in.
 */
export const QWEN_CODE_MODELS: readonly Model<"openai-completions">[] = [
	qwenModel("qwen3.8-max", "Qwen 3.8 Max", ["text"], 262_144, 65_536),
];

/** Descriptor of one model returned by the live listing; materialized onto a baseline template. */
export interface LiveModelEntry {
	id: string;
	name: string;
	input: Model<"openai-completions">["input"];
	contextWindow: number;
	maxTokens: number;
}

const DEFAULT_LIVE_CONTEXT_WINDOW = 262_144;
const DEFAULT_LIVE_MAX_TOKENS = 65_536;
const MODELS_RESPONSE_MAX_BYTES = 1024 * 1024;
const MODELS_TIMEOUT_MS = 5_000;
/** Same id rule as the official CLI: no commas or control/separator characters. */
const MODEL_ID_PATTERN = /^[^,\p{C}\p{Zl}\p{Zp}]+$/u;

/** Parse `GET /models`: `{ data: [{ id, input_modalities?, context_window_tokens? }] }`. */
export function parseQwenModelsResponse(body: unknown): LiveModelEntry[] {
	const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
	if (!Array.isArray(data)) throw new Error("Qwen Code model list response is malformed");
	const seen = new Set<string>();
	const entries: LiveModelEntry[] = [];
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const id = typeof record["id"] === "string" ? record["id"].trim() : "";
		if (id.length === 0 || id.length > 256 || !MODEL_ID_PATTERN.test(id) || seen.has(id)) continue;
		seen.add(id);
		const modalities = record["input_modalities"];
		const image = Array.isArray(modalities) && modalities.includes("image");
		const context = record["context_window_tokens"];
		const contextWindow =
			typeof context === "number" && Number.isSafeInteger(context) && context > 0
				? context
				: DEFAULT_LIVE_CONTEXT_WINDOW;
		entries.push({
			id,
			name: id,
			input: image ? ["text", "image"] : ["text"],
			contextWindow,
			maxTokens: Math.min(DEFAULT_LIVE_MAX_TOKENS, contextWindow),
		});
	}
	if (entries.length === 0) throw new Error("Qwen Code model list is empty");
	return entries;
}

/** List the account's models from the subscription gateway (Bearer, no redirects). */
export async function fetchQwenModels(
	accessToken: string,
	signal: AbortSignal,
	baseUrl: string = QWEN_SUBSCRIPTION_BASE_URL,
): Promise<LiveModelEntry[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": `QwenCode/unknown (${process.platform}; ${process.arch})`,
		},
		redirect: "error",
		signal: AbortSignal.any([AbortSignal.timeout(MODELS_TIMEOUT_MS), signal]),
	});
	if (!response.ok) throw new Error(`Qwen Code model list request failed with status ${response.status}`);
	const text = await response.text();
	if (text.length > MODELS_RESPONSE_MAX_BYTES) throw new Error("Qwen Code model list response is too large");
	return parseQwenModelsResponse(JSON.parse(text));
}

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

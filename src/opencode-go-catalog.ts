/**
 * OpenCode Go known-model metadata used when the live `/models` listing only
 * returns ids. Reasoning efforts follow DSH `PiAiModelProfile.reasoningEfforts`
 * (wire spellings), not the pi-ai runtime `thinkingLevelMap` field name.
 *
 * DSH rule: only `off` may be null ("supported, send nothing"). Every other
 * declared level must carry a non-empty wire string. Unsupported levels must be
 * omitted — DSH pins omitted keys to unsupported when materializing
 * `thinkingLevelMap`. Declaring `minimal: null` etc. makes llm-pi-ai refuse the
 * whole route (glm-5.3 add fails; thinking never materializes).
 */
import type { GoApi } from "./opencode-go-protocol.ts";
import type { ProviderKnownModel, ProviderReasoningEfforts } from "./provider-auth-catalog.ts";

/** DeepSeek Go dialect: high/max on the wire; Off sends nothing. */
const deepseekThinking: ProviderReasoningEfforts = {
	off: null,
	high: "high",
	max: "max",
};
/** GLM Go dialect: high/max; Off sends nothing. */
const glmThinking: ProviderReasoningEfforts = {
	off: null,
	high: "high",
	max: "max",
};
/** Hy Go dialect: off travels as `none`. */
const hyThinking: ProviderReasoningEfforts = {
	off: "none",
	low: "low",
	high: "high",
};
/** Kimi K3: max effort only; Off sends nothing. */
const kimiK3Thinking: ProviderReasoningEfforts = {
	off: null,
	max: "max",
};
const grokThinking: ProviderReasoningEfforts = {
	off: null,
	low: "low",
	medium: "medium",
	high: "high",
};
const grok46Thinking: ProviderReasoningEfforts = {
	off: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
};
const openaiResponsesThinking: ProviderReasoningEfforts = {
	off: null,
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
};

const deepseekCompat = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
	requiresReasoningContentOnAssistantMessages: true,
	thinkingFormat: "deepseek",
} as const;

const completionsCompat = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
} as const;

const qwenCompat = {
	supportsStore: false,
	supportsDeveloperRole: false,
	thinkingFormat: "qwen",
	maxTokensField: "max_tokens",
} as const;

function entry(
	id: string,
	protocol: GoApi,
	extra: Omit<ProviderKnownModel, "id" | "protocol"> = {},
): ProviderKnownModel {
	return { id, protocol, ...extra };
}

/** Embedded fallback for ids the live directory returns without capabilities. */
export const OPENCODE_GO_KNOWN_MODELS: ReadonlyMap<string, ProviderKnownModel> = new Map(
	(
		[
			entry("minimax-m3", "anthropic-messages", {
				name: "MiniMax-M3",
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 131_072,
			}),
			entry("minimax-m2.7", "anthropic-messages", {
				name: "MiniMax-M2.7",
				input: ["text"],
				contextWindow: 204_800,
				maxTokens: 131_072,
			}),
			entry("minimax-m2.5", "anthropic-messages", {
				name: "MiniMax-M2.5",
				input: ["text"],
				contextWindow: 204_800,
				maxTokens: 131_072,
			}),
			entry("qwen3.8-max", "anthropic-messages", { name: "Qwen3.8 Max", input: ["text"] }),
			entry("qwen3.8-flash", "anthropic-messages", { name: "Qwen3.8 Flash", input: ["text"] }),
			entry("qwen3.7-max", "anthropic-messages", {
				name: "Qwen3.7 Max",
				input: ["text"],
				contextWindow: 1_000_000,
				maxTokens: 65_536,
			}),
			entry("qwen3.7-plus", "anthropic-messages", {
				name: "Qwen3.7 Plus",
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 65_536,
			}),
			entry("qwen3.6-plus", "anthropic-messages", {
				name: "Qwen3.6 Plus",
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 65_536,
				compat: { ...qwenCompat },
			}),
			entry("qwen3.5-plus", "anthropic-messages", { name: "Qwen3.5 Plus", input: ["text", "image"] }),
			entry("deepseek-v4-flash", "openai-completions", {
				name: "DeepSeek V4 Flash",
				input: ["text"],
				contextWindow: 1_000_000,
				maxTokens: 384_000,
				reasoningEfforts: deepseekThinking,
				compat: { ...deepseekCompat },
			}),
			entry("deepseek-v4-pro", "openai-completions", {
				name: "DeepSeek V4 Pro",
				input: ["text"],
				contextWindow: 1_000_000,
				maxTokens: 384_000,
				reasoningEfforts: deepseekThinking,
				compat: { ...deepseekCompat },
			}),
			entry("deepseek-v4.1-flash", "openai-completions", {
				name: "DeepSeek V4.1 Flash",
				input: ["text"],
				contextWindow: 1_000_000,
				maxTokens: 384_000,
				reasoningEfforts: deepseekThinking,
				compat: { ...deepseekCompat },
			}),
			entry("deepseek-v4-flash-vision-exp", "openai-completions", {
				name: "DeepSeek V4 Flash Vision Exp",
				input: ["text", "image"],
				reasoningEfforts: deepseekThinking,
				compat: { ...deepseekCompat },
			}),
			entry("deepseek-flash", "openai-completions", {
				name: "DeepSeek Flash",
				input: ["text"],
				reasoningEfforts: deepseekThinking,
				compat: { ...deepseekCompat },
			}),
			entry("glm-5.3-flash", "openai-completions", {
				name: "GLM-5.3-Flash",
				input: ["text"],
				compat: { ...completionsCompat },
				reasoningEfforts: glmThinking,
			}),
			entry("glm-5.3", "openai-completions", {
				name: "GLM-5.3",
				input: ["text"],
				compat: { ...completionsCompat },
				reasoningEfforts: glmThinking,
			}),
			entry("glm-5.2", "openai-completions", {
				name: "GLM-5.2",
				input: ["text"],
				contextWindow: 1_000_000,
				maxTokens: 131_072,
				compat: { ...completionsCompat },
				reasoningEfforts: glmThinking,
			}),
			entry("glm-5.1", "openai-completions", {
				name: "GLM-5.1",
				input: ["text"],
				contextWindow: 202_752,
				maxTokens: 32_768,
				compat: { ...completionsCompat },
			}),
			entry("glm-5", "openai-completions", { name: "GLM-5", input: ["text"], compat: { ...completionsCompat } }),
			entry("kimi-k3", "openai-completions", {
				name: "Kimi K3",
				input: ["text", "image"],
				contextWindow: 1_048_576,
				maxTokens: 131_072,
				compat: { ...completionsCompat },
				reasoningEfforts: kimiK3Thinking,
			}),
			entry("kimi-k2.7-code", "openai-completions", {
				name: "Kimi K2.7 Code",
				input: ["text", "image"],
				contextWindow: 262_144,
				maxTokens: 262_144,
				compat: { ...completionsCompat },
			}),
			entry("kimi-k2.6", "openai-completions", {
				name: "Kimi K2.6",
				input: ["text", "image"],
				contextWindow: 262_144,
				maxTokens: 65_536,
				compat: {
					...completionsCompat,
					thinkingFormat: "deepseek",
					supportsReasoningEffort: false,
					supportsLongCacheRetention: false,
				},
				// Endpoint rejects reasoning_effort; omit efforts (do not declare null levels).
				reasoningEfforts: false,
			}),
			entry("kimi-k2.5", "openai-completions", {
				name: "Kimi K2.5",
				input: ["text", "image"],
				compat: { ...completionsCompat },
			}),
			entry("longcat-2.0", "openai-completions", {
				name: "LongCat-2.0",
				input: ["text"],
				compat: { ...completionsCompat },
			}),
			entry("mimo-v2.5", "openai-completions", {
				name: "MiMo V2.5",
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 128_000,
				compat: { ...completionsCompat },
			}),
			entry("mimo-v2.5-pro", "openai-completions", {
				name: "MiMo V2.5 Pro",
				input: ["text"],
				contextWindow: 1_048_576,
				maxTokens: 128_000,
				compat: { ...completionsCompat },
			}),
			entry("mimo-v2-pro", "openai-completions", {
				name: "MiMo V2 Pro",
				input: ["text"],
				compat: { ...completionsCompat },
			}),
			entry("mimo-v2-omni", "openai-completions", {
				name: "MiMo V2 Omni",
				input: ["text", "image"],
				compat: { ...completionsCompat },
			}),
			entry("hy4-preview", "openai-completions", {
				name: "Hy4 preview",
				input: ["text"],
				compat: { ...completionsCompat },
				reasoningEfforts: hyThinking,
			}),
			entry("hy3", "openai-completions", {
				name: "Hy3",
				input: ["text"],
				contextWindow: 256_000,
				maxTokens: 64_000,
				compat: { ...completionsCompat },
				reasoningEfforts: hyThinking,
			}),
			entry("hy3-preview", "openai-completions", {
				name: "Hy3 preview",
				input: ["text"],
				compat: { ...completionsCompat },
				reasoningEfforts: hyThinking,
			}),
			entry("grok-4.6", "openai-responses", {
				name: "Grok 4.6",
				input: ["text", "image"],
				reasoningEfforts: grok46Thinking,
				compat: { sessionAffinityFormat: "openai-nosession" },
			}),
			entry("grok-4.5", "openai-responses", {
				name: "Grok 4.5",
				input: ["text", "image"],
				contextWindow: 500_000,
				maxTokens: 500_000,
				reasoningEfforts: grokThinking,
				compat: { sessionAffinityFormat: "openai-nosession" },
			}),
			entry("gpt-5.6-luna", "openai-responses", {
				name: "GPT 5.6 Luna",
				input: ["text"],
				reasoningEfforts: openaiResponsesThinking,
			}),
			entry("muse-spark-1.3-contributor", "openai-responses", {
				name: "Muse Spark 1.3 Contributor",
				input: ["text"],
				reasoningEfforts: openaiResponsesThinking,
			}),
			entry("muse-spark-1.2-contributor", "openai-responses", {
				name: "Muse Spark 1.2 Contributor",
				input: ["text"],
				reasoningEfforts: openaiResponsesThinking,
			}),
			entry("omen-alpha", "openai-completions", {
				name: "Omen Alpha",
				input: ["text"],
				compat: { ...completionsCompat },
			}),
		] satisfies ProviderKnownModel[]
	).map((model) => [model.id, model]),
);

export function knownOpenCodeGoModel(id: string): ProviderKnownModel | undefined {
	return OPENCODE_GO_KNOWN_MODELS.get(id);
}

/** 官方 Go 文档在 2026-09-12 披露的协议；新 ID 由用户明确选择协议。
 * https://opencode.ai/docs/zh-cn/go#api-端点
 */
export const GO_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export type GoApi = (typeof GO_APIS)[number];
export function isGoApi(value: unknown): value is GoApi {
	return GO_APIS.includes(value as GoApi);
}
const responses = new Set(["grok-4.6", "gpt-5.6-luna", "muse-spark-1.3-contributor", "muse-spark-1.2-contributor"]);
const messages = new Set([
	"minimax-m3",
	"minimax-m2.7",
	"minimax-m2.5",
	"qwen3.8-max",
	"qwen3.8-flash",
	"qwen3.7-max",
	"qwen3.7-plus",
	"qwen3.6-plus",
]);
const chat = new Set([
	"deepseek-v4.1-flash",
	"deepseek-v4-pro",
	"deepseek-v4-flash",
	"deepseek-v4-flash-vision-exp",
	"glm-5.3-flash",
	"glm-5.3",
	"glm-5.2",
	"glm-5.1",
	"kimi-k3",
	"kimi-k2.7-code",
	"kimi-k2.6",
	"longcat-2.0",
	"mimo-v2.5",
	"mimo-v2.5-pro",
	"hy4-preview",
	"hy3",
]);
export function knownGoApi(id: string): GoApi | undefined {
	return responses.has(id)
		? "openai-responses"
		: messages.has(id)
			? "anthropic-messages"
			: chat.has(id)
				? "openai-completions"
				: undefined;
}
export function protocolMismatch(ids: readonly string[], api: GoApi): boolean {
	return ids.some((id) => {
		const known = knownGoApi(id);
		return known !== undefined && known !== api;
	});
}

/** Anthropic SDK 自行追加 /v1/messages；OpenAI SDK 从 /v1 开始。 */
export function goBaseURL(api: GoApi): string {
	return api === "anthropic-messages" ? "https://opencode.ai/zen/go" : "https://opencode.ai/zen/go/v1";
}

import { describe, expect, it } from "vitest";
import { gatewayGoPreview } from "../src/gateway-go-routing.ts";

describe("Go 网关配置预览", () => {
	it.each([
		["openai-completions", "https://opencode.ai/zen/go/v1", "deepseek-v4.1-flash"],
		["openai-responses", "https://opencode.ai/zen/go/v1", "gpt-5.6-luna"],
		["anthropic-messages", "https://opencode.ai/zen/go", "minimax-m3"],
	])("保留宿主的 %s 协议映射", (api, baseURL, id) => {
		const settings = {
			describe: () => [
				{
					ns: "llm-pi-ai",
					value: {
						providers: {
							"coding-opencode-go": { api, baseURL, apiKeyEnv: "GO_KEY", models: [{ id }] },
						},
					},
				},
			],
		};
		expect(gatewayGoPreview(settings)).toEqual({ credentialRef: "GO_KEY", models: [{ id, protocol: api }] });
		settings.describe = () => [
			{
				ns: "llm-pi-ai",
				value: {
					providers: {
						"coding-opencode-go": {
							api,
							baseURL: "https://example.com/zen/go/v1",
							apiKeyEnv: "GO_KEY",
							models: [{ id }],
						},
					},
				},
			},
		];
		expect(gatewayGoPreview(settings)).toBeNull();
	});

	it("falls back to legacy opencode-go for migration preview", () => {
		const settings = {
			describe: () => [
				{
					ns: "llm-pi-ai",
					value: {
						providers: {
							"opencode-go": {
								api: "openai-completions",
								baseURL: "https://opencode.ai/zen/go/v1",
								apiKeyEnv: "GO_KEY",
								models: [{ id: "deepseek-v4.1-flash" }],
							},
						},
					},
				},
			],
		};
		expect(gatewayGoPreview(settings)).toEqual({
			credentialRef: "GO_KEY",
			models: [{ id: "deepseek-v4.1-flash", protocol: "openai-completions" }],
		});
	});
});

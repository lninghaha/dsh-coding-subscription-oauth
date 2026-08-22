/** Quick-setup code snippets for the local API gateway. */

export type GatewaySnippetId = "curl" | "python" | "ide";

export function buildGatewaySnippets(
	openAiBaseUrl: string,
	anthropicBaseUrl: string,
	apiKeyPlaceholder: string,
	model = "<gateway-model>",
): Record<GatewaySnippetId, string> {
	const key = apiKeyPlaceholder.length > 0 ? apiKeyPlaceholder : "<your-gateway-key>";
	return {
		curl: `curl ${openAiBaseUrl}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`,
		python: `from openai import OpenAI

client = OpenAI(
    base_url="${openAiBaseUrl}",
    api_key="${key}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
		ide: `# OpenAI-compatible client
base_url: ${openAiBaseUrl}
api_key: ${key}

# Anthropic-compatible client
base_url: ${anthropicBaseUrl}
api_key: ${key}`,
	};
}

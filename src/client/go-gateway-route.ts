export interface GoGatewayRoute {
	credentialRef: string;
	models: Array<{ id: string; protocol: "openai-completions" | "openai-responses" | "anthropic-messages" }>;
}

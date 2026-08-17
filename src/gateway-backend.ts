/**
 * Session-backed model listing and text streaming for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-backend
 */

import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { OAuthProviderSession } from "./oauth-session.ts";
import { safeMessage } from "./redact.ts";
import type { GrokBuildSession } from "./session.ts";

export interface GatewayListedModel {
	id: string;
	owned_by: string;
}

export interface GatewayChatMessage {
	role: string;
	content: string;
}

export interface GatewayBackend {
	listModels(): Promise<readonly GatewayListedModel[]>;
	streamText(modelId: string, messages: readonly GatewayChatMessage[]): AsyncIterable<string>;
}

export class GatewayRequestError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

interface OwnedModel {
	owned_by: string;
	model: Model<Api>;
	stream: (
		model: Model<Api>,
		context: Context,
	) => AsyncIterable<{ type: string; delta?: string; errorMessage?: string }>;
}

export function createSessionGatewayBackend(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
): GatewayBackend {
	return {
		async listModels() {
			const listed: GatewayListedModel[] = [];
			for (const owned of await collectOwnedModels(grok, subscriptions)) {
				listed.push({ id: owned.model.id, owned_by: owned.owned_by });
			}
			return listed;
		},
		async *streamText(modelId, messages) {
			const owned = (await collectOwnedModels(grok, subscriptions)).find((item) => item.model.id === modelId);
			if (owned === undefined) throw new GatewayRequestError(404, "model_not_found", `Unknown model ${modelId}`);
			const context = contextFromMessages(messages);
			for await (const event of owned.stream(owned.model, context)) {
				if (event.type === "text_delta" && typeof event.delta === "string" && event.delta.length > 0) {
					yield event.delta;
				}
				if (event.type === "error") {
					throw new GatewayRequestError(502, "upstream_error", event.errorMessage ?? "upstream stream error");
				}
			}
		},
	};
}

async function collectOwnedModels(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
): Promise<OwnedModel[]> {
	const owned: OwnedModel[] = [];
	const grokAuth = await grok.models.getAuth("xai");
	if (grokAuth?.auth.apiKey) {
		for (const model of grok.visibleModels()) {
			owned.push({
				owned_by: "grok-build",
				model,
				stream: (item, context) => grok.models.streamSimple(item, context),
			});
		}
	}
	for (const session of subscriptions) {
		const status = await session.status();
		if (!status.authenticated) continue;
		for (const model of session.visibleModels()) {
			owned.push({
				owned_by: session.definition.route,
				model,
				stream: (item, context) => session.models.streamSimple(item, context),
			});
		}
	}
	return owned;
}

function contextFromMessages(messages: readonly GatewayChatMessage[]): Context {
	let systemPrompt: string | undefined;
	const mapped: Context["messages"] = [];
	for (const message of messages) {
		if (message.role === "system") {
			systemPrompt = `${systemPrompt === undefined ? "" : `${systemPrompt}\n`}${message.content}`;
			continue;
		}
		if (message.role === "assistant") {
			mapped.push({
				role: "assistant",
				content: [{ type: "text", text: message.content }],
				api: "openai-responses",
				provider: "gateway",
				model: "gateway",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			});
			continue;
		}
		mapped.push({ role: "user", content: message.content, timestamp: Date.now() });
	}
	return systemPrompt === undefined ? { messages: mapped } : { systemPrompt, messages: mapped };
}

export function gatewayErrorEnvelope(error: unknown): {
	status: number;
	body: { error: { message: string; type: string; code: string } };
} {
	if (error instanceof GatewayRequestError) {
		return {
			status: error.status,
			body: { error: { message: error.message.slice(0, 1000), type: "invalid_request_error", code: error.code } },
		};
	}
	return {
		status: 500,
		body: { error: { message: safeMessage(error).slice(0, 1000), type: "server_error", code: "internal" } },
	};
}

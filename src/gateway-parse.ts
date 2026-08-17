/**
 * Parse OpenAI / Anthropic request bodies into the gateway completion shape.
 * @module dsh-coding-subscription-oauth/gateway-parse
 */

import { GatewayRequestError } from "./gateway-backend.ts";
import type { GatewayChatMessage, GatewayCompletionRequest, GatewayTool, GatewayToolCall } from "./gateway-protocol.ts";

export function parseOpenAiChatRequest(payload: Record<string, unknown>): GatewayCompletionRequest {
	const model = requiredModel(payload["model"]);
	const tools = parseOpenAiTools(payload["tools"]);
	const reasoning = reasoningOf(payload);
	return {
		model,
		messages: parseOpenAiMessages(payload["messages"]),
		...(tools === undefined ? {} : { tools }),
		...(reasoning === undefined ? {} : { reasoning }),
	};
}

export function parseOpenAiResponsesRequest(payload: Record<string, unknown>): GatewayCompletionRequest {
	const model = requiredModel(payload["model"]);
	const input = payload["input"];
	if (typeof input === "string") {
		return { model, messages: [{ role: "user", content: input }] };
	}
	if (Array.isArray(input)) {
		const tools = parseOpenAiTools(payload["tools"]);
		const reasoning = reasoningOf(payload);
		return {
			model,
			messages: parseOpenAiMessages(input),
			...(tools === undefined ? {} : { tools }),
			...(reasoning === undefined ? {} : { reasoning }),
		};
	}
	throw new GatewayRequestError(400, "invalid_request", "input must be a string or message array");
}

export function parseAnthropicMessagesRequest(payload: Record<string, unknown>): GatewayCompletionRequest {
	const model = requiredModel(payload["model"]);
	const messages = parseAnthropicMessages(payload["messages"]);
	const system = payload["system"];
	if (typeof system === "string" && system.length > 0) {
		messages.unshift({ role: "system", content: system });
	}
	const tools = parseAnthropicTools(payload["tools"]);
	const reasoning = reasoningOf(payload);
	return {
		model,
		messages,
		...(tools === undefined ? {} : { tools }),
		...(reasoning === undefined ? {} : { reasoning }),
	};
}

export function anthropicMaxTokens(payload: Record<string, unknown>): number {
	const value = payload["max_tokens"];
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return Math.min(value, 32_768);
	return 4096;
}

function requiredModel(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new GatewayRequestError(400, "invalid_request", "model is required");
	}
	return value;
}

function reasoningOf(payload: Record<string, unknown>): string | undefined {
	if (typeof payload["reasoning_effort"] === "string") return payload["reasoning_effort"];
	if (typeof payload["reasoning"] === "string") return payload["reasoning"];
	return undefined;
}

function parseOpenAiMessages(value: unknown): GatewayChatMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GatewayRequestError(400, "invalid_request", "messages must be a non-empty array");
	}
	return value.map((item) => {
		if (typeof item !== "object" || item === null) {
			throw new GatewayRequestError(400, "invalid_request", "message must be an object");
		}
		const record = item as Record<string, unknown>;
		const role = record["role"];
		if (typeof role !== "string")
			throw new GatewayRequestError(400, "invalid_request", "message role must be a string");
		const toolCalls = parseToolCalls(record["tool_calls"]);
		return {
			role,
			content: contentToString(record["content"]),
			...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
			...(typeof record["reasoning_content"] === "string" ? { reasoning_content: record["reasoning_content"] } : {}),
			...(typeof record["tool_call_id"] === "string" ? { tool_call_id: record["tool_call_id"] } : {}),
			...(typeof record["name"] === "string" ? { tool_name: record["name"] } : {}),
		};
	});
}

function parseAnthropicMessages(value: unknown): GatewayChatMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GatewayRequestError(400, "invalid_request", "messages must be a non-empty array");
	}
	const mapped: GatewayChatMessage[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) {
			throw new GatewayRequestError(400, "invalid_request", "message must be an object");
		}
		const record = item as Record<string, unknown>;
		const role = record["role"];
		if (role !== "user" && role !== "assistant") {
			throw new GatewayRequestError(400, "invalid_request", "anthropic message role must be user or assistant");
		}
		const blocks = Array.isArray(record["content"]) ? record["content"] : [{ type: "text", text: record["content"] }];
		const texts: string[] = [];
		const toolCalls: GatewayToolCall[] = [];
		let reasoning: string | undefined;
		for (const block of blocks) {
			if (typeof block !== "object" || block === null) continue;
			const entry = block as Record<string, unknown>;
			if (entry["type"] === "text" && typeof entry["text"] === "string") texts.push(entry["text"]);
			if (entry["type"] === "thinking" && typeof entry["thinking"] === "string") reasoning = entry["thinking"];
			if (entry["type"] === "tool_use" && typeof entry["id"] === "string" && typeof entry["name"] === "string") {
				toolCalls.push({
					id: entry["id"],
					name: entry["name"],
					arguments: typeof entry["input"] === "string" ? entry["input"] : JSON.stringify(entry["input"] ?? {}),
				});
			}
			if (entry["type"] === "tool_result" && typeof entry["tool_use_id"] === "string") {
				mapped.push({
					role: "tool",
					content: typeof entry["content"] === "string" ? entry["content"] : JSON.stringify(entry["content"] ?? ""),
					tool_call_id: entry["tool_use_id"],
				});
			}
		}
		mapped.push({
			role,
			content: texts.join(""),
			...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
			...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
		});
	}
	return mapped;
}

function parseOpenAiTools(value: unknown): GatewayTool[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const tools: GatewayTool[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const fn =
			typeof record["function"] === "object" && record["function"] !== null
				? (record["function"] as Record<string, unknown>)
				: record;
		if (typeof fn["name"] !== "string") continue;
		tools.push({
			name: fn["name"],
			description: typeof fn["description"] === "string" ? fn["description"] : "",
			parameters:
				typeof fn["parameters"] === "object" && fn["parameters"] !== null
					? (fn["parameters"] as Record<string, unknown>)
					: {},
		});
	}
	return tools.length === 0 ? undefined : tools;
}

function parseAnthropicTools(value: unknown): GatewayTool[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const tools: GatewayTool[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		if (typeof record["name"] !== "string") continue;
		tools.push({
			name: record["name"],
			description: typeof record["description"] === "string" ? record["description"] : "",
			parameters:
				typeof record["input_schema"] === "object" && record["input_schema"] !== null
					? (record["input_schema"] as Record<string, unknown>)
					: {},
		});
	}
	return tools.length === 0 ? undefined : tools;
}

function parseToolCalls(value: unknown): GatewayToolCall[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const calls: GatewayToolCall[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const fn =
			typeof record["function"] === "object" && record["function"] !== null
				? (record["function"] as Record<string, unknown>)
				: record;
		if (typeof record["id"] !== "string" || typeof fn["name"] !== "string") continue;
		calls.push({
			id: record["id"],
			name: fn["name"],
			arguments: typeof fn["arguments"] === "string" ? fn["arguments"] : JSON.stringify(fn["arguments"] ?? {}),
		});
	}
	return calls.length === 0 ? undefined : calls;
}

function contentToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((part) => {
				if (typeof part === "string") return part;
				if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
					return (part as { text: string }).text;
				}
				return "";
			})
			.join("");
	}
	return "";
}

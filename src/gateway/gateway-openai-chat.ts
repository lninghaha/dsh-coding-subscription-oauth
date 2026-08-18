/**
 * OpenAI-compatible chat completions for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-openai-chat
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { type GatewayBackend, gatewayErrorEnvelope } from "./gateway-backend.ts";
import { beginGatewaySse, readGatewayJsonBody, writeGatewayJson } from "./gateway-body.ts";
import { parseOpenAiChatRequest } from "./gateway-parse.ts";
import type { GatewayStreamPart } from "./gateway-protocol.ts";

export async function handleOpenAiChatCompletions(
	req: IncomingMessage,
	res: ServerResponse,
	backend: GatewayBackend,
): Promise<void> {
	const payload = await readGatewayJsonBody(req);
	const request = parseOpenAiChatRequest(payload);
	const stream = payload["stream"] !== false;
	const id = `chatcmpl_gateway_${Date.now().toString(36)}`;
	if (!stream) {
		const aggregated = await aggregate(backend, request);
		writeGatewayJson(res, 200, {
			id,
			object: "chat.completion",
			model: request.model,
			choices: [
				{
					index: 0,
					message: aggregated.message,
					finish_reason: aggregated.finish,
				},
			],
		});
		return;
	}
	beginGatewaySse(res);
	try {
		let toolIndex = 0;
		for await (const part of backend.stream(request)) {
			const chunk = sseChunk(id, request.model, part, toolIndex);
			if (chunk === undefined) continue;
			if (part.type === "tool_call") toolIndex += 1;
			res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		}
		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		res.write(`data: ${JSON.stringify(gatewayErrorEnvelope(error).body)}\n\n`);
		res.end();
	}
}

async function aggregate(backend: GatewayBackend, request: ReturnType<typeof parseOpenAiChatRequest>) {
	let content = "";
	let reasoning = "";
	const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
	let finish: "stop" | "tool_calls" | "length" = "stop";
	for await (const part of backend.stream(request)) {
		if (part.type === "text") content += part.text;
		if (part.type === "thinking") reasoning += part.text;
		if (part.type === "tool_call") {
			toolCalls.push({ id: part.id, type: "function", function: { name: part.name, arguments: part.arguments } });
		}
		if (part.type === "done") finish = part.finish;
	}
	return {
		finish,
		message: {
			role: "assistant",
			content,
			...(reasoning.length === 0 ? {} : { reasoning_content: reasoning }),
			...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
		},
	};
}

function sseChunk(id: string, model: string, part: GatewayStreamPart, toolIndex: number): unknown {
	if (part.type === "text") {
		return {
			id,
			object: "chat.completion.chunk",
			model,
			choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
		};
	}
	if (part.type === "thinking") {
		return {
			id,
			object: "chat.completion.chunk",
			model,
			choices: [{ index: 0, delta: { reasoning_content: part.text }, finish_reason: null }],
		};
	}
	if (part.type === "tool_call") {
		return {
			id,
			object: "chat.completion.chunk",
			model,
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: toolIndex,
								id: part.id,
								type: "function",
								function: { name: part.name, arguments: part.arguments },
							},
						],
					},
					finish_reason: null,
				},
			],
		};
	}
	return {
		id,
		object: "chat.completion.chunk",
		model,
		choices: [{ index: 0, delta: {}, finish_reason: part.finish }],
	};
}

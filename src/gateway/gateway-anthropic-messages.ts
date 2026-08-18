/**
 * Anthropic Messages API subset for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-anthropic-messages
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { type GatewayBackend, gatewayErrorEnvelope } from "./gateway-backend.ts";
import { beginGatewaySse, readGatewayJsonBody, writeGatewayJson } from "./gateway-body.ts";
import { anthropicMaxTokens, parseAnthropicMessagesRequest } from "./gateway-parse.ts";

export async function handleAnthropicMessages(
	req: IncomingMessage,
	res: ServerResponse,
	backend: GatewayBackend,
): Promise<void> {
	const payload = await readGatewayJsonBody(req);
	const request = parseAnthropicMessagesRequest(payload);
	const maxTokens = anthropicMaxTokens(payload);
	const stream = payload["stream"] === true;
	const id = `msg_gateway_${Date.now().toString(36)}`;
	if (!stream) {
		let text = "";
		const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
		let stop = "end_turn";
		for await (const part of backend.stream(request)) {
			if (part.type === "text") text += part.text;
			if (part.type === "tool_call") {
				let input: unknown = {};
				try {
					input = JSON.parse(part.arguments) as unknown;
				} catch {
					input = { value: part.arguments };
				}
				toolUses.push({ id: part.id, name: part.name, input });
			}
			if (part.type === "done" && part.finish === "tool_calls") stop = "tool_use";
		}
		writeGatewayJson(res, 200, {
			id,
			type: "message",
			role: "assistant",
			model: request.model,
			content: [
				...(text.length === 0 ? [] : [{ type: "text", text }]),
				...toolUses.map((tool) => ({ type: "tool_use", id: tool.id, name: tool.name, input: tool.input })),
			],
			stop_reason: stop,
			usage: { input_tokens: 0, output_tokens: 0 },
			max_tokens: maxTokens,
		});
		return;
	}
	beginGatewaySse(res);
	try {
		res.write(
			`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id, type: "message", role: "assistant", model: request.model, content: [] } })}\n\n`,
		);
		let started = false;
		for await (const part of backend.stream(request)) {
			if (part.type === "text") {
				if (!started) {
					res.write(
						`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
					);
					started = true;
				}
				res.write(
					`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part.text } })}\n\n`,
				);
			}
		}
		if (started) {
			res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
		}
		res.write(
			`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`,
		);
		res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
		res.end();
	} catch (error) {
		res.write(`event: error\ndata: ${JSON.stringify(gatewayErrorEnvelope(error).body)}\n\n`);
		res.end();
	}
}

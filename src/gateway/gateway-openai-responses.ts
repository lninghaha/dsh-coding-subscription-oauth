/**
 * OpenAI Responses API subset for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-openai-responses
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { type GatewayBackend, gatewayErrorEnvelope } from "./gateway-backend.ts";
import { beginGatewaySse, readGatewayJsonBody, writeGatewayJson } from "./gateway-body.ts";
import { parseOpenAiResponsesRequest } from "./gateway-parse.ts";

export async function handleOpenAiResponses(
	req: IncomingMessage,
	res: ServerResponse,
	backend: GatewayBackend,
): Promise<void> {
	const payload = await readGatewayJsonBody(req);
	const request = parseOpenAiResponsesRequest(payload);
	const stream = payload["stream"] !== false;
	const id = `resp_gateway_${Date.now().toString(36)}`;
	if (!stream) {
		let text = "";
		for await (const part of backend.stream(request)) {
			if (part.type === "text") text += part.text;
		}
		writeGatewayJson(res, 200, {
			id,
			object: "response",
			model: request.model,
			status: "completed",
			output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
		});
		return;
	}
	beginGatewaySse(res);
	try {
		res.write(
			`event: response.created\ndata: ${JSON.stringify({ id, object: "response", model: request.model, status: "in_progress" })}\n\n`,
		);
		for await (const part of backend.stream(request)) {
			if (part.type === "text") {
				res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ id, delta: part.text })}\n\n`);
			}
		}
		res.write(
			`event: response.completed\ndata: ${JSON.stringify({ id, object: "response", status: "completed" })}\n\n`,
		);
		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		res.write(`event: error\ndata: ${JSON.stringify(gatewayErrorEnvelope(error).body)}\n\n`);
		res.end();
	}
}

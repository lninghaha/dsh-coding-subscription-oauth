/**
 * OpenAI-compatible chat completions for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-openai-chat
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type GatewayBackend,
	type GatewayChatMessage,
	GatewayRequestError,
	gatewayErrorEnvelope,
} from "./gateway-backend.ts";

const BODY_LIMIT = 1024 * 1024;

export async function handleOpenAiChatCompletions(
	req: IncomingMessage,
	res: ServerResponse,
	backend: GatewayBackend,
): Promise<void> {
	const payload = await readJsonBody(req);
	const model = typeof payload["model"] === "string" ? payload["model"] : "";
	if (model.length === 0) throw new GatewayRequestError(400, "invalid_request", "model is required");
	const messages = parseMessages(payload["messages"]);
	const stream = payload["stream"] !== false;
	const id = `chatcmpl_gateway_${Date.now().toString(36)}`;
	if (!stream) {
		const chunks: string[] = [];
		for await (const delta of backend.streamText(model, messages)) chunks.push(delta);
		writeJson(res, 200, {
			id,
			object: "chat.completion",
			choices: [{ index: 0, message: { role: "assistant", content: chunks.join("") }, finish_reason: "stop" }],
		});
		return;
	}
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store",
		connection: "keep-alive",
	});
	try {
		for await (const delta of backend.streamText(model, messages)) {
			res.write(`data: ${JSON.stringify(sseDelta(id, model, delta))}\n\n`);
		}
		res.write(`data: ${JSON.stringify(sseStop(id, model))}\n\n`);
		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		const envelope = gatewayErrorEnvelope(error);
		res.write(`data: ${JSON.stringify(envelope.body)}\n\n`);
		res.end();
	}
}

function parseMessages(value: unknown): GatewayChatMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GatewayRequestError(400, "invalid_request", "messages must be a non-empty array");
	}
	return value.map((item) => {
		if (typeof item !== "object" || item === null)
			throw new GatewayRequestError(400, "invalid_request", "message must be an object");
		const role = (item as { role?: unknown }).role;
		const content = (item as { content?: unknown }).content;
		if (typeof role !== "string" || typeof content !== "string") {
			throw new GatewayRequestError(400, "invalid_request", "message role and content must be strings");
		}
		return { role, content };
	});
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > BODY_LIMIT) throw new GatewayRequestError(413, "payload_too_large", "request body exceeds 1 MiB");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new GatewayRequestError(400, "invalid_request", "body must be a JSON object");
		}
		return value as Record<string, unknown>;
	} catch (error) {
		if (error instanceof GatewayRequestError) throw error;
		throw new GatewayRequestError(400, "invalid_request", "body is not valid JSON");
	}
}

function sseDelta(id: string, model: string, content: string) {
	return {
		id,
		object: "chat.completion.chunk",
		model,
		choices: [{ index: 0, delta: { content }, finish_reason: null }],
	};
}

function sseStop(id: string, model: string) {
	return {
		id,
		object: "chat.completion.chunk",
		model,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	};
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
	const body = Buffer.from(`${JSON.stringify(value)}\n`);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.byteLength,
		"cache-control": "no-store",
	});
	res.end(body);
}

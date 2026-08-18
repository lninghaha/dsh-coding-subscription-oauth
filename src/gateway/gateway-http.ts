/**
 * Isolated node:http server for the opt-in local gateway.
 * @module dsh-coding-subscription-oauth/gateway-http
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleAnthropicMessages } from "./gateway-anthropic-messages.ts";
import { gatewayKeysEqual } from "./gateway-auth.ts";
import { type GatewayBackend, gatewayErrorEnvelope } from "./gateway-backend.ts";
import { type GatewayConfig, isLoopbackBind } from "./gateway-config.ts";
import { handleOpenAiChatCompletions } from "./gateway-openai-chat.ts";
import { handleOpenAiResponses } from "./gateway-openai-responses.ts";

export interface GatewayHttpOptions {
	config: GatewayConfig;
	apiKey: string;
	backend: GatewayBackend;
}

export function createGatewayHttpServer(options: GatewayHttpOptions): Server {
	if (!isLoopbackBind(options.config.bind) && options.apiKey.length === 0) {
		throw new Error("gateway bind outside loopback requires a Bearer API key");
	}
	return createServer((req, res) => {
		void route(req, res, options).catch((error) => {
			if (res.headersSent) {
				res.end();
				return;
			}
			const envelope = gatewayErrorEnvelope(error);
			writeJson(res, envelope.status, envelope.body);
		});
	});
}

export function listenGateway(server: Server, config: GatewayConfig): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.bind, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

export function closeGateway(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function route(req: IncomingMessage, res: ServerResponse, options: GatewayHttpOptions): Promise<void> {
	const url = new URL(req.url ?? "/", "http://gateway.invalid");
	if (req.method === "GET" && url.pathname === "/healthz") {
		writeJson(res, 200, { ok: true, bind: options.config.bind, port: options.config.port });
		return;
	}
	if (!authorize(req, options.apiKey)) {
		writeJson(res, 401, {
			error: { message: "missing or invalid bearer token", type: "invalid_request_error", code: "unauthorized" },
		});
		return;
	}
	if (req.method === "GET" && url.pathname === "/v1/models") {
		const models = await options.backend.listModels();
		writeJson(res, 200, {
			object: "list",
			data: models.map((model) => ({ id: model.id, object: "model", owned_by: model.owned_by })),
		});
		return;
	}
	if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
		await handleOpenAiChatCompletions(req, res, options.backend);
		return;
	}
	if (req.method === "POST" && url.pathname === "/v1/responses") {
		await handleOpenAiResponses(req, res, options.backend);
		return;
	}
	if (req.method === "POST" && url.pathname === "/v1/messages") {
		await handleAnthropicMessages(req, res, options.backend);
		return;
	}
	writeJson(res, 404, { error: { message: "not found", type: "invalid_request_error", code: "not_found" } });
}

function authorize(req: IncomingMessage, apiKey: string): boolean {
	const header = req.headers.authorization;
	if (typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) return false;
	return gatewayKeysEqual(header.slice(7).trim(), apiKey);
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

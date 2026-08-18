/**
 * Shared JSON body reader for isolated gateway endpoints.
 * @module dsh-coding-subscription-oauth/gateway-body
 */

import type { IncomingMessage } from "node:http";
import { GatewayRequestError } from "./gateway-backend.ts";

const BODY_LIMIT = 1024 * 1024;

export async function readGatewayJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

export function writeGatewayJson(res: import("node:http").ServerResponse, status: number, value: unknown): void {
	const body = Buffer.from(`${JSON.stringify(value)}\n`);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.byteLength,
		"cache-control": "no-store",
	});
	res.end(body);
}

export function beginGatewaySse(res: import("node:http").ServerResponse): void {
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store",
		connection: "close",
	});
}

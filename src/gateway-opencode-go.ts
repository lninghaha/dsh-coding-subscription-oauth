/**
 * Opt-in OpenCode Go chat completions proxy for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-opencode-go
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readGatewayJsonBody, writeGatewayJson } from "./gateway-body.ts";

export const OPENCODE_GO_ORIGIN = "https://opencode.ai";
export const OPENCODE_GO_CHAT_COMPLETIONS_URL = `${OPENCODE_GO_ORIGIN}/zen/go/v1/chat/completions`;

const SESSION_MAP_MAX = 1024;

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailers",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
]);

export interface OpencodeGoSessionMap {
	get(key: string): string | undefined;
	set(key: string, value: string): void;
	readonly size: number;
}

export function createOpencodeGoSessionMap(maxEntries = SESSION_MAP_MAX): OpencodeGoSessionMap {
	const map = new Map<string, string>();
	const limit = Number.isSafeInteger(maxEntries) && maxEntries > 0 ? maxEntries : SESSION_MAP_MAX;
	return {
		get(key) {
			const value = map.get(key);
			if (value === undefined) return undefined;
			map.delete(key);
			map.set(key, value);
			return value;
		},
		set(key, value) {
			if (map.has(key)) map.delete(key);
			map.set(key, value);
			while (map.size > limit) {
				const oldest = map.keys().next().value;
				if (oldest === undefined) break;
				map.delete(oldest);
			}
		},
		get size() {
			return map.size;
		},
	};
}

export function resolveSessionId(
	req: IncomingMessage,
	bodyRecord: Record<string, unknown>,
	sessionMap: OpencodeGoSessionMap,
): string | undefined {
	const inbound =
		headerValue(req, "x-deepseek-harness-session-id") ??
		headerValue(req, "x-opencode-session") ??
		headerValue(req, "x-session-id") ??
		(typeof bodyRecord["session_id"] === "string" && bodyRecord["session_id"].trim().length > 0
			? bodyRecord["session_id"].trim()
			: undefined);
	if (inbound === undefined) return undefined;
	const sticky = sessionMap.get(inbound);
	if (sticky !== undefined) return sticky;
	sessionMap.set(inbound, inbound);
	return inbound;
}

export interface OpencodeGoChatCompletionsDeps {
	fetchImpl: typeof fetch;
	sessionMap: OpencodeGoSessionMap;
	getUpstreamApiKey: () => string;
	isEnabled: () => boolean;
}

export async function handleOpencodeGoChatCompletions(
	req: IncomingMessage,
	res: ServerResponse,
	deps: OpencodeGoChatCompletionsDeps,
): Promise<void> {
	if (deps.isEnabled() !== true) {
		writeGatewayJson(res, 503, {
			error: {
				message: "OpenCode Go proxy is disabled",
				type: "api_error",
				code: "opencode_go_disabled",
			},
		});
		return;
	}
	if (OPENCODE_GO_CHAT_COMPLETIONS_URL !== `${OPENCODE_GO_ORIGIN}/zen/go/v1/chat/completions`) {
		writeGatewayJson(res, 503, {
			error: {
				message: "OpenCode Go upstream is misconfigured",
				type: "api_error",
				code: "opencode_go_misconfigured",
			},
		});
		return;
	}
	const upstreamKey = deps.getUpstreamApiKey().trim();
	if (upstreamKey.length === 0) {
		writeGatewayJson(res, 503, {
			error: {
				message: "OpenCode Go upstream API key is not configured",
				type: "api_error",
				code: "opencode_go_key_missing",
			},
		});
		return;
	}

	const bodyRecord = await readGatewayJsonBody(req);
	const sessionId = resolveSessionId(req, bodyRecord, deps.sessionMap);
	if (sessionId === undefined) {
		writeGatewayJson(res, 400, {
			error: {
				message: "OpenCode Go requires a stable session id header",
				type: "invalid_request_error",
				code: "opencode_go_session_required",
			},
		});
		return;
	}
	const wantStream = bodyRecord["stream"] === true;
	const body = `${JSON.stringify(bodyRecord)}\n`;

	let upstream: Response;
	try {
		upstream = await deps.fetchImpl(OPENCODE_GO_CHAT_COMPLETIONS_URL, {
			method: "POST",
			headers: {
				authorization: `Bearer ${upstreamKey}`,
				"content-type": "application/json",
				accept: wantStream ? "text/event-stream" : "application/json",
				"x-opencode-session": sessionId,
			},
			body,
		});
	} catch {
		writeGatewayJson(res, 503, {
			error: {
				message: "OpenCode Go upstream request failed",
				type: "api_error",
				code: "opencode_go_upstream_error",
			},
		});
		return;
	}

	const contentType = upstream.headers.get("content-type") ?? "";
	const isEventStream = contentType.toLowerCase().includes("text/event-stream");
	const shouldStream = isEventStream || wantStream;

	const headers: Record<string, string> = {
		"cache-control": "no-store",
	};
	upstream.headers.forEach((value, name) => {
		const lower = name.toLowerCase();
		if (HOP_BY_HOP.has(lower)) return;
		headers[lower] = value;
	});
	if (!headers["content-type"] && isEventStream) {
		headers["content-type"] = "text/event-stream; charset=utf-8";
	}

	if (!shouldStream || upstream.body === null) {
		const buffer = Buffer.from(await upstream.arrayBuffer());
		if (!headers["content-type"]) headers["content-type"] = "application/json; charset=utf-8";
		headers["content-length"] = String(buffer.byteLength);
		res.writeHead(upstream.status, headers);
		res.end(buffer);
		return;
	}

	res.writeHead(upstream.status, headers);
	const nodeStream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
	await pipeline(nodeStream, res);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
	const raw = req.headers[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

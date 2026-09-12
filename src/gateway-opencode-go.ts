/**
 * Opt-in OpenCode Go chat completions proxy for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-opencode-go
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GatewayRequestError } from "./gateway-backend.ts";
import { type GatewayGoRoute, GO_PROTOCOL_PATHS } from "./gateway-go-routing.ts";

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

/** 仅显式前缀模型进入这里。密钥、模型及协议均由已确认路由解析。 */
export async function handleOpencodeGoInference(
	req: IncomingMessage,
	res: ServerResponse,
	payload: Record<string, unknown>,
	path: string,
	deps: {
		route: GatewayGoRoute | null;
		resolveCredential: (ref: string) => Promise<string | undefined>;
		fetchImpl: typeof fetch;
	},
): Promise<void> {
	const fail = (status: number, code: string, message: string): never => {
		throw new GatewayRequestError(status, code, message);
	};
	if (!deps.route)
		fail(503, "opencode_go_route_missing", "Configure the prefixed OpenCode Go route in gateway settings");
	const route = deps.route!;
	const id = String(payload["model"]).slice("opencode-go/".length);
	const model = route.models.find((entry) => entry.id === id);
	if (!model) fail(400, "opencode_go_model_unknown", "Choose an OpenCode Go model listed by this gateway");
	if (GO_PROTOCOL_PATHS[model!.protocol] !== path)
		fail(400, "opencode_go_protocol_mismatch", "This OpenCode Go model requires " + GO_PROTOCOL_PATHS[model!.protocol]);
	const sessions = [
		headerValue(req, "x-opencode-session"),
		headerValue(req, "x-deepseek-harness-session-id"),
		headerValue(req, "x-session-id"),
		typeof payload["session_id"] === "string" ? payload["session_id"].trim() : undefined,
	].filter((s): s is string => Boolean(s));
	if (!sessions.length) fail(400, "opencode_go_session_required", "OpenCode Go requires a stable session id header");
	if (new Set(sessions).size !== 1)
		fail(400, "opencode_go_session_conflict", "Conflicting session identifiers; send the current conversation id");
	const key = (await deps.resolveCredential(route.credentialRef))?.trim();
	if (!key)
		fail(
			503,
			"opencode_go_key_missing",
			"The selected upstream credential is unavailable; the local gateway key cannot replace it",
		);
	const headers = new Headers({
		authorization: "Bearer " + key,
		"content-type": "application/json",
		accept: payload["stream"] === true ? "text/event-stream" : "application/json",
		"x-opencode-session": sessions[0]!,
		"user-agent":
			"DeepSeek-Harness-Gateway" + (headerValue(req, "user-agent") ? " (" + headerValue(req, "user-agent") + ")" : ""),
	});
	if (model!.protocol === "anthropic-messages") {
		headers.set("x-api-key", key!);
		const version = headerValue(req, "anthropic-version");
		if (version) headers.set("anthropic-version", version);
		const beta = headerValue(req, "anthropic-beta");
		if (beta) headers.set("anthropic-beta", beta);
	}
	const body: Record<string, unknown> = { ...payload, model: id };
	delete body["session_id"];
	const abort = new AbortController();
	const onClose = () => {
		if (!res.writableFinished) abort.abort();
	};
	res.once("close", onClose);
	try {
		const upstream = await deps.fetchImpl(OPENCODE_GO_ORIGIN + "/zen/go" + path, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: abort.signal,
			redirect: "error",
		});
		const outgoing: Record<string, string> = { "cache-control": "no-store" };
		upstream.headers.forEach((value, name) => {
			if (!HOP_BY_HOP.has(name) && !["content-encoding", "set-cookie"].includes(name)) outgoing[name] = value;
		});
		res.writeHead(upstream.status, outgoing);
		if (upstream.body === null) {
			res.end();
			return;
		}
		// 原样转发 SSE，包括上游 error 事件；中途读取失败必须断开而非伪装成功结束。
		await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res, {
			signal: abort.signal,
		});
	} finally {
		res.off("close", onClose);
	}
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
	const raw = req.headers[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

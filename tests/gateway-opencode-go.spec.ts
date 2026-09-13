import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayBackend } from "../src/gateway-backend.ts";
import { resolveGatewayConfig } from "../src/gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "../src/gateway-http.ts";
import {
	createOpencodeGoSessionMap,
	OPENCODE_GO_CHAT_COMPLETIONS_URL,
	resolveSessionId,
} from "../src/gateway-opencode-go.ts";
import type { GatewayCompletionRequest, GatewayStreamPart } from "../src/gateway-protocol.ts";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

function mockBackend(calls: string[]): GatewayBackend {
	async function* stream(_request: GatewayCompletionRequest): AsyncIterable<GatewayStreamPart> {
		calls.push("backend");
		yield { type: "text", text: "from-backend" };
		yield { type: "done", finish: "stop" };
	}
	return {
		async listModels() {
			return [{ id: "grok-4.6", owned_by: "grok-build" }];
		},
		stream,
		async *streamText(modelId, messages) {
			for await (const part of stream({ model: modelId, messages })) {
				if (part.type === "text") yield part.text;
			}
		},
	};
}

let nextPort = 19_400;

async function listen(options: {
	opencodeGoEnabled: boolean;
	fetchImpl?: typeof fetch;
	sessionMap?: ReturnType<typeof createOpencodeGoSessionMap>;
	backendCalls?: string[];
}): Promise<number> {
	const port = nextPort++;
	const config = resolveGatewayConfig({ enabled: true, bind: "127.0.0.1", port, apiKey: "test-key" });
	const backendCalls = options.backendCalls ?? [];
	const server = createGatewayHttpServer({
		config,
		apiKey: "test-key",
		backend: mockBackend(backendCalls),
		getOpencodeGoRoute: () =>
			options.opencodeGoEnabled
				? { credentialRef: "GO_KEY", models: [{ id: "test-go", protocol: "openai-completions" }] }
				: null,
		resolveGoCredential: async () => "test-upstream-key",
		...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
	});
	await listenGateway(server, config);
	servers.push({ close: () => closeGateway(server) });
	return port;
}

function requestHeaders(extra: Record<string, string> = {}): IncomingMessageLike {
	return {
		headers: {
			host: "127.0.0.1",
			...extra,
		},
	};
}

type IncomingMessageLike = { headers: Record<string, string | string[] | undefined> };

describe("opencodeGo config", () => {
	it("defaults to disabled", () => {
		expect(resolveGatewayConfig().opencodeGo).toEqual({ enabled: false });
		expect(resolveGatewayConfig({ opencodeGo: { enabled: true } }).opencodeGo.enabled).toBe(true);
	});
});

describe("resolveSessionId", () => {
	it("prefers harness, then opencode, then x-session-id, then body session_id", () => {
		const map = createOpencodeGoSessionMap();
		expect(
			resolveSessionId(
				requestHeaders({
					"x-deepseek-harness-session-id": "harness-1",
					"x-opencode-session": "opencode-1",
					"x-session-id": "legacy-1",
				}) as never,
				{ session_id: "body-1" },
				map,
			),
		).toBe("harness-1");
		expect(
			resolveSessionId(
				requestHeaders({
					"x-opencode-session": "opencode-1",
					"x-session-id": "legacy-1",
				}) as never,
				{ session_id: "body-1" },
				map,
			),
		).toBe("opencode-1");
		expect(
			resolveSessionId(requestHeaders({ "x-session-id": "legacy-1" }) as never, { session_id: "body-1" }, map),
		).toBe("legacy-1");
		expect(resolveSessionId(requestHeaders() as never, { session_id: "body-1" }, map)).toBe("body-1");
	});

	it("sticks the same inbound key to one outbound id", () => {
		const map = createOpencodeGoSessionMap();
		const first = resolveSessionId(requestHeaders({ "x-deepseek-harness-session-id": "sticky-a" }) as never, {}, map);
		const second = resolveSessionId(requestHeaders({ "x-deepseek-harness-session-id": "sticky-a" }) as never, {}, map);
		expect(first).toBe("sticky-a");
		expect(second).toBe(first);
	});

	it("rejects an absent stable inbound session instead of inventing an identity", () => {
		const map = createOpencodeGoSessionMap();
		const id = resolveSessionId(requestHeaders() as never, {}, map);
		expect(id).toBeUndefined();
	});
});

describe("opencodeGo chat proxy HTTP", () => {
	it("uses the local backend when the flag is off", async () => {
		const fetchImpl = vi.fn();
		const backendCalls: string[] = [];
		const port = await listen({ opencodeGoEnabled: false, fetchImpl, backendCalls });
		const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-key",
				"content-type": "application/json",
				connection: "close",
			},
			body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }], stream: true }),
		});
		expect(response.status).toBe(200);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(backendCalls).toEqual(["backend"]);
		expect(await response.text()).toContain("from-backend");
	});

	it("proxies to the pinned OpenCode Go URL with sticky x-opencode-session", async () => {
		const seen: Array<{ url: string; session: string | null }> = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			seen.push({ url, session: headers.get("x-opencode-session") });
			expect(headers.get("authorization")).toBe("Bearer test-upstream-key");
			return new Response(JSON.stringify({ id: "upstream", object: "chat.completion", choices: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const sessionMap = createOpencodeGoSessionMap();
		const port = await listen({ opencodeGoEnabled: true, fetchImpl, sessionMap });
		const body = JSON.stringify({
			model: "coding-opencode-go/test-go",
			messages: [{ role: "user", content: "hi" }],
			stream: false,
		});
		const first = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-key",
				"content-type": "application/json",
				"x-deepseek-harness-session-id": "harness-sticky",
				connection: "close",
			},
			body,
		});
		const second = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-key",
				"content-type": "application/json",
				"x-deepseek-harness-session-id": "harness-sticky",
				connection: "close",
			},
			body,
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(seen).toHaveLength(2);
		expect(seen[0]?.url).toBe(OPENCODE_GO_CHAT_COMPLETIONS_URL);
		expect(seen[1]?.url).toBe(OPENCODE_GO_CHAT_COMPLETIONS_URL);
		expect(seen[0]?.session).toBe("harness-sticky");
		expect(seen[1]?.session).toBe(seen[0]?.session);
	});
});

import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { resolveGatewayConfig } from "../src/gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "../src/gateway-http.ts";

const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await closeGateway(s);
});
async function setup(key: string | undefined = "upstream-secret") {
	const backend = {
		listModels: async () => [{ id: "codex/local", owned_by: "codex" }],
		stream: vi.fn(async function* () {
			yield { type: "text", text: "local" };
			yield { type: "done", finish: "stop" };
		}),
		streamText: async function* () {
			yield "local";
		},
	};
	const outbound = vi.fn(
		async () =>
			new Response('data: {"error":{"message":"controlled-stream-error"}}\n\n', {
				headers: { "content-type": "text/event-stream" },
			}),
	);
	const route = {
		credentialRef: "GO_TEST_KEY",
		models: [
			{ id: "test-chat", protocol: "openai-completions" },
			{ id: "test-response", protocol: "openai-responses" },
			{ id: "test-message", protocol: "anthropic-messages" },
		],
	};
	const cfg = resolveGatewayConfig({ port: 19499, enabled: true });
	const server = createGatewayHttpServer({
		config: cfg,
		apiKey: "local-secret",
		backend: backend as never,
		fetchImpl: outbound as never,
		getOpencodeGoRoute: () => route,
		resolveGoCredential: async () => key,
	} as never);
	servers.push(server);
	await listenGateway(server, { ...cfg, port: 0 });
	const address = server.address();
	if (!address || typeof address === "string") throw Error("address");
	const base = `http://127.0.0.1:${address.port}/v1`;
	const post = (path: string, model: string, session: string | undefined = "task-one") =>
		fetch(base + path, {
			method: "POST",
			headers: {
				authorization: "Bearer local-secret",
				"content-type": "application/json",
				...(session ? { "x-opencode-session": session } : {}),
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: "controlled" }],
				input: "controlled",
				max_tokens: 20,
				stream: true,
			}),
		});
	return { outbound, post, backend, base };
}
it("routes only prefixed models and advertises the same protocol mapping", async () => {
	const { post, base, outbound, backend } = await setup();
	const list = await (await fetch(base + "/models", { headers: { authorization: "Bearer local-secret" } })).json();
	expect(list.data.map((m: { id: string }) => m.id)).toEqual([
		"codex/local",
		"opencode-go/test-chat",
		"opencode-go/test-response",
		"opencode-go/test-message",
	]);
	await (await post("/chat/completions", "codex/local")).text();
	expect(backend.stream).toHaveBeenCalledOnce();
	expect(outbound).not.toHaveBeenCalled();
	for (const [path, id] of [
		["/chat/completions", "test-chat"],
		["/responses", "test-response"],
		["/messages", "test-message"],
	]) {
		const res = await post(path!, `opencode-go/${id}`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("controlled-stream-error");
		const [url, init] = outbound.mock.calls.at(-1) as unknown as [string, RequestInit];
		expect(url).toBe("https://opencode.ai/zen/go/v1" + path);
		const h = new Headers(init.headers);
		expect(h.get("x-opencode-session")).toBe("task-one");
		expect(h.get("authorization")).toBe("Bearer upstream-secret");
		expect(h.get("cookie")).toBeNull();
		expect(JSON.parse(String(init.body)).model).toBe(id);
	}
});
it("rejects protocol mismatch and missing session without an upstream request", async () => {
	const { post, outbound } = await setup();
	expect((await post("/messages", "opencode-go/test-chat")).status).toBe(400);
	expect((await post("/chat/completions", "opencode-go/test-chat", "")).status).toBe(400);
	expect(outbound).not.toHaveBeenCalled();
});
it("never substitutes the inbound local key when the upstream reference is unavailable", async () => {
	const { post, outbound } = await setup("");
	const res = await post("/chat/completions", "opencode-go/test-chat");
	expect(res.status).toBe(503);
	expect(outbound).not.toHaveBeenCalled();
});

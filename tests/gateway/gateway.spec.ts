import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodingOAuthGatewayController, startCodingOAuthGateway } from "../../src/gateway/gateway.ts";
import { gatewayKeysEqual, generateGatewayApiKey, loadOrCreateGatewayApiKey } from "../../src/gateway/gateway-auth.ts";
import { assistantReplay, type GatewayBackend, GatewayRequestError } from "../../src/gateway/gateway-backend.ts";
import { randomGatewayPort, resolveGatewayConfig } from "../../src/gateway/gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "../../src/gateway/gateway-http.ts";
import type { GatewayCompletionRequest, GatewayStreamPart } from "../../src/gateway/gateway-protocol.ts";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

function mockBackend(): GatewayBackend {
	const models = [
		{ id: "grok-4.6", owned_by: "grok-build" },
		{ id: "gpt-5.3-codex", owned_by: "codex-oauth" },
		{ id: "kimi-k2.5", owned_by: "kimi-code-oauth" },
		{ id: "claude-opus-4-6", owned_by: "claude-code-oauth" },
	];
	async function* stream(request: GatewayCompletionRequest): AsyncIterable<GatewayStreamPart> {
		const known = models.some((model) => model.id === request.model);
		if (!known) throw new GatewayRequestError(404, "model_not_found", "missing");
		if (request.tools !== undefined && request.tools.length > 0) {
			yield { type: "tool_call", index: 0, id: "call_1", name: request.tools[0]!.name, arguments: '{"q":"hi"}' };
			yield { type: "done", finish: "tool_calls" };
			return;
		}
		yield { type: "text", text: "hello" };
		yield { type: "text", text: " world" };
		yield { type: "done", finish: "stop" };
	}
	return {
		async listModels() {
			return models;
		},
		stream,
		async *streamText(modelId, messages) {
			for await (const part of stream({ model: modelId, messages })) {
				if (part.type === "text") yield part.text;
			}
		},
	};
}

let nextPort = 19_100;

async function listen(backend: GatewayBackend = mockBackend()): Promise<number> {
	const port = nextPort++;
	const config = resolveGatewayConfig({ enabled: true, bind: "127.0.0.1", port, apiKey: "test-key" });
	const server = createGatewayHttpServer({ config, apiKey: "test-key", backend });
	await listenGateway(server, config);
	servers.push({ close: () => closeGateway(server) });
	return port;
}

async function request(
	port: number,
	path: string,
	init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; text: string; headers: Headers }> {
	const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
		method: init.method ?? "GET",
		headers: { connection: "close", ...(init.headers ?? {}) },
		...(init.body === undefined ? {} : { body: init.body }),
	});
	return { status: response.status, text: await response.text(), headers: response.headers };
}

describe("resolveGatewayConfig", () => {
	it("defaults to disabled loopback", () => {
		expect(resolveGatewayConfig()).toEqual({ enabled: false, bind: "127.0.0.1", port: 18080, rateLimit: 0 });
	});

	it("rejects an out-of-range port", () => {
		expect(() => resolveGatewayConfig({ port: 80 })).toThrow(/1024/);
	});

	it("picks a random high port that is not reserved", () => {
		const picked = new Set<number>();
		for (let index = 0; index < 8; index += 1) {
			const port = randomGatewayPort(18_080);
			expect(port).toBeGreaterThanOrEqual(18_100);
			expect(port).toBeLessThanOrEqual(18_999);
			expect(port).not.toBe(18_080);
			picked.add(port);
		}
		expect(picked.size).toBeGreaterThan(0);
	});
});

describe("gateway API key file", () => {
	it("creates an owner-only key file and compares in constant time", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-gateway-key-"));
		const path = join(dir, ".coding-oauth-gateway.json");
		const created = await loadOrCreateGatewayApiKey(path);
		expect(created.length).toBeGreaterThan(20);
		expect(await loadOrCreateGatewayApiKey(path)).toBe(created);
		expect(gatewayKeysEqual(created, created)).toBe(true);
		expect(gatewayKeysEqual(created, generateGatewayApiKey())).toBe(false);
		const document = JSON.parse(await readFile(path, "utf8")) as { apiKey: string };
		expect(document.apiKey).toBe(created);
	});
});

describe("assistant replay placeholders", () => {
	it("adds empty reasoning_content when an assistant message carries tool calls", () => {
		const replayed = assistantReplay({
			role: "assistant",
			content: "",
			tool_calls: [{ id: "call_1", name: "search", arguments: "{}" }],
		});
		expect(replayed.role).toBe("assistant");
		if (replayed.role !== "assistant") return;
		expect(replayed.content.some((part) => part.type === "thinking" && part.thinking === "")).toBe(true);
		expect(replayed.content.some((part) => part.type === "toolCall")).toBe(true);
	});
});

describe("gateway HTTP", () => {
	it("serves healthz without a bearer token", async () => {
		const port = await listen();
		const response = await request(port, "/healthz");
		expect(response.status).toBe(200);
		expect(JSON.parse(response.text)).toMatchObject({ ok: true, bind: "127.0.0.1", port });
	});

	it("rejects models and chat without a bearer token", async () => {
		const port = await listen();
		expect((await request(port, "/v1/models")).status).toBe(401);
		expect(
			(
				await request(port, "/v1/chat/completions", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] }),
				})
			).status,
		).toBe(401);
	});

	it("lists all signed-in providers and streams chat completions", async () => {
		const port = await listen();
		const auth = { authorization: "Bearer test-key" };
		const models = await request(port, "/v1/models", { headers: auth });
		expect(models.status).toBe(200);
		expect(JSON.parse(models.text).data.map((item: { id: string }) => item.id)).toEqual([
			"grok-4.6",
			"gpt-5.3-codex",
			"kimi-k2.5",
			"claude-opus-4-6",
		]);
		const chat = await request(port, "/v1/chat/completions", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ model: "kimi-k2.5", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(chat.status).toBe(200);
		expect(chat.headers.get("content-type")).toMatch(/text\/event-stream/);
		expect(chat.text).toContain("hello");
		expect(chat.text).toContain(" world");
		expect(chat.text).toContain("data: [DONE]");
		expect(chat.text).not.toContain('"tool_calls":[]');
	});

	it("streams tool_calls with an index and never an empty array", async () => {
		const port = await listen();
		const chat = await request(port, "/v1/chat/completions", {
			method: "POST",
			headers: { authorization: "Bearer test-key", "content-type": "application/json" },
			body: JSON.stringify({
				model: "grok-4.6",
				messages: [{ role: "user", content: "hi" }],
				tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }],
			}),
		});
		expect(chat.status).toBe(200);
		expect(chat.text).toContain('"index":0');
		expect(chat.text).toContain("search");
		expect(chat.text).not.toContain('"tool_calls":[]');
	});

	it("serves OpenAI Responses and Anthropic Messages", async () => {
		const port = await listen();
		const auth = { authorization: "Bearer test-key", "content-type": "application/json" };
		const responses = await request(port, "/v1/responses", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: "gpt-5.3-codex", input: "hi" }),
		});
		expect(responses.status).toBe(200);
		expect(responses.text).toContain("response.output_text.delta");
		const messages = await request(port, "/v1/messages", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				model: "claude-opus-4-6",
				max_tokens: 128,
				stream: true,
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(messages.status).toBe(200);
		expect(messages.text).toContain("content_block_delta");
		expect(messages.text).toContain("message_stop");
	});
});

describe("startCodingOAuthGateway", () => {
	it("is a no-op when disabled", async () => {
		expect(await startCodingOAuthGateway({ config: { enabled: false }, backend: mockBackend() })).toBeUndefined();
	});

	it("starts and stops an enabled loopback server", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-gateway-start-"));
		const started = await startCodingOAuthGateway({
			config: { enabled: true, bind: "127.0.0.1", port: 19_160, apiKey: "loop-key" },
			backend: mockBackend(),
			dshHome: dir,
		});
		expect(started).toBeDefined();
		servers.push(started!);
		const health = await request(19_160, "/healthz");
		expect(health.status).toBe(200);
	});

	it("toggles and rotates through the controller", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-gateway-ctl-"));
		const controller = createCodingOAuthGatewayController({
			config: { enabled: false, bind: "127.0.0.1", port: 19_161, apiKey: "first-key-value-aaaa" },
			backend: mockBackend(),
			dshHome: dir,
		});
		servers.push({ close: () => controller.stop() });
		expect((await controller.status()).running).toBe(false);
		const enabled = await controller.setEnabled(true);
		expect(enabled.running).toBe(true);
		expect(enabled.keyHint).toContain("aaaa");
		const rotated = await controller.rotateKey();
		expect(rotated.apiKey).not.toBe("first-key-value-aaaa");
		expect(rotated.keyHint.startsWith("****")).toBe(true);
		await controller.setEnabled(false);
		expect((await controller.status()).running).toBe(false);
	});

	it("reveals the current key without rotating it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-gateway-reveal-"));
		const controller = createCodingOAuthGatewayController({
			config: { enabled: false, bind: "127.0.0.1", port: 19_162, apiKey: "reveal-key-value-bbbb" },
			backend: mockBackend(),
			dshHome: dir,
		});
		servers.push({ close: () => controller.stop() });
		const first = await controller.revealKey();
		const second = await controller.revealKey();
		expect(first.apiKey).toBe("reveal-key-value-bbbb");
		expect(second.apiKey).toBe(first.apiKey);
		expect(first.keyHint).toContain("bbbb");
		const status = await controller.status();
		expect(status).not.toHaveProperty("apiKey");
		expect(status.keyHint).toBe(first.keyHint);
		const rotated = await controller.rotateKey();
		expect(rotated.apiKey).not.toBe(first.apiKey);
		expect((await controller.revealKey()).apiKey).toBe(rotated.apiKey);
	});

	it("persists a user-selected port and rebinds when running", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-gateway-port-"));
		const controller = createCodingOAuthGatewayController({
			config: { enabled: false, bind: "127.0.0.1", port: 19_170, apiKey: "port-key-value-cccc" },
			backend: mockBackend(),
			dshHome: dir,
		});
		servers.push({ close: () => controller.stop() });
		expect((await controller.setPort(19_171)).port).toBe(19_171);
		expect((await controller.status()).port).toBe(19_171);
		expect((await controller.setEnabled(true)).running).toBe(true);
		const rebound = await controller.setPort(19_172);
		expect(rebound.port).toBe(19_172);
		expect(rebound.running).toBe(true);
		expect((await request(19_172, "/healthz")).status).toBe(200);
		await expect(controller.setPort(80)).rejects.toThrow(/1024/);
		expect((await controller.status()).port).toBe(19_172);
	});
});

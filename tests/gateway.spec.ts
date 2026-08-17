import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCodingOAuthGateway } from "../src/gateway.ts";
import { gatewayKeysEqual, generateGatewayApiKey, loadOrCreateGatewayApiKey } from "../src/gateway-auth.ts";
import { type GatewayBackend, GatewayRequestError } from "../src/gateway-backend.ts";
import { resolveGatewayConfig } from "../src/gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "../src/gateway-http.ts";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

function mockBackend(): GatewayBackend {
	return {
		async listModels() {
			return [{ id: "grok-4.6", owned_by: "grok-build" }];
		},
		async *streamText(modelId) {
			if (modelId !== "grok-4.6") throw new GatewayRequestError(404, "model_not_found", "missing");
			yield "hello";
			yield " world";
		},
	};
}

let nextPort = 19_100;

async function listen(): Promise<number> {
	const port = nextPort++;
	const config = resolveGatewayConfig({ enabled: true, bind: "127.0.0.1", port, apiKey: "test-key" });
	const server = createGatewayHttpServer({ config, apiKey: "test-key", backend: mockBackend() });
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

	it("lists models and streams chat completions", async () => {
		const port = await listen();
		const auth = { authorization: "Bearer test-key" };
		const models = await request(port, "/v1/models", { headers: auth });
		expect(models.status).toBe(200);
		expect(JSON.parse(models.text).data).toEqual([{ id: "grok-4.6", object: "model", owned_by: "grok-build" }]);
		const chat = await request(port, "/v1/chat/completions", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(chat.status).toBe(200);
		expect(chat.headers.get("content-type")).toMatch(/text\/event-stream/);
		expect(chat.text).toContain("hello");
		expect(chat.text).toContain(" world");
		expect(chat.text).toContain("data: [DONE]");
	});
});

describe("startCodingOAuthGateway", () => {
	it("is a no-op when disabled", async () => {
		expect(await startCodingOAuthGateway({ config: { enabled: false }, backend: mockBackend() })).toBeUndefined();
	});

	it("starts and stops an enabled loopback server", async () => {
		const started = await startCodingOAuthGateway({
			config: { enabled: true, bind: "127.0.0.1", port: 19_160, apiKey: "loop-key" },
			backend: mockBackend(),
		});
		expect(started).toBeDefined();
		servers.push(started!);
		const health = await request(19_160, "/healthz");
		expect(health.status).toBe(200);
	});
});

import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import { CODING_OAUTH_LOGIN_PATH, CODING_OAUTH_STATUS_PATH, registerCodingOAuthRoutes } from "../src/auth-routes.ts";
import { OAUTH_PROVIDER_DEFINITIONS } from "../src/oauth-providers.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import { GrokBuildSession } from "../src/session.ts";
import { GrokBuildCredentialStore, OAuthCredentialFileStore } from "../src/store.ts";

interface RegisteredRoute {
	path: string;
	handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

class TestResponse {
	status = 0;
	body = "";

	writeHead(status: number): this {
		this.status = status;
		return this;
	}

	end(value?: string): this {
		this.body += value ?? "";
		return this;
	}
}

function request(body: string, headers: IncomingMessage["headers"] = {}, method = "POST"): IncomingMessage {
	const stream = Readable.from([body]) as unknown as IncomingMessage;
	Object.defineProperties(stream, {
		method: { value: method, configurable: true },
		headers: { value: { host: "127.0.0.1:3080", ...headers }, configurable: true },
		socket: { value: { remoteAddress: "127.0.0.1" }, configurable: true },
	});
	return stream;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function loginHandler(): Promise<RegisteredRoute["handler"]> {
	const directory = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-routes-"));
	temporaryDirectories.push(directory);
	const routes = new Map<string, RegisteredRoute["handler"]>();
	const cleanups: Array<() => void | Promise<void>> = [];
	const context = {
		webServer: {
			register(route: RegisteredRoute) {
				routes.set(route.path, route.handler);
				return () => routes.delete(route.path);
			},
		},
		llm: { listProviders: () => [] },
		effect(setup: () => void | (() => void | Promise<void>)) {
			const cleanup = setup();
			if (typeof cleanup === "function") cleanups.push(cleanup);
		},
	} as unknown as Context;
	registerCodingOAuthRoutes(
		context,
		new GrokBuildSession(new GrokBuildCredentialStore(join(directory, "auth.json"))),
		[],
	);
	const handler = routes.get(CODING_OAUTH_LOGIN_PATH);
	if (handler === undefined) throw new Error("login route was not registered");
	return handler;
}

async function codingStatusHandler(
	listProviders: () => readonly { id: string }[],
): Promise<RegisteredRoute["handler"]> {
	const directory = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-status-"));
	temporaryDirectories.push(directory);
	const routes = new Map<string, RegisteredRoute["handler"]>();
	const context = {
		webServer: {
			register(route: RegisteredRoute) {
				routes.set(route.path, route.handler);
				return () => routes.delete(route.path);
			},
		},
		llm: { listProviders },
		effect(setup: () => void | (() => void | Promise<void>)) {
			setup();
		},
	} as unknown as Context;
	const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
		(definition) =>
			new OAuthProviderSession(
				definition,
				undefined,
				new OAuthCredentialFileStore(
					definition.nativeProviderId,
					join(directory, definition.authFilename),
					definition.route,
				),
				join(directory, definition.modelsCacheFilename),
			),
	);
	registerCodingOAuthRoutes(
		context,
		new GrokBuildSession(new GrokBuildCredentialStore(join(directory, "grok-auth.json"))),
		subscriptions,
	);
	const handler = routes.get(CODING_OAUTH_STATUS_PATH);
	if (handler === undefined) throw new Error("status route was not registered");
	return handler;
}

describe("Coding OAuth HTTP body guards", () => {
	it("returns 400 for malformed JSON instead of a generic route failure", async () => {
		const handler = await loginHandler();
		const response = new TestResponse();
		await handler(request("{not-json"), response as unknown as ServerResponse);
		expect(response.status).toBe(400);
		expect(JSON.parse(response.body)).toEqual({ error: "request body must contain valid JSON" });
	});

	it("returns 413 before parsing an oversized declared body", async () => {
		const handler = await loginHandler();
		const response = new TestResponse();
		await handler(request("", { "content-length": String(64 * 1024 + 1) }), response as unknown as ServerResponse);
		expect(response.status).toBe(413);
		expect(JSON.parse(response.body)).toEqual({ error: "request body is too large" });
	});

	it("keeps loopback and cross-site request protections ahead of body parsing", async () => {
		const handler = await loginHandler();
		const response = new TestResponse();
		await handler(request("{}", { "sec-fetch-site": "cross-site" }), response as unknown as ServerResponse);
		expect(response.status).toBe(403);
	});
});

describe("Coding OAuth Antigravity status", () => {
	for (const [label, providers, installed] of [
		["installed", [{ id: "agy" }], true],
		["absent", [{ id: "codex-oauth" }], false],
	] as const) {
		it(`reports Antigravity as ${label}`, async () => {
			const handler = await codingStatusHandler(() => providers);
			const response = new TestResponse();
			await handler(request("", {}, "GET"), response as unknown as ServerResponse);
			expect(response.status).toBe(200);
			expect(JSON.parse(response.body).antigravity).toEqual({
				installed,
				route: "agy",
				management: "cli",
			});
		});
	}

	it("contains adapter-list failures and keeps the account cards usable", async () => {
		const handler = await codingStatusHandler(() => {
			throw new Error("unrelated adapter registry failure");
		});
		const response = new TestResponse();
		await handler(request("", {}, "GET"), response as unknown as ServerResponse);
		expect(response.status).toBe(200);
		expect(JSON.parse(response.body).antigravity).toEqual({
			installed: false,
			route: "agy",
			management: "cli",
		});
	});
});

function createAuthRouteContext(failOnPath?: string): {
	routes: Map<string, RegisteredRoute["handler"]>;
	cleanups: Array<() => void | Promise<void>>;
	context: Context;
} {
	const routes = new Map<string, RegisteredRoute["handler"]>();
	const cleanups: Array<() => void | Promise<void>> = [];
	const context = {
		webServer: {
			register(route: RegisteredRoute) {
				if (failOnPath !== undefined && route.path === failOnPath) {
					throw new Error(`webserver: duplicate exact route "${route.path}"`);
				}
				routes.set(route.path, route.handler);
				return () => {
					routes.delete(route.path);
				};
			},
		},
		llm: { listProviders: () => [] },
		effect(setup: () => void | (() => void | Promise<void>)) {
			const cleanup = setup();
			if (typeof cleanup === "function") cleanups.push(cleanup);
		},
	} as unknown as Context;
	return { routes, cleanups, context };
}

function unusedSession(): GrokBuildSession {
	return {} as GrokBuildSession;
}

describe("OAuth route registrar atomic setup", () => {
	it("rolls back earlier Coding routes when a later register throws", () => {
		const { routes, context } = createAuthRouteContext(CODING_OAUTH_LOGIN_PATH);
		expect(() => registerCodingOAuthRoutes(context, unusedSession(), [])).toThrow(
			`webserver: duplicate exact route "${CODING_OAUTH_LOGIN_PATH}"`,
		);
		expect(routes.has(CODING_OAUTH_STATUS_PATH)).toBe(false);
		expect(routes.has(CODING_OAUTH_LOGIN_PATH)).toBe(false);
	});
});

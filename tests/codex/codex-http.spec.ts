import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	assertCodexBackendUrl,
	type CodexFetch,
	chatgptAccountIdFromAccessToken,
	codexAuthFromSession,
	createCodexHttpClient,
	parseRetryAfterMs,
	providerDetail,
} from "../../src/codex/codex-http.ts";

function jwtWithAccount(accountId: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
	).toString("base64url");
	return `${header}.${payload}.sig`;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function mockFetch(impl: CodexFetch): Mock<CodexFetch> {
	return vi.fn(impl);
}

function mockFetchSequence(impls: CodexFetch[]): Mock<CodexFetch> {
	const queue = [...impls];
	return vi.fn(async (input: string, init?: RequestInit) => {
		const next = queue.shift();
		if (next === undefined) throw new Error("unexpected extra fetch");
		return next(input, init);
	});
}

beforeEach(() => {
	vi.stubGlobal("fetch", () => {
		throw new Error("unexpected real network");
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("chatgptAccountIdFromAccessToken", () => {
	it("returns the full JWT chatgpt_account_id claim without truncation", () => {
		const accountId = "acct_full-account-id-does-not-get-sliced";
		expect(chatgptAccountIdFromAccessToken(jwtWithAccount(accountId))).toBe(accountId);
	});

	it("rejects a non-JWT or claim-less token", () => {
		expect(chatgptAccountIdFromAccessToken("not-a-jwt")).toBeUndefined();
		expect(chatgptAccountIdFromAccessToken(jwtWithAccount(""))).toBeUndefined();
	});
});

describe("assertCodexBackendUrl", () => {
	it("accepts only private chatgpt.com /backend-api URLs", () => {
		expect(assertCodexBackendUrl("https://chatgpt.com/backend-api/wham/usage").pathname).toBe(
			"/backend-api/wham/usage",
		);
		expect(() => assertCodexBackendUrl("https://api.openai.com/v1/images")).toThrow(/private ChatGPT backend/);
		expect(() => assertCodexBackendUrl("https://chatgpt.com/backend-api")).toThrow(/backend-api paths/);
		expect(() => assertCodexBackendUrl("http://chatgpt.com/backend-api/wham/usage")).toThrow(/private ChatGPT backend/);
	});

	it("rejects custom ports and userinfo", () => {
		expect(() => assertCodexBackendUrl("https://chatgpt.com:8443/backend-api/wham/usage")).toThrow(
			/private ChatGPT backend/,
		);
		expect(() => assertCodexBackendUrl("https://user:pass@chatgpt.com/backend-api/wham/usage")).toThrow(
			/private ChatGPT backend/,
		);
		expect(assertCodexBackendUrl("https://chatgpt.com:443/backend-api/wham/usage").hostname).toBe("chatgpt.com");
	});
});

describe("providerDetail", () => {
	it("runs every provider body through safeMessage", () => {
		const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart";
		expect(providerDetail({ error: `expired ${jwt}` })).toBe("expired [redacted token]");
		expect(providerDetail(`Bearer secret-token ${jwt}`)).toBe("Bearer [redacted] [redacted token]");
	});
});

describe("createCodexHttpClient", () => {
	it("sends Bearer plus the full JWT account claim", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }));
		const accessToken = jwtWithAccount("acct-from-jwt-full");
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken, accountId: "truncated" }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).resolves.toEqual({
			ok: true,
		});
		const [url, init = {}] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
		expect(headers.get("chatgpt-account-id")).toBe("acct-from-jwt-full");
		expect(init.redirect).toBe("error");
	});

	it("ignores caller Authorization, chatgpt-account-id, and Accept overrides", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }));
		const accessToken = jwtWithAccount("acct-locked");
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await client.requestJson({
			url: "https://chatgpt.com/backend-api/wham/usage",
			headers: {
				Authorization: "Bearer attacker",
				"chatgpt-account-id": "attacker-acct",
				Accept: "text/plain",
				"cache-control": "no-store",
			},
		});
		const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
		expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
		expect(headers.get("chatgpt-account-id")).toBe("acct-locked");
		expect(headers.get("accept")).toBe("application/json");
		expect(headers.get("cache-control")).toBe("no-store");
	});

	it("invalidates and refreshes exactly once on 401", async () => {
		const first = jwtWithAccount("acct-old");
		const second = jwtWithAccount("acct-new");
		let token = first;
		const invalidate = vi.fn(async () => {
			token = second;
		});
		const fetchImpl = mockFetchSequence([
			async () => jsonResponse(401, { error: "expired" }),
			async () => jsonResponse(200, { ok: true }),
		]);
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: token }),
				invalidate,
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).resolves.toEqual({
			ok: true,
		});
		expect(invalidate).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const secondHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
		expect(secondHeaders.get("chatgpt-account-id")).toBe("acct-new");
	});

	it("maps a retried 401 5xx through the bounded server retry budget", async () => {
		const fetchImpl = mockFetchSequence([
			async () => jsonResponse(401, { error: "expired" }),
			async () => jsonResponse(503, { error: "busy" }),
			async () => jsonResponse(200, { ok: true }),
		]);
		const sleep = vi.fn(async () => {});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep,
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).resolves.toEqual({
			ok: true,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledOnce();
	});

	it("maps a retried 401 transport failure through the bounded transport budget", async () => {
		const fetchImpl = mockFetchSequence([
			async () => jsonResponse(401, { error: "expired" }),
			async () => {
				throw new Error("socket reset");
			},
			async () => jsonResponse(200, { ok: true }),
		]);
		const sleep = vi.fn(async () => {});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep,
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).resolves.toEqual({
			ok: true,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledOnce();
	});

	it("redacts provider bodies on the post-refresh 401 AUTH error", async () => {
		const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart";
		const fetchImpl = mockFetchSequence([
			async () => jsonResponse(401, { error: "expired" }),
			async () => jsonResponse(401, { error: `still bad ${jwt}` }),
		]);
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" }).then(
			() => expect.unreachable("second 401 must fail"),
			(error: unknown) => {
				expect((error as { code?: string }).code).toBe("AUTH");
				expect((error as Error).message).toContain("[redacted token]");
				expect((error as Error).message).not.toContain(jwt);
			},
		);
	});

	it("rejects a Content-Length above maxBytes without reading the body", async () => {
		const cancel = vi.fn(async () => {});
		const fetchImpl = mockFetch(async () => {
			const response = {
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json", "content-length": "999999" }),
				body: {
					getReader() {
						throw new Error("body must not be read when Content-Length exceeds maxBytes");
					},
					cancel,
				},
			};
			return response as unknown as Response;
		});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(
			client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage", maxBytes: 16 }),
		).rejects.toMatchObject({ code: "SERVER" });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("enforces a running maxBytes cap while streaming the body", async () => {
		const fetchImpl = mockFetch(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"pad":"'));
					controller.enqueue(new TextEncoder().encode("x".repeat(64)));
					controller.enqueue(new TextEncoder().encode('"}'));
					controller.close();
				},
			});
			return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
		});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(
			client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage", maxBytes: 16 }),
		).rejects.toMatchObject({ code: "SERVER" });
	});

	it("cancels a streaming reader when the caller aborts mid-body", async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			start() {
				// Leave the first read pending until the AbortSignal cancels it.
			},
			cancel(reason) {
				cancel(reason);
			},
		});
		const fetchImpl = mockFetch(
			async () => new Response(stream, { status: 200, headers: { "content-type": "application/json" } }),
		);
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
		});
		const controller = new AbortController();
		const pending = client.requestJson({
			url: "https://chatgpt.com/backend-api/wham/usage",
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(new Error("stop"));
		await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("enforces a per-attempt wall-clock timeout at the fetch boundary", async () => {
		const fetchImpl = mockFetch(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (!(signal instanceof AbortSignal)) throw new Error("missing timeout signal");
					const onAbort = (): void => reject(new DOMException("timed out", "AbortError"));
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}),
		);
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			requestTimeoutMs: 5,
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).rejects.toMatchObject({
			code: "TIMEOUT",
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("maps 403 to QUOTA without retrying", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(403, { error: "not entitled" }));
		const invalidate = vi.fn(async () => {});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate,
			},
			fetchImpl,
			sleep: async () => {},
		});
		await client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" }).then(
			() => expect.unreachable("403 must fail"),
			(error: unknown) => {
				expect((error as { code?: string }).code).toBe("QUOTA");
				expect((error as { failure?: { status?: number } }).failure?.status).toBe(403);
				expect((error as Error).message).toMatch(/cannot use this Codex capability/);
			},
		);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("maps 429 to RATE_LIMIT and parses Retry-After", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(429, { message: "slow down" }, { "retry-after": "12" }));
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" }).then(
			() => expect.unreachable("429 must fail"),
			(error: unknown) => {
				expect((error as { code?: string }).code).toBe("RATE_LIMIT");
				expect((error as { failure?: { providerRetryAfterMs?: number } }).failure?.providerRetryAfterMs).toBe(12_000);
			},
		);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("retries limited 5xx then succeeds", async () => {
		const fetchImpl = mockFetchSequence([
			async () => jsonResponse(503, { error: "busy" }),
			async () => jsonResponse(502, { error: "bad gateway" }),
			async () => jsonResponse(200, { ok: true }),
		]);
		const sleep = vi.fn(async () => {});
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep,
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).resolves.toEqual({
			ok: true,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("gives up after the limited 5xx budget", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(500, { error: "down" }));
		const client = createCodexHttpClient({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
			maxServerRetries: 2,
		});
		await expect(client.requestJson({ url: "https://chatgpt.com/backend-api/wham/usage" })).rejects.toMatchObject({
			code: "SERVER",
			failure: { status: 500 },
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("adapts an OAuthProviderSession-shaped resolver", async () => {
		const session = {
			resolveAccessToken: vi.fn(async () => jwtWithAccount("from-session")),
			invalidateAccessToken: vi.fn(async () => {}),
		};
		const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }));
		const client = createCodexHttpClient({ auth: codexAuthFromSession(session), fetchImpl, sleep: async () => {} });
		await client.requestJson({
			url: "https://chatgpt.com/backend-api/codex/alpha/search",
			method: "POST",
			body: { q: "x" },
		});
		expect(session.resolveAccessToken).toHaveBeenCalledOnce();
		expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("chatgpt-account-id")).toBe("from-session");
	});
});

describe("parseRetryAfterMs", () => {
	it("accepts delta-seconds and future HTTP dates", () => {
		expect(parseRetryAfterMs("7", () => 0)).toBe(7000);
		expect(parseRetryAfterMs("0", () => 0)).toBeUndefined();
		const parsed = parseRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", () =>
			Date.parse("Wed, 21 Oct 2015 07:27:00 GMT"),
		);
		expect(parsed).toBe(60_000);
	});
});

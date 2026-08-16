import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CodexFetch } from "../src/codex-http.ts";
import { createCodexSearchProvider, externalWebAccess, mapCodexSearchResponse } from "../src/codex-search.ts";

function jwtWithAccount(accountId: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
	).toString("base64url");
	return `${header}.${payload}.sig`;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(impl?: CodexFetch): Mock<CodexFetch> {
	return impl === undefined ? vi.fn<CodexFetch>() : vi.fn(impl);
}

beforeEach(() => {
	vi.stubGlobal("fetch", () => {
		throw new Error("unexpected real network");
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("externalWebAccess", () => {
	it("maps only the verified live/cached/indexed values", () => {
		expect(externalWebAccess("live")).toBe(true);
		expect(externalWebAccess("cached")).toBe(false);
		expect(externalWebAccess("indexed")).toBe("indexed");
	});
});

describe("mapCodexSearchResponse", () => {
	it("keeps de-duplicated http(s) text_result URLs and ignores other types", () => {
		const mapped = mapCodexSearchResponse({
			output: "summary",
			results: [
				{ type: "text_result", url: "https://example.com/a", title: "A", snippet: "one" },
				{ type: "image_result", url: "https://example.com/img" },
				{ type: "text_result", url: "ftp://example.com/bad" },
				{ type: "text_result", url: "https://example.com/a" },
				{ type: "text_result", url: "https://example.com/b" },
				{ type: "unknown_future_result", url: "https://example.com/future" },
				{ type: "text_result", url: "not-a-url" },
			],
		});
		expect(mapped).toEqual({
			content: "summary",
			truncated: false,
			sources: [{ url: "https://example.com/a", title: "A", snippet: "one" }, { url: "https://example.com/b" }],
		});
	});

	it("honours maxResults without inventing titles", () => {
		const mapped = mapCodexSearchResponse(
			{
				output: "",
				results: [
					{ type: "text_result", url: "https://example.com/1" },
					{ type: "text_result", url: "https://example.com/2" },
				],
			},
			1,
		);
		expect(mapped.content).toBeUndefined();
		expect(mapped.sources).toEqual([{ url: "https://example.com/1" }]);
		expect(mapped.truncated).toBe(true);
	});

	it("rejects invalid maxResults instead of treating them as unlimited", () => {
		const payload = {
			output: "x",
			results: [
				{ type: "text_result", url: "https://example.com/1" },
				{ type: "text_result", url: "https://example.com/2" },
			],
		};
		expect(() => mapCodexSearchResponse(payload, 0)).toThrow(/maxResults/);
		expect(() => mapCodexSearchResponse(payload, -1)).toThrow(/maxResults/);
		expect(() => mapCodexSearchResponse(payload, Number.POSITIVE_INFINITY)).toThrow(/maxResults/);
		expect(() => mapCodexSearchResponse(payload, Number.NaN)).toThrow(/maxResults/);
	});
});

describe("createCodexSearchProvider", () => {
	it("POSTs the verified search body with injected auth", async () => {
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				output: "ok",
				results: [{ type: "text_result", url: "https://example.com/doc" }],
			}),
		);
		const provider = createCodexSearchProvider({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-search") }),
				invalidate: async () => {},
			},
			fetchImpl,
			model: "gpt-5.4",
			mode: "indexed",
			contextSize: "high",
			maxOutputTokens: 512,
			resolveRequestId: () => "req-1",
			sleep: async () => {},
		});
		expect(provider.id).toBe("codex-oauth-search");
		expect(provider.available()).toBe(true);
		const result = await provider.search({ query: "dsh plugin" });
		expect(result.sources.map((source) => source.url)).toEqual(["https://example.com/doc"]);
		const [url, init = {}] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			id: "req-1",
			model: "gpt-5.4",
			input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "dsh plugin" }] }],
			commands: { search_query: [{ q: "dsh plugin" }] },
			settings: {
				search_context_size: "high",
				allowed_callers: ["direct"],
				external_web_access: "indexed",
			},
			max_output_tokens: 512,
		});
		expect(new Headers(init.headers).get("chatgpt-account-id")).toBe("acct-search");
	});

	it("rejects an empty query without calling the network", async () => {
		const fetchImpl = mockFetch();
		const provider = createCodexSearchProvider({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			model: "gpt-5.4",
		});
		await expect(provider.search({ query: "   " })).rejects.toMatchObject({ code: "INVALID_ARGS" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("rejects invalid maxResults before calling the network", async () => {
		const fetchImpl = mockFetch();
		const provider = createCodexSearchProvider({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct") }),
				invalidate: async () => {},
			},
			fetchImpl,
			model: "gpt-5.4",
		});
		await expect(provider.search({ query: "dsh", maxResults: 0 })).rejects.toMatchObject({ code: "INVALID_ARGS" });
		await expect(provider.search({ query: "dsh", maxResults: Number.NaN })).rejects.toMatchObject({
			code: "INVALID_ARGS",
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

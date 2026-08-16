import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CodexFetch } from "../src/codex-http.ts";
import {
	applyCodexFastStreamOptions,
	CODEX_OAUTH_FAST_ROUTE,
	CODEX_ROUTING_HINT_HEADER,
	type CodexFastStreamOptions,
	type CodexOnPayload,
	type CodexStreamModel,
	codexModelsUrl,
	codexRoutingHint,
	composeCodexFastOnPayload,
	createCodexModelCapabilities,
	parseCodexModelCapabilities,
	withCodexFastRouting,
} from "../src/codex-model-capabilities.ts";

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

function mockFetch(impl: CodexFetch): Mock<CodexFetch> {
	return vi.fn(impl);
}

beforeEach(() => {
	vi.stubGlobal("fetch", () => {
		throw new Error("unexpected real network");
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("parseCodexModelCapabilities", () => {
	it("reads service_tiers and ignores unknown items", () => {
		expect(
			parseCodexModelCapabilities({
				models: [
					{ slug: "gpt-5.4", service_tiers: [{ id: "standard" }, { id: "priority" }] },
					{ id: "gpt-5.3-codex", service_tiers: ["flex"] },
					{ slug: "", service_tiers: [{ id: "priority" }] },
					"nope",
				],
			}),
		).toEqual([
			{ id: "gpt-5.4", serviceTiers: ["standard", "priority"] },
			{ id: "gpt-5.3-codex", serviceTiers: ["flex"] },
		]);
	});

	it("does not invent a hardcoded catalog", () => {
		expect(parseCodexModelCapabilities(undefined)).toEqual([]);
		expect(parseCodexModelCapabilities({ models: {} })).toEqual([]);
	});
});

describe("createCodexModelCapabilities", () => {
	it("fetches live models with client_version and caches tiers", async () => {
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				models: [{ slug: "gpt-5.4", service_tiers: [{ id: "priority" }, { id: "standard" }] }],
			}),
		);
		const caps = createCodexModelCapabilities({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-models") }),
				invalidate: async () => {},
			},
			fetchImpl,
			clientVersion: "9.9.9",
			sleep: async () => {},
			now: () => 1,
			ttlMs: 60_000,
		});
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(false);
		await caps.refresh();
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(codexModelsUrl("9.9.9"));
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(true);
		expect(caps.isPriorityEligible("unknown-model")).toBe(false);
		expect(caps.serviceTiers("gpt-5.4")).toEqual(["priority", "standard"]);
		await caps.refresh();
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("clears account-scoped eligibility and forces a fresh catalog read", async () => {
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				models: [{ slug: "gpt-5.4", service_tiers: [{ id: "priority" }] }],
			}),
		);
		const caps = createCodexModelCapabilities({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-models") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await caps.refresh();
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(true);
		caps.clear();
		expect(caps.getCached()).toBeUndefined();
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(false);
		await caps.refresh();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("leaves eligibility empty when the live catalog fails", async () => {
		const fetchImpl = mockFetch(async () => jsonResponse(500, { error: "down" }));
		const caps = createCodexModelCapabilities({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-models") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(caps.refresh()).resolves.toEqual([]);
		expect(caps.getCached()).toBeUndefined();
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(false);
	});

	it("treats a stale TTL as unknown rather than the last catalog", async () => {
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				models: [{ slug: "gpt-5.4", service_tiers: [{ id: "priority" }] }],
			}),
		);
		let now = 1_000;
		const caps = createCodexModelCapabilities({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-models") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
			now: () => now,
			ttlMs: 1_000,
		});
		await caps.refresh();
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(true);
		now = 3_000;
		expect(caps.getCached()).toBeUndefined();
		expect(caps.isPriorityEligible("gpt-5.4")).toBe(false);
		expect(caps.isTierEligible("gpt-5.4", "priority")).toBe(false);
		expect(caps.serviceTiers("gpt-5.4")).toEqual([]);
	});
});

describe("composeCodexFastOnPayload", () => {
	it("injects service_tier only for eligible models and preserves an existing tier", async () => {
		const composed = composeCodexFastOnPayload(async (payload) => ({ ...(payload as object), marked: true }), {
			isEligible: (id) => id === "gpt-5.4",
			serviceTier: "priority",
		});
		await expect(composed({ model: "gpt-5.4", input: [] }, { id: "gpt-5.4" })).resolves.toEqual({
			model: "gpt-5.4",
			input: [],
			marked: true,
			service_tier: "priority",
		});
		await expect(composed({ model: "gpt-5.3-codex" }, { id: "gpt-5.3-codex" })).resolves.toEqual({
			model: "gpt-5.3-codex",
			marked: true,
		});
		await expect(composed({ model: "gpt-5.4", service_tier: "flex" }, { id: "gpt-5.4" })).resolves.toEqual({
			model: "gpt-5.4",
			marked: true,
			service_tier: "flex",
		});
	});

	it("is fail-closed when isEligible returns false", async () => {
		const composed = composeCodexFastOnPayload((payload) => payload, { isEligible: () => false });
		await expect(composed({ model: "gpt-5.4" }, { id: "gpt-5.4" })).resolves.toEqual({ model: "gpt-5.4" });
	});
});

describe("withCodexFastRouting", () => {
	it("preserves a normal unwrapped provider and does not mutate it", () => {
		const stream = vi.fn((_model: CodexStreamModel, _context: unknown, _options?: CodexFastStreamOptions) => "stream");
		const streamSimple = vi.fn(
			(_model: CodexStreamModel, _context: unknown, _options?: CodexFastStreamOptions) => "simple",
		);
		const base = {
			id: "openai-codex",
			headers: { originator: "pi" } as Record<string, string | null>,
			stream,
			streamSimple,
		};
		const wrapped = withCodexFastRouting(base, {
			isEligible: () => true,
			profileProviderId: CODEX_OAUTH_FAST_ROUTE,
			nativeProviderId: "openai-codex",
		});
		expect(base.id).toBe("openai-codex");
		expect(base.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(wrapped.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(wrapped.id).toBe(CODEX_OAUTH_FAST_ROUTE);
		expect(CODEX_OAUTH_FAST_ROUTE).toBe("codex-oauth-fast");
		base.streamSimple({ id: "gpt-5.4" }, {}, { onPayload: (payload: unknown) => payload });
		expect(streamSimple).toHaveBeenCalledOnce();
		const rawOptions = streamSimple.mock.calls[0]?.[2] as CodexFastStreamOptions | undefined;
		expect(rawOptions?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
	});

	it("restores native model.provider for the base wire call while using a distinct profile id", () => {
		const seen: Array<{ model: CodexStreamModel; options?: CodexFastStreamOptions }> = [];
		const wrapped = withCodexFastRouting(
			{
				id: "openai-codex",
				headers: { originator: "pi" } as Record<string, string | null>,
				stream: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push({ model, ...(options === undefined ? {} : { options }) });
					return "stream";
				},
				streamSimple: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push({ model, ...(options === undefined ? {} : { options }) });
					return "simple";
				},
			},
			{
				isEligible: () => true,
				profileProviderId: CODEX_OAUTH_FAST_ROUTE,
				nativeProviderId: "openai-codex",
			},
		);
		expect(wrapped.id).toBe("codex-oauth-fast");
		wrapped.stream({ id: "gpt-5.4", provider: "codex-oauth-fast" }, {}, { temperature: 0 });
		expect(seen[0]?.model).toEqual({ id: "gpt-5.4", provider: "openai-codex" });
	});

	it("injects the exact per-model header and service_tier body through streamSimple when eligible", async () => {
		const seen: CodexFastStreamOptions[] = [];
		const wrapped = withCodexFastRouting(
			{
				id: "openai-codex",
				stream: (_model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push(options ?? {});
					return "stream";
				},
				streamSimple: (_model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push(options ?? {});
					return "simple";
				},
			},
			{ isEligible: (id) => id === "gpt-5.4" },
		);
		const applied = applyCodexFastStreamOptions(
			{ temperature: 0 } as CodexFastStreamOptions & { temperature: number },
			{ isEligible: () => true },
			"gpt-5.4",
		);
		expect(applied.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe(codexRoutingHint("gpt-5.4"));
		expect(applied.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe("model=gpt-5.4;tier=priority");
		expect(applied.temperature).toBe(0);
		wrapped.streamSimple({ id: "gpt-5.4", provider: "openai-codex" }, {}, { onPayload: (payload) => payload });
		const recorded = seen[0];
		expect(recorded?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe("model=gpt-5.4;tier=priority");
		await expect(recorded?.onPayload?.({ model: "gpt-5.4" }, { id: "gpt-5.4" })).resolves.toMatchObject({
			service_tier: "priority",
		});
	});

	it("does not inject header or body when the model is not eligible", async () => {
		const seen: CodexFastStreamOptions[] = [];
		const wrapped = withCodexFastRouting(
			{
				id: "openai-codex",
				stream: () => "stream",
				streamSimple: (_model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push(options ?? {});
					return "simple";
				},
			},
			{ isEligible: () => false },
		);
		wrapped.streamSimple({ id: "gpt-5.3-codex" }, {}, { onPayload: (payload) => payload });
		expect(seen[0]?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(await seen[0]?.onPayload?.({ model: "gpt-5.3-codex" }, { id: "gpt-5.3-codex" })).toEqual({
			model: "gpt-5.3-codex",
		});
	});

	it("chains an inner onPayload and existing headers without dropping them", async () => {
		const inner: CodexOnPayload = async (payload) => ({ ...(payload as object), marked: true });
		const applied = applyCodexFastStreamOptions(
			{ onPayload: inner, headers: { originator: "pi" } },
			{ isEligible: () => true },
			"gpt-5.4",
		);
		expect(applied.headers).toEqual({
			originator: "pi",
			[CODEX_ROUTING_HINT_HEADER]: "model=gpt-5.4;tier=priority",
		});
		await expect(applied.onPayload?.({ model: "gpt-5.4", input: [] }, { id: "gpt-5.4" })).resolves.toEqual({
			model: "gpt-5.4",
			input: [],
			marked: true,
			service_tier: "priority",
		});
	});

	it("does not inject when eligibility comes from a stale catalog", async () => {
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				models: [{ slug: "gpt-5.4", service_tiers: [{ id: "priority" }] }],
			}),
		);
		let now = 1;
		const caps = createCodexModelCapabilities({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-models") }),
				invalidate: async () => {},
			},
			fetchImpl,
			sleep: async () => {},
			now: () => now,
			ttlMs: 10,
		});
		await caps.refresh();
		now = 100;
		const seen: CodexFastStreamOptions[] = [];
		const wrapped = withCodexFastRouting(
			{
				id: "openai-codex",
				stream: () => "stream",
				streamSimple: (_model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push(options ?? {});
					return "simple";
				},
			},
			{ isEligible: (id) => caps.isPriorityEligible(id) },
		);
		wrapped.streamSimple({ id: "gpt-5.4" }, {});
		expect(seen[0]?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(seen[0]?.onPayload).toBeUndefined();
	});
});

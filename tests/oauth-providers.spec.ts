import type { AuthContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODEX_ROUTING_HINT_HEADER,
	type CodexFastStreamOptions,
	type CodexStreamModel,
	codexRoutingHint,
	withCodexFastRouting,
} from "../src/codex-model-capabilities.ts";
import {
	CLAUDE_CODE_OAUTH_ROUTE,
	CLAUDE_PI_PROVIDER,
	CODEX_OAUTH_FAST_ROUTE,
	CODEX_OAUTH_ROUTE,
	CODEX_PI_PROVIDER,
	CODING_OAUTH_OPTIONAL_ROUTES,
	CODING_OAUTH_ROUTES,
	KIMI_CODE_OAUTH_ROUTE,
	KIMI_PI_PROVIDER,
} from "../src/ids.ts";
import { CLAUDE_CODE_OAUTH_PROVIDER, CODEX_OAUTH_PROVIDER, KIMI_CODE_OAUTH_PROVIDER } from "../src/oauth-providers.ts";

const ctx: AuthContext = {
	env: async () => undefined,
	fileExists: async () => false,
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("OAuth request providers", () => {
	it("bridges a Codex OAuth token through the apiKey override seam", async () => {
		const provider = CODEX_OAUTH_PROVIDER.requestProvider();
		const auth = await provider.auth.apiKey?.resolve({
			ctx,
			credential: { type: "api_key", key: "codex-token" },
			signal: new AbortController().signal,
		});
		expect(provider.id).toBe(CODEX_PI_PROVIDER);
		expect(provider.getModels().every((model) => model.provider === CODEX_PI_PROVIDER)).toBe(true);
		expect(auth?.auth).toEqual({ apiKey: "codex-token" });
	});

	it("bridges a Kimi OAuth token only as Authorization Bearer", async () => {
		const provider = KIMI_CODE_OAUTH_PROVIDER.requestProvider();
		const auth = await provider.auth.apiKey?.resolve({
			ctx,
			credential: { type: "api_key", key: "kimi-token" },
			signal: new AbortController().signal,
		});
		expect(provider.id).toBe(KIMI_PI_PROVIDER);
		expect(provider.getModels().every((model) => model.provider === KIMI_PI_PROVIDER)).toBe(true);
		expect(auth?.auth).toEqual({ headers: { Authorization: "Bearer kimi-token" } });
		expect(auth?.auth.apiKey).toBeUndefined();
	});

	it("removes the Kimi apiKey carrier before the Anthropic SDK builds wire headers", async () => {
		let requestHeaders: Headers | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				const request = input instanceof Request ? input : new Request(input, init);
				requestHeaders = request.headers;
				return new Response(JSON.stringify({ error: { message: "fixture stop" } }), {
					status: 401,
					headers: { "content-type": "application/json" },
				});
			}),
		);
		const provider = KIMI_CODE_OAUTH_PROVIDER.requestProvider();
		const model = provider.getModels()[0]!;
		const stream = provider.streamSimple(
			model,
			{ messages: [] },
			{
				apiKey: "kimi-access-token",
				headers: { Authorization: "Bearer kimi-access-token" },
			},
		);
		expect((await stream.result()).stopReason).toBe("error");
		expect(requestHeaders?.get("authorization")).toBe("Bearer kimi-access-token");
		expect(requestHeaders?.get("x-api-key")).toBeNull();
	});

	it("keeps Claude model identity native and filters selected ids", () => {
		const all = CLAUDE_CODE_OAUTH_PROVIDER.requestProvider().getModels();
		expect(all.length).toBeGreaterThan(1);
		const chosen = all[0]!;
		const provider = CLAUDE_CODE_OAUTH_PROVIDER.requestProvider([chosen.id]);
		expect(provider.id).toBe(CLAUDE_PI_PROVIDER);
		expect(provider.getModels().map((model) => model.id)).toEqual([chosen.id]);
		expect(provider.getModels()[0]?.provider).toBe(CLAUDE_PI_PROVIDER);
	});

	it("uses collision-free Harness route aliases", () => {
		expect(CODEX_OAUTH_PROVIDER.route).toBe(CODEX_OAUTH_ROUTE);
		expect(KIMI_CODE_OAUTH_PROVIDER.route).toBe(KIMI_CODE_OAUTH_ROUTE);
		expect(CLAUDE_CODE_OAUTH_PROVIDER.route).toBe(CLAUDE_CODE_OAUTH_ROUTE);
		expect(
			new Set([CODEX_OAUTH_PROVIDER.route, KIMI_CODE_OAUTH_PROVIDER.route, CLAUDE_CODE_OAUTH_PROVIDER.route]).size,
		).toBe(3);
	});

	it("keeps ordinary Codex native and Fast outside the default route list", () => {
		const provider = CODEX_OAUTH_PROVIDER.requestProvider();
		expect(provider.id).toBe(CODEX_PI_PROVIDER);
		expect(provider.getModels().every((model) => model.provider === CODEX_PI_PROVIDER)).toBe(true);
		expect(CODING_OAUTH_ROUTES).not.toContain(CODEX_OAUTH_FAST_ROUTE);
		expect(CODING_OAUTH_OPTIONAL_ROUTES).toEqual([CODEX_OAUTH_FAST_ROUTE]);
	});

	it("injects Fast hint and service_tier only on the wrapped provider", async () => {
		const seen: Array<{ model: CodexStreamModel; options?: CodexFastStreamOptions }> = [];
		const base = {
			...CODEX_OAUTH_PROVIDER.requestProvider(),
			id: CODEX_PI_PROVIDER,
			stream: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
				seen.push({ model, ...(options === undefined ? {} : { options }) });
				return "stream";
			},
			streamSimple: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
				seen.push({ model, ...(options === undefined ? {} : { options }) });
				return "simple";
			},
		};
		base.streamSimple({ id: "gpt-5.4", provider: CODEX_PI_PROVIDER }, {}, { onPayload: (payload) => payload });
		expect(seen[0]?.model.provider).toBe(CODEX_PI_PROVIDER);
		expect(seen[0]?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(await seen[0]?.options?.onPayload?.({ model: "gpt-5.4" }, { id: "gpt-5.4" })).toEqual({ model: "gpt-5.4" });

		const wrapped = withCodexFastRouting(base, {
			isEligible: (id) => id === "gpt-5.4",
			profileProviderId: CODEX_OAUTH_FAST_ROUTE,
			nativeProviderId: CODEX_PI_PROVIDER,
		});
		expect(wrapped.id).toBe(CODEX_OAUTH_FAST_ROUTE);
		wrapped.streamSimple({ id: "gpt-5.4", provider: CODEX_OAUTH_FAST_ROUTE }, {}, { onPayload: (payload) => payload });
		const fast = seen[1];
		expect(fast?.model).toEqual({ id: "gpt-5.4", provider: CODEX_PI_PROVIDER });
		expect(fast?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe(codexRoutingHint("gpt-5.4"));
		await expect(fast?.options?.onPayload?.({ model: "gpt-5.4" }, { id: "gpt-5.4" })).resolves.toMatchObject({
			model: "gpt-5.4",
			service_tier: "priority",
		});
	});
});

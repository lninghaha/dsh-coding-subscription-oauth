import { describe, expect, it, vi } from "vitest";
import type { CodexUsage } from "../src/codex-usage.ts";
import {
	codexWindows,
	createLimitsReader,
	type LimitFetch,
	parseClaudeUsage,
	parseKimiUsage,
	parseQwenEntitlement,
	qwenEntitlementUsageUrl,
} from "../src/limits.ts";
import type { OAuthProviderSession } from "../src/oauth-session.ts";

function fakeSession(slug: string, authenticated = true, token: string | undefined = "tok") {
	return {
		definition: { slug },
		status: vi.fn(async () => ({ authenticated })),
		resolveAccessToken: vi.fn(async () => token),
		invalidateAccessToken: vi.fn(async () => undefined),
	} as unknown as OAuthProviderSession & {
		invalidateAccessToken: ReturnType<typeof vi.fn>;
	};
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("limit parsers", () => {
	it("parses Claude usage windows, clamps percent, skips null buckets", () => {
		const windows = parseClaudeUsage({
			five_hour: { utilization: 42.5, resets_at: "2026-11-17T20:00:00.123456+00:00" },
			seven_day: { utilization: 130, resets_at: null },
			seven_day_opus: null,
			seven_day_sonnet: { utilization: "x" },
		});
		expect(windows).toEqual([
			{
				id: "five_hour",
				usedPercent: 42.5,
				windowSeconds: 18_000,
				resetsAt: Date.parse("2026-11-17T20:00:00Z") / 1000,
			},
			{ id: "seven_day", usedPercent: 100, windowSeconds: 604_800 },
		]);
		expect(() => parseClaudeUsage("nope")).toThrow();
	});

	it("parses Kimi summary and windowed limits (used or remaining)", () => {
		const windows = parseKimiUsage({
			usage: { limit: "100", used: "25", resetTime: "2026-11-20T00:00:00Z" },
			limits: [
				{
					window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
					detail: { limit: 50, remaining: 40, name: "Burst" },
				},
				{ detail: { limit: 0, used: 0 } },
			],
		});
		expect(windows).toEqual([
			{
				id: "kimi-summary",
				usedPercent: 25,
				windowSeconds: 604_800,
				resetsAt: Date.parse("2026-11-20T00:00:00Z") / 1000,
			},
			{ id: "kimi-limit-0", name: "Burst", usedPercent: 20, windowSeconds: 18_000 },
		]);
	});

	it("projects Codex rate-limit windows", () => {
		const usage: CodexUsage = {
			rateLimits: [
				{
					id: "codex",
					name: "Codex",
					windows: [{ usedPercent: 10, remainingPercent: 90, windowSeconds: 18_000, resetsAt: 5 }],
				},
				{ id: "x", name: "Spark", windows: [{ usedPercent: 3, remainingPercent: 97, windowSeconds: 604_800 }] },
			],
			fetchedAt: 1,
		};
		expect(codexWindows(usage)).toEqual([
			{ id: "codex:0", usedPercent: 10, windowSeconds: 18_000, resetsAt: 5 },
			{ id: "x:0", name: "Spark", usedPercent: 3, windowSeconds: 604_800 },
		]);
	});
});

describe("limits reader", () => {
	it("reads Claude usage with the OAuth beta header and caches within the TTL", async () => {
		const fetchImpl = vi.fn<LimitFetch>(async () => json({ five_hour: { utilization: 5 } }));
		let t = 1_000;
		const reader = createLimitsReader({ sessions: [fakeSession("claude")], fetchImpl, now: () => t });
		const first = await reader.read("claude");
		expect(first).toMatchObject({ provider: "claude", status: "ok", windows: [{ id: "five_hour", usedPercent: 5 }] });
		const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/api/oauth/usage");
		expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "anthropic-beta": "oauth-2025-04-20" });
		expect(init.redirect).toBe("error");
		await reader.read("claude");
		expect(fetchImpl).toHaveBeenCalledOnce();
		t += 61_000;
		await reader.read("claude");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("rate-limits forced refreshes to once per 15s", async () => {
		const fetchImpl = vi.fn<LimitFetch>(async () => json({ usage: { limit: 10, used: 1 } }));
		let t = 0;
		const reader = createLimitsReader({ sessions: [fakeSession("kimi")], fetchImpl, now: () => t });
		await reader.read("kimi");
		t += 5_000;
		await reader.read("kimi", { force: true });
		expect(fetchImpl).toHaveBeenCalledOnce();
		t += 11_000;
		await reader.read("kimi", { force: true });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("reports stable error codes (never bodies) and invalidates the token on 401", async () => {
		const session = fakeSession("kimi");
		const reader = createLimitsReader({
			sessions: [session],
			fetchImpl: async () => new Response("secret-body", { status: 401 }),
		});
		const result = await reader.read("kimi");
		expect(result).toMatchObject({ status: "error", code: "http_401", windows: [] });
		expect(JSON.stringify(result)).not.toContain("secret-body");
		expect(session.invalidateAccessToken).toHaveBeenCalledOnce();
	});

	it("does not call the network when signed out, and gates Codex behind its capability", async () => {
		const fetchImpl = vi.fn<LimitFetch>();
		const read = vi.fn(async () => ({ rateLimits: [], fetchedAt: 1 }) as CodexUsage);
		let enabled = false;
		const reader = createLimitsReader({
			sessions: [fakeSession("claude", false), fakeSession("codex")],
			codex: { read, enabled: () => enabled },
			fetchImpl,
		});
		expect(await reader.read("claude")).toMatchObject({ status: "signed-out" });
		expect(await reader.read("codex")).toMatchObject({ status: "disabled" });
		enabled = true;
		reader.clear();
		expect(await reader.read("codex")).toMatchObject({ status: "ok" });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledOnce();
	});

	it("reports Grok as no-data", async () => {
		const reader = createLimitsReader({ sessions: [], fetchImpl: vi.fn<LimitFetch>() });
		expect(await reader.read("grok")).toMatchObject({ status: "no-data", windows: [] });
	});

	it("reads Qwen usage from the entitlement endpoint with the page's origin and keeps the plan", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn<LimitFetch>(async (url) => {
			calls.push(url);
			return json({
				success: true,
				httpCode: 200,
				data: { quotas: [{ title: "Weekly credits", total: 200, used: 50, resetTime: 1_800_000_000_000 }] },
			});
		});
		vi.stubEnv("QWEN_CODE_OAUTH_HOST", "http://127.0.0.1:9");
		const reader = createLimitsReader({ sessions: [fakeSession("qwen")], fetchImpl });
		const result = await reader.read("qwen");
		vi.unstubAllEnvs();
		expect(result).toMatchObject({
			status: "ok",
			windows: [{ name: "Weekly credits", usedPercent: 25, windowSeconds: 604_800, resetsAt: 1_800_000_000 }],
		});
		expect(calls[0]).toContain("https://sg-entitlement.qwen.com/api/entitlement/agent/usage?biz_id=ai_qwen");
		const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).toMatchObject({
			Authorization: "Bearer tok",
			Origin: "https://chat.qwen.ai",
			Referer: "https://chat.qwen.ai/settings/usage-billing",
		});
	});

	it("degrades Qwen to no-data with a stable code when the endpoint rejects the token", async () => {
		const fetchImpl = vi.fn<LimitFetch>(async () =>
			json({ success: false, httpCode: 401, errorCode: "NOT_LOGIN", errorMsg: "User not logged in", traceId: "t" }),
		);
		vi.stubEnv("QWEN_CODE_OAUTH_HOST", "http://127.0.0.1:9");
		const reader = createLimitsReader({ sessions: [fakeSession("qwen")], fetchImpl });
		const result = await reader.read("qwen");
		vi.unstubAllEnvs();
		expect(result).toMatchObject({ status: "no-data", code: "NOT_LOGIN", windows: [] });
		expect(JSON.stringify(result)).not.toContain("User not logged in");
	});
});

describe("Qwen entitlement parser", () => {
	it("extracts used/total and remaining/total entries and ignores everything else", () => {
		const windows = parseQwenEntitlement({
			success: true,
			data: {
				plan: "pro",
				daily: { name: "daily", total: 100, remaining: 40, expireTime: "2026-11-18T00:00:00Z" },
				nested: { list: [{ type: "monthly", limit: "1000", used: "250" }, { total: 0, used: 0 }, { foo: 1 }] },
			},
		});
		expect(windows).toEqual([
			{
				id: "qwen-0",
				name: "daily",
				usedPercent: 60,
				windowSeconds: 86_400,
				resetsAt: Date.parse("2026-11-18T00:00:00Z") / 1000,
			},
			{ id: "qwen-1", name: "monthly", usedPercent: 25, windowSeconds: 2_592_000 },
		]);
		expect(parseQwenEntitlement({ success: true, data: { hello: "world" } })).toEqual([]);
		expect(() => parseQwenEntitlement({ success: false, httpCode: 401, errorCode: "NOT_LOGIN" })).toThrow("NOT_LOGIN");
		expect(() => parseQwenEntitlement({ success: false, httpCode: 500, errorCode: "bad code!" })).toThrow("http_500");
	});

	it("builds the same query the usage page sends", () => {
		const url = new URL(qwenEntitlementUsageUrl("America/New_York"));
		expect(url.origin + url.pathname).toBe("https://sg-entitlement.qwen.com/api/entitlement/agent/usage");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			biz_id: "ai_qwen",
			chat_client: "h5",
			pr: "qwen-i18n",
			tz: "America/New_York",
		});
	});
});

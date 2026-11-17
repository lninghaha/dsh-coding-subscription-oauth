/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LimitsDock, registerLimitsDock } from "../src/client/LimitsDock.tsx";
import { en } from "../src/client/locales.ts";
import {
	lastSubscriptionProvider,
	formatResetIn,
	formatWindowSeconds,
	parseLimitsResponse,
	usageFingerprint,
} from "../src/client/limits.ts";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const t = (key: keyof typeof en, params?: Record<string, unknown>) =>
	en[key].replace(/\{(\w+)\}/gu, (_m, name: string) => String(params?.[name] ?? ""));

describe("limit helpers", () => {
	it("derives the active provider from the latest assistant message identity", () => {
		const assistant = (provider: string, key: "provenance" | "requestConfig" = "provenance") => ({
			kind: "assistant",
			[key]: { provider, model: "m" },
		});
		expect(
			lastSubscriptionProvider([assistant("codex-oauth"), { kind: "user" }, assistant("qwen-code-oauth"), { kind: "tool" }]),
		).toBe("qwen");
		expect(lastSubscriptionProvider([assistant("claude-code-oauth", "requestConfig")])).toBe("claude");
		expect(lastSubscriptionProvider([assistant("codex-oauth-fast")])).toBe("codex");
		// The latest assistant message decides, even when it is not a subscription route.
		expect(lastSubscriptionProvider([assistant("kimi-code-oauth"), assistant("deepseek")])).toBeUndefined();
		expect(lastSubscriptionProvider([{ kind: "user" }])).toBeUndefined();
		expect(lastSubscriptionProvider(undefined)).toBeUndefined();
		expect(usageFingerprint({ totalTokens: 12 })).toBe("12");
		expect(usageFingerprint({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBe("10");
	});

	it("parses responses defensively and formats windows and countdowns", () => {
		const view = parseLimitsResponse({
			providers: [{ provider: "claude", status: "ok", fetchedAt: 1, windows: [{ id: "a", usedPercent: 140 }, { id: 2 }] }],
		});
		expect(view?.windows).toEqual([{ id: "a", usedPercent: 100 }]);
		expect(parseLimitsResponse({})).toBeUndefined();
		expect(formatWindowSeconds(18_000)).toBe("5h");
		expect(formatWindowSeconds(259_200)).toBe("3d");
		expect(formatResetIn(10_000 + 3 * 3600 + 20 * 60, 10_000_000)).toBe("3h 20m");
		expect(formatResetIn(1, 10_000_000)).toBeUndefined();
	});
});

/** Fake DSH selector seats: `useSession` selects over `{ nodes }`, `useChat` over `{ legacy: { nodes } }`. */
const nodesFor = (provider: string) => [{ kind: "assistant", provenance: { provider, model: "m" } }];
const session = (provider: string) => (select: (s: unknown) => unknown) => select({ nodes: nodesFor(provider) });
const chat = (provider: string) => (select: (s: unknown) => unknown) => select({ legacy: { nodes: nodesFor(provider) } });

function mockLimits(body: unknown) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("LimitsDock", () => {
	it("renders gauges for the active provider and requests only that provider", async () => {
		const fetchMock = mockLimits({
			providers: [
				{
					provider: "claude",
					status: "ok",
					plan: "max",
					fetchedAt: 1,
					windows: [
						{ id: "five_hour", usedPercent: 42, windowSeconds: 18_000 },
						{ id: "seven_day", usedPercent: 80, windowSeconds: 604_800 },
					],
				},
			],
		});
		render(
			createElement(LimitsDock, {
				t,
				useProjection: () => ({ totalTokens: 5 }),
				useSession: session("claude-code-oauth"),
			}),
		);
		await screen.findByText("42%");
		expect(screen.getByText("80%")).toBeTruthy();
		expect(screen.getByText("5h")).toBeTruthy();
		expect(screen.getByText("Weekly")).toBeTruthy();
		expect(screen.getByText("Claude Code MAX")).toBeTruthy();
		const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
		expect(url).toContain("provider=claude");
		expect(screen.getAllByRole("progressbar")).toHaveLength(2);
	});

	it("renders nothing and makes no request when the provider is unknown or the host lacks the seats", () => {
		const fetchMock = mockLimits({ providers: [] });
		const none = render(createElement(LimitsDock, { t, useSession: session("deepseek") }));
		expect(none.container.innerHTML).toBe("");
		const missing = render(createElement(LimitsDock, { t }));
		expect(missing.container.innerHTML).toBe("");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("shows a plan-only note for Qwen and a hint when Codex usage is disabled", async () => {
		mockLimits({ providers: [{ provider: "qwen", status: "no-data", plan: "pro", windows: [], fetchedAt: 1 }] });
		render(createElement(LimitsDock, { t, useSession: session("qwen-code-oauth") }));
		await screen.findByText(/Qwen Code PRO/u);
		cleanup();
		mockLimits({ providers: [{ provider: "codex", status: "disabled", windows: [], fetchedAt: 1 }] });
		render(createElement(LimitsDock, { t, useChat: chat("codex-oauth") }));
		await waitFor(() => expect(screen.getByText(/enable Codex usage/u)).toBeTruthy());
	});

	it("registers under the composer dock slot via inject", () => {
		const register = vi.fn(() => () => undefined);
		const inject = vi.fn((_key: string, callback: () => unknown) => {
			callback();
			return () => undefined;
		});
		registerLimitsDock({ inject, register }, t as never);
		expect(inject).toHaveBeenCalledWith("conversation.composer.dock", expect.any(Function));
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({ name: "conversation.composer.dock", id: "coding-oauth-limits" }),
			LimitsDock,
		);
	});
});

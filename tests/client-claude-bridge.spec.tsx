/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { claudeBridgeLaunchUrl } from "../src/client/claude-bridge.ts";
import { GrokBuildSettings } from "../src/client/GrokBuildSettings.tsx";
import { ProviderCard } from "../src/client/components/ProviderCard.tsx";
import { LOGIN_CODE_PATH, LOGIN_PATH, PROVIDERS, STATUS_PATH } from "../src/client/constants.ts";
import { en } from "../src/client/locales.ts";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/client/api.ts", async () => ({
	...await vi.importActual<typeof import("../src/client/api.ts")>("../src/client/api.ts"),
	jsonRequest: mocks.request,
}));
vi.mock("../src/client/components/OpenCodeGoCard.tsx", () => ({ OpenCodeGoCard: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const authUrl = "https://claude.ai/oauth/authorize?state=pending-state&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback&code_challenge_method=S256&code_challenge=fixture-challenge";

it("hands the challenge to the local bridge in the URL fragment and rejects other providers", () => {
	const destination = new URL(claudeBridgeLaunchUrl(authUrl, "https://example.com/settings"));
	expect(destination.origin).toBe("http://127.0.0.1:53700");
	expect(destination.pathname).toBe("/start");
	expect(destination.search).toBe("");
	const fragment = new URLSearchParams(destination.hash.slice(1));
	expect(fragment.get("authUrl")).toBe(authUrl);
	expect(fragment.get("remoteOrigin")).toBe("https://example.com");
	expect(() => claudeBridgeLaunchUrl("https://example.com/authorize", "https://example.com")).toThrow();
});

it("keeps a bridge attempt waiting for actual provider status and offers callback paste as fallback", () => {
	const onUseManualCallback = vi.fn();
	const props = {
		t: (key: keyof typeof en) => en[key], definition: PROVIDERS.find((item) => item.slug === "claude")!,
		providerStatus: { status: "signing-in" as const, provider: "claude" as const, route: "claude-code-oauth", displayName: "Claude",
			loginMethods: ["browser" as const], recommendedLoginMethod: "browser" as const, models: [], available: [], selected: [], method: "browser" as const, url: authUrl },
		busy: false, remote: true, bridgeActive: true, onBridgeSignIn: vi.fn(), onUseManualCallback,
		sourcesBusy: false, codeInput: "", popupBlocked: true, expanded: false, source: undefined,
		showUsage: false, usage: undefined, usageError: undefined, usageLoading: false,
		onSignIn: vi.fn(), onSignOut: vi.fn(), onCancelLogin: vi.fn(), onSubmitCode: vi.fn(), onCodeChange: vi.fn(),
		onToggleExpanded: vi.fn(), onPreviewSource: vi.fn(), onSaveModels: vi.fn(async () => undefined),
		onSetDefaultAccount: vi.fn(), onRemoveAccount: vi.fn(async () => true), onRetryStatus: vi.fn(),
	};
	const view = render(createElement(ProviderCard, props));
	expect(screen.getByRole("status").textContent).toContain(en.signingIn);
	expect(screen.queryByRole("textbox")).toBeNull();
	const link = screen.getByRole("link", { name: en.openBridge });
	expect(link.getAttribute("href")).toContain("http://127.0.0.1:53700/start#");
	expect(link.getAttribute("rel")).toBe("noopener");
	expect(link.getAttribute("referrerpolicy")).toBe("origin");
	fireEvent.click(screen.getByRole("button", { name: en.manualClaudeSignIn }));
	expect(onUseManualCallback).toHaveBeenCalledOnce();
	view.rerender(createElement(ProviderCard, { ...props, bridgeActive: false }));
	expect(screen.getByRole("textbox", { name: en.callbackUrlLabel })).toBeTruthy();
});

it("opens the local bridge rather than Claude directly after the login challenge and waits for persisted signed-in status", async () => {
	let signingIn = false;
	let signedIn = false;
	const popup = { opener: undefined, location: { replace: vi.fn() }, close: vi.fn() };
	vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
	const navigations: HTMLAnchorElement[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
		navigations.push(this);
	});
	mocks.request.mockReset();
	mocks.request.mockImplementation(async (path: string) => {
		if (path === LOGIN_PATH) { signingIn = true; return { url: authUrl }; }
		if (path === STATUS_PATH) return {
			uiOwner: "standalone", accessMode: "trusted-https-proxy",
			antigravity: { installed: false, route: "agy" }, opencodeGo: { active: false, lastCall: "no-call", updatedAt: null },
			compatibility: { coreAbi: "dsh-coding-oauth-core/v1", dshVersion: "0.1.1-rc.2", status: "healthy", diagnostics: [] },
			providers: {
				grok: { status: "signed-out", grokImportAvailable: false }, codex: { status: "signed-out" }, kimi: { status: "signed-out" }, qwen: { status: "signed-out" },
				claude: { provider: "claude", route: "claude-code-oauth", displayName: "Claude", loginMethods: ["browser"], recommendedLoginMethod: "browser", models: [], available: [], selected: [],
					...(signedIn ? { status: "signed-in", accounts: [], activeAccountId: "fixture" }
						: signingIn ? { status: "signing-in", method: "browser", url: authUrl } : { status: "signed-out" }),
				},
			},
		};
		return { sources: [] };
	});
	render(createElement(GrokBuildSettings, { t: (key) => en[key] }));
	fireEvent.click(await screen.findByRole("button", { name: en.bridgeSignIn }));
	await waitFor(() => expect(navigations).toHaveLength(1));
	expect(navigations[0]!.href).toBe(claudeBridgeLaunchUrl(authUrl, window.location.origin));
	expect(navigations[0]!.referrerPolicy).toBe("origin");
	expect(navigations[0]!.target).toMatch(/^dsh-claude-bridge-/);
	expect(popup.location.replace).not.toHaveBeenCalled();
	expect(popup.opener).toBeNull();
	expect(screen.queryByRole("textbox", { name: en.callbackUrlLabel })).toBeNull();
	expect(screen.getByText(en.bridgeWaitingHint)).toBeTruthy();
	signedIn = true;
	await waitFor(() => expect(screen.queryByText(en.bridgeWaitingHint)).toBeNull(), { timeout: 2000 });
});

it("uses the bridge for confirmed reauthorization of the selected remote Claude account", async () => {
	let signingIn = false;
	const popup = { opener: undefined, location: { replace: vi.fn() }, close: vi.fn() };
	vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
	const navigations: HTMLAnchorElement[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
		navigations.push(this);
	});
	mocks.request.mockReset();
	mocks.request.mockImplementation(async (path: string) => {
		if (path === LOGIN_PATH) { signingIn = true; return { url: authUrl }; }
		if (path === STATUS_PATH) return {
			uiOwner: "standalone", accessMode: "trusted-https-proxy",
			antigravity: { installed: false, route: "agy" }, opencodeGo: { active: false, lastCall: "no-call", updatedAt: null },
			compatibility: { coreAbi: "dsh-coding-oauth-core/v1", dshVersion: "0.1.1-rc.2", status: "healthy", diagnostics: [] },
			providers: {
				grok: { status: "signed-out", grokImportAvailable: false }, codex: { status: "signed-out" }, kimi: { status: "signed-out" }, qwen: { status: "signed-out" },
				claude: { provider: "claude", route: "claude-code-oauth", displayName: "Claude", loginMethods: ["browser"], recommendedLoginMethod: "browser", models: [], available: [], selected: [],
					...(signingIn ? { status: "signing-in", method: "browser", url: authUrl }
						: { status: "signed-in", accounts: [{ id: "selected-account", expires: 2_000_000_000_000 }], activeAccountId: "selected-account" }),
				},
			},
		};
		return { sources: [] };
	});
	render(createElement(GrokBuildSettings, { t: (key) => en[key] }));
	fireEvent.click(await screen.findByRole("button", { name: en.expandModels }));
	fireEvent.click(screen.getByRole("button", { name: en.accountReauthorize }));
	expect(mocks.request.mock.calls.filter(([path]) => path === LOGIN_PATH)).toHaveLength(0);
	fireEvent.click(screen.getByRole("button", { name: `${en.accountReauthorize} · ${en.browserLogin}` }));
	await waitFor(() => expect(navigations).toHaveLength(1));
	expect(navigations[0]!.href).toBe(claudeBridgeLaunchUrl(authUrl, window.location.origin));
	expect(popup.location.replace).not.toHaveBeenCalled();
	expect(mocks.request).toHaveBeenCalledWith(LOGIN_PATH, "POST", {
		provider: "claude", method: "browser", accountMode: "reauthorize", targetAccountId: "selected-account", confirmOverwrite: true,
	});
	await screen.findByText(en.bridgeWaitingHint);
});

it("binds a pasted callback to the pending Claude attempt shown in Settings", async () => {
	const callback = "http://localhost:53692/callback?code=fixture-code&state=pending-state";
	mocks.request.mockReset();
	mocks.request.mockImplementation(async (path: string) => {
		if (path === LOGIN_CODE_PATH) return { ok: true };
		if (path === STATUS_PATH) return {
			uiOwner: "standalone", accessMode: "trusted-https-proxy",
			antigravity: { installed: false, route: "agy" }, opencodeGo: { active: false, lastCall: "no-call", updatedAt: null },
			compatibility: { coreAbi: "dsh-coding-oauth-core/v1", dshVersion: "0.1.1-rc.2", status: "healthy", diagnostics: [] },
			providers: {
				grok: { status: "signed-out", grokImportAvailable: false }, codex: { status: "signed-out" }, kimi: { status: "signed-out" }, qwen: { status: "signed-out" },
				claude: { provider: "claude", route: "claude-code-oauth", displayName: "Claude", loginMethods: ["browser"], recommendedLoginMethod: "browser", models: [], available: [], selected: [],
					status: "signing-in", method: "browser", url: authUrl, loginAttemptId: "displayed-attempt",
				},
			},
		};
		return { sources: [] };
	});
	render(createElement(GrokBuildSettings, { t: (key) => en[key] }));
	const input = await screen.findByRole("textbox", { name: en.callbackUrlLabel });
	fireEvent.paste(input, { clipboardData: { getData: () => callback } });
	await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(LOGIN_CODE_PATH, "POST", {
		provider: "claude", code: callback, loginAttemptId: "displayed-attempt",
	}));
	expect(mocks.request.mock.calls.filter(([path]) => path === LOGIN_CODE_PATH)).toHaveLength(1);
});

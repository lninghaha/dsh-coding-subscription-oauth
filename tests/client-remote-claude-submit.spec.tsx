/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { GrokBuildSettings } from "../src/client/GrokBuildSettings.tsx";
import { LOGIN_CODE_PATH, STATUS_PATH } from "../src/client/constants.ts";
import { en } from "../src/client/locales.ts";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/client/api.ts", async () => ({
	...await vi.importActual<typeof import("../src/client/api.ts")>("../src/client/api.ts"),
	jsonRequest: mocks.request,
}));
vi.mock("../src/client/components/OpenCodeGoCard.tsx", () => ({ OpenCodeGoCard: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("posts the newly pasted callback through the full settings UI without waiting for React input state", async () => {
	let submitted = false;
	mocks.request.mockImplementation(async (path: string) => {
		if (path === LOGIN_CODE_PATH) { submitted = true; return { ok: true }; }
		if (path === STATUS_PATH) return {
			uiOwner: "standalone", accessMode: "trusted-https-proxy",
			antigravity: { installed: false, route: "agy" },
			opencodeGo: { active: false, lastCall: "no-call", updatedAt: null },
			compatibility: { coreAbi: "dsh-coding-oauth-core/v1", dshVersion: "0.1.1-rc.2", status: "healthy", diagnostics: [] },
			providers: {
				grok: { status: "signed-out", grokImportAvailable: false }, codex: { status: "signed-out" }, kimi: { status: "signed-out" }, qwen: { status: "signed-out" },
				claude: { provider: "claude", route: "claude-code-oauth", displayName: "Claude", loginMethods: ["browser"], recommendedLoginMethod: "browser", models: [], available: [], selected: [],
					...(submitted ? { status: "signed-in", accounts: [], activeAccountId: "fixture" } : {
						status: "signing-in", method: "browser", url: "https://claude.ai/oauth/authorize?state=pending-state&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback",
					}),
				},
			},
		};
		return { sources: [] };
	});
	render(createElement(GrokBuildSettings, { t: (key) => en[key] }));
	const input = await screen.findByRole("textbox", { name: en.callbackUrlLabel });
	const callback = "http://localhost:53692/callback?code=fixture-code&state=pending-state";
	fireEvent.paste(input, { clipboardData: { getData: () => callback } });
	await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(LOGIN_CODE_PATH, "POST", { provider: "claude", code: callback }));
	await waitFor(() => expect(screen.queryByRole("textbox", { name: en.callbackUrlLabel })).toBeNull());
	expect(mocks.request.mock.calls.filter(([path]) => path === LOGIN_CODE_PATH)).toHaveLength(1);
});

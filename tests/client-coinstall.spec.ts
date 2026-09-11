import { describe, expect, it, vi } from "vitest";
import { openHubAccountsSettings } from "../src/client/display.ts";

describe("coinstall entry dispatch", () => {
	it("dispatches usage-stats:open-settings with tab accounts and never open-dashboard", () => {
		const dispatched: CustomEvent[] = [];
		const fakeWindow = {
			dispatchEvent: vi.fn((event: Event) => {
				dispatched.push(event as CustomEvent);
				return true;
			}),
		};

		vi.stubGlobal("window", fakeWindow);
		vi.stubGlobal(
			"CustomEvent",
			class MockCustomEvent {
				type: string;
				detail: unknown;
				constructor(type: string, init?: { detail?: unknown }) {
					this.type = type;
					this.detail = init?.detail;
				}
			},
		);

		try {
			openHubAccountsSettings();
			expect(fakeWindow.dispatchEvent).toHaveBeenCalledTimes(1);
			expect(dispatched[0]?.type).toBe("usage-stats:open-settings");
			expect(dispatched[0]?.detail).toEqual({ tab: "accounts" });
			expect(dispatched.some((e) => e.type === "usage-stats:open-dashboard")).toBe(false);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

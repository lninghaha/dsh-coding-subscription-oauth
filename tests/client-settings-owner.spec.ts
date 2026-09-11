import { afterEach, describe, expect, it, vi } from "vitest";
import { hubClientLoaded } from "../src/client/owner.ts";

function boot(entries: readonly unknown[]): void {
	vi.stubGlobal("__DSH_BOOT__", { entries });
}

describe("co-install settings entry ownership", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("hides the duplicate entry when the Usage Center hub browser half is loaded", () => {
		boot([{ id: "@deepseek-ai/dsh-client-ui-settings" }, { id: "dsh-hub-oauth-gateway" }]);
		expect(hubClientLoaded()).toBe(true);
	});

	it("keeps the standalone entry when hub is not part of the page", () => {
		boot([{ id: "@deepseek-ai/dsh-client-ui-settings" }, { id: "dsh-coding-remote-kit" }]);
		expect(hubClientLoaded()).toBe(false);
	});

	it("keeps the standalone entry when the boot payload is unavailable", () => {
		vi.stubGlobal("__DSH_BOOT__", undefined);
		expect(hubClientLoaded()).toBe(false);
	});
});

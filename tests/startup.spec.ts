import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply } from "../src/index.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import { GrokBuildSession } from "../src/session.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("plugin startup catalog initialization", () => {
	it("contains cache and refresh failures while registering the adapter", async () => {
		vi.spyOn(GrokBuildSession.prototype, "loadCachedCatalog").mockRejectedValue(new Error("grok cache failed"));
		vi.spyOn(OAuthProviderSession.prototype, "loadCachedModels").mockRejectedValue(new Error("oauth cache failed"));
		const refresh = vi
			.spyOn(GrokBuildSession.prototype, "refreshLiveCatalog")
			.mockRejectedValue(new Error("refresh failed"));
		const warn = vi.fn();
		const registerAdapter = vi.fn();
		const context = {
			logger: () => ({ warn }),
			emit: vi.fn(),
			llm: { registerAdapter },
			get: vi.fn(() => undefined),
			inject: vi.fn(),
		} as unknown as Context;

		apply(context, {});
		expect(registerAdapter).toHaveBeenCalledOnce();

		await new Promise<void>((resolve) => setImmediate(resolve));
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(refresh).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith("one or more OAuth model caches could not be loaded; using in-memory fallbacks");
		expect(warn).toHaveBeenCalledWith("background OAuth model catalog initialization failed; using static fallbacks");
	});
});

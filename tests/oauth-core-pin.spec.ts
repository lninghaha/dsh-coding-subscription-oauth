import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const SUBPATHS = ["http-json", "grok-errors", "kimi-errors", "gateway-protocol"] as const;

describe("oauth-core pin", () => {
	it("resolves published dsh-coding-oauth-core@0.1.2 helper subpaths", async () => {
		const pkg = require("dsh-coding-oauth-core/package.json") as { version: string; exports?: Record<string, unknown> };
		expect(pkg.version).toBe("0.1.2");
		for (const subpath of SUBPATHS) {
			expect(pkg.exports?.[`./${subpath}`], subpath).toBeTruthy();
			await expect(import(`dsh-coding-oauth-core/${subpath}`)).resolves.toBeTypeOf("object");
		}
	});
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["http-json.ts", "grok-errors.ts", "kimi-errors.ts", "gateway-protocol.ts"] as const;

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("runtime-slice identity", () => {
	it("keeps vendor/runtime-slice byte-identical to src/runtime", () => {
		for (const name of FILES) {
			const vendor = sha256(resolve(ROOT, "vendor/runtime-slice", name));
			const src = sha256(resolve(ROOT, "src/runtime", name));
			expect(src, name).toBe(vendor);
		}
	});
});

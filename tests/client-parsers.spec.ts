import { describe, expect, it } from "vitest";
import {
	mergeSources,
	parseCapabilities,
	parseGateway,
	parseGatewayPort,
	parseImagineCredential,
	parsePreview,
	parseSources,
	safeDisplayPath,
} from "../src/client/parsers.ts";

describe("client parsers", () => {
	it("merges missing CLI sources with default paths", () => {
		const merged = mergeSources([]);
		expect(merged).toHaveLength(4);
		expect(merged.every((entry) => entry.available === false && entry.reason === "missing")).toBe(true);
		expect(merged[0]?.displayPath).toBe("~/.grok/auth.json");
	});

	it("parses sources payloads and keeps available entries", () => {
		const parsed = parseSources({
			sources: [{ kind: "codex", displayPath: "~/.codex/auth.json", available: true, expiresAt: 1_700_000_000 }],
		});
		expect(parsed.find((entry) => entry.kind === "codex")?.available).toBe(true);
		expect(parsed.find((entry) => entry.kind === "grok")?.reason).toBe("missing");
	});

	it("rejects secret-looking display paths", () => {
		expect(safeDisplayPath("sk-abcdefghijklmnopqrstuvwxyz", "grok")).toBe("~/.grok/auth.json");
		expect(safeDisplayPath("~/.grok/auth.json", "grok")).toBe("~/.grok/auth.json");
	});

	it("parses capability snapshots and gateway ports", () => {
		expect(parseCapabilities({ value: { codexUsage: true, searchResults: 7 }, revision: 3, writable: true })).toEqual(
			expect.objectContaining({
				revision: 3,
				writable: true,
				value: expect.objectContaining({ codexUsage: true, searchResults: 7 }),
			}),
		);
		expect(parseGatewayPort("18080")).toBe(18080);
		expect(parseGatewayPort("22")).toBeUndefined();
		expect(parseGateway({ enabled: true, running: false, bind: "127.0.0.1", port: 18080, keyHint: "ab…" })).toEqual({
			enabled: true,
			running: false,
			bind: "127.0.0.1",
			port: 18080,
			keyHint: "ab…",
			warning: "",
		});
	});

	it("parses preview tickets and imagine credential status", () => {
		expect(
			parsePreview({
				previewId: "p1",
				kind: "kimi",
				displayPath: "~/.kimi/credentials/kimi-code.json",
				confirmOverwriteRequired: true,
				action: "overwrite",
				conflict: "different_account",
				warnings: ["note"],
			}),
		).toEqual(
			expect.objectContaining({
				previewId: "p1",
				kind: "kimi",
				confirmOverwriteRequired: true,
				action: "overwrite",
				conflict: "different_account",
				warnings: ["note"],
			}),
		);
		expect(parseImagineCredential({ configured: true, source: "api-key", writable: false })).toEqual({
			configured: true,
			source: "api-key",
			writable: false,
		});
	});
});

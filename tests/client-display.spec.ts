import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/client/constants.ts";
import {
	allOfficialCliMissing,
	anyOfficialCliAvailable,
	isLikelyRemoteHost,
	methodLabel,
	orderedLoginMethods,
	preferredLoginMethod,
	shouldShowPerCardSourceReason,
} from "../src/client/display.ts";
import type { GrokBuildSettingsKey } from "../src/client/locales.ts";
import type { SourceStatus } from "../src/client/types.ts";

const t = (key: GrokBuildSettingsKey): string => key;

describe("client display helpers", () => {
	it("detects remote hosts", () => {
		expect(isLikelyRemoteHost("127.0.0.1")).toBe(false);
		expect(isLikelyRemoteHost("localhost")).toBe(false);
		expect(isLikelyRemoteHost("example.localhost")).toBe(false);
		expect(isLikelyRemoteHost("dsh.example.com")).toBe(true);
	});

	it("orders remote login methods with device code first for grok and codex", () => {
		const grok = PROVIDERS.find((entry) => entry.slug === "grok");
		const codex = PROVIDERS.find((entry) => entry.slug === "codex");
		expect(grok).toBeDefined();
		expect(codex).toBeDefined();
		expect(preferredLoginMethod(grok!, true)).toBe("device");
		expect(orderedLoginMethods(grok!, true)[0]).toBe("device");
		expect(orderedLoginMethods(codex!, true)[0]).toBe("device");
		expect(orderedLoginMethods(grok!, false)[0]).toBe("pkce");
	});

	it("labels remote device login as the primary CTA copy key", () => {
		expect(methodLabel("device", t, { remote: true, primary: true })).toBe("deviceLoginRemote");
		expect(methodLabel("device", t, { remote: true, primary: false })).toBe("deviceLogin");
		expect(methodLabel("pkce", t)).toBe("pkceLogin");
	});

	it("hides per-card missing reasons while keeping actionable ones", () => {
		const missing: SourceStatus = {
			kind: "grok",
			displayPath: "~/.grok/auth.json",
			available: false,
			reason: "missing",
		};
		const unsafe: SourceStatus = { kind: "grok", displayPath: "~/.grok/auth.json", available: false, reason: "unsafe" };
		expect(shouldShowPerCardSourceReason(missing)).toBe(false);
		expect(shouldShowPerCardSourceReason(unsafe)).toBe(true);
		expect(shouldShowPerCardSourceReason(undefined)).toBe(false);
	});

	it("summarizes official CLI discovery without treating missing as an error", () => {
		const sources: SourceStatus[] = [
			{ kind: "grok", displayPath: "~/.grok/auth.json", available: false, reason: "missing" },
			{ kind: "codex", displayPath: "~/.codex/auth.json", available: false, reason: "missing" },
			{ kind: "kimi", displayPath: "~/.kimi/credentials/kimi-code.json", available: false, reason: "missing" },
			{ kind: "claude", displayPath: "~/.claude/.credentials.json", available: false, reason: "missing" },
		];
		expect(allOfficialCliMissing(sources)).toBe(true);
		expect(anyOfficialCliAvailable(sources)).toBe(false);
		expect(anyOfficialCliAvailable([{ ...sources[0]!, available: true }])).toBe(true);
	});
});

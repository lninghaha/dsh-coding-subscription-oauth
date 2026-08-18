import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grokAuthPath, importGrokAuth, parseGrokAuthDocument, probeGrokAuth } from "../src/grok-import.ts";
import { XAI_PI_PROVIDER } from "../src/ids.ts";
import { GrokBuildCredentialStore } from "../src/store.ts";

const grokShape = {
	"https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
		key: "access-from-grok",
		refresh_token: "refresh-from-grok",
		expires_at: "2026-08-14T12:00:00.000000Z",
		oidc_issuer: "https://auth.x.ai",
		user_id: "user-1",
		email: "hidden@example.com",
	},
};

describe("parseGrokAuthDocument", () => {
	it("reads the Grok CLI issuer::client_id document", () => {
		const credential = parseGrokAuthDocument(JSON.stringify(grokShape), "auth.json");
		expect(credential).toMatchObject({
			type: "oauth",
			access: "access-from-grok",
			refresh: "refresh-from-grok",
			accountId: "user-1",
		});
		expect(credential.expires).toBe(Date.parse("2026-08-14T12:00:00.000000Z"));
	});

	it("accepts a flat access_token document", () => {
		const credential = parseGrokAuthDocument(
			JSON.stringify({
				access_token: "a",
				refresh_token: "r",
				expires_in: 3600,
			}),
			"auth.json",
		);
		expect(credential.access).toBe("a");
		expect(credential.refresh).toBe("r");
		expect(credential.expires).toBeGreaterThan(Date.now());
	});

	it("rejects a document without a refresh token", () => {
		expect(() => parseGrokAuthDocument(JSON.stringify({ key: "only-access" }), "auth.json")).toThrow(/refresh token/);
	});
});

describe("importGrokAuth", () => {
	it("copies tokens into the dsh store and leaves the Grok file unchanged", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-grok-"));
		const grokFile = join(dir, "auth.json");
		const dshFile = join(dir, "dsh.json");
		const original = `${JSON.stringify(grokShape, null, 2)}\n`;
		await writeFile(grokFile, original);
		const store = new GrokBuildCredentialStore(dshFile);
		await importGrokAuth(store, grokFile);
		expect(await readFile(grokFile, "utf8")).toBe(original);
		const stored = await store.read(XAI_PI_PROVIDER);
		expect(stored).toMatchObject({ type: "oauth", access: "access-from-grok", refresh: "refresh-from-grok" });
	});

	it("probes availability without returning secrets", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-probe-"));
		const missing = await probeGrokAuth(join(dir, "missing.json"));
		expect(missing.available).toBe(false);
		const grokFile = join(dir, "auth.json");
		await writeFile(grokFile, JSON.stringify(grokShape));
		const present = await probeGrokAuth(grokFile);
		expect(present.available).toBe(true);
		expect(JSON.stringify(present)).not.toContain("access-from-grok");
		expect(JSON.stringify(present)).not.toContain("refresh-from-grok");
	});
});

describe("grokAuthPath", () => {
	it("resolves under the given home", () => {
		expect(grokAuthPath("/tmp/home").replaceAll("\\", "/")).toMatch(/\/tmp\/home\/.grok\/auth\.json$/);
	});
});

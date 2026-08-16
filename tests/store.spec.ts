import { chmod, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_PI_PROVIDER, XAI_PI_PROVIDER } from "../src/ids.ts";
import { GrokBuildCredentialStore, OAuthCredentialFileStore } from "../src/store.ts";

const files: string[] = [];

afterEach(async () => {
	files.length = 0;
});

async function tempStore(): Promise<GrokBuildCredentialStore> {
	const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-"));
	const filename = join(dir, "auth.json");
	files.push(filename);
	return new GrokBuildCredentialStore(filename);
}

describe("GrokBuildCredentialStore", () => {
	it("round-trips an oauth credential", async () => {
		const store = await tempStore();
		const written = await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "access-token",
			refresh: "refresh-token",
			expires: 1_700_000_000_000,
		}));
		expect(written).toMatchObject({ type: "oauth", access: "access-token", refresh: "refresh-token" });
		const read = await store.read(XAI_PI_PROVIDER);
		expect(read).toEqual(written);
		expect(await store.list()).toEqual([{ providerId: XAI_PI_PROVIDER, type: "oauth" }]);
		const text = await readFile(store.filename, "utf8");
		expect(JSON.parse(text).version).toBe(1);
	});

	it("writes the credential owner-only", async () => {
		const store = await tempStore();
		await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 1,
		}));
		const { stat } = await import("node:fs/promises");
		const mode = (await stat(store.filename)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("rejects a credential file that became group-readable", async () => {
		if (process.platform === "win32") return;
		const store = await tempStore();
		await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 1,
		}));
		await chmod(store.filename, 0o640);
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/owner-only no-follow validation/);
	});

	it("rejects a leaf symlink even when its target is owner-only", async () => {
		if (process.platform === "win32") return;
		const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-symlink-"));
		const target = join(dir, "real-auth.json");
		const store = new GrokBuildCredentialStore(join(dir, "auth.json"));
		await writeFile(
			target,
			`${JSON.stringify({
				version: 1,
				credential: { type: "oauth", access: "a", refresh: "r", expires: 1 },
			})}\n`,
			{ mode: 0o600 },
		);
		await symlink(target, store.filename);
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/owner-only no-follow validation/);
	});

	it("ignores other provider ids on read and refuses them on write", async () => {
		const store = await tempStore();
		await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 1,
		}));
		expect(await store.read("openai-codex")).toBeUndefined();
		await expect(store.modify("openai-codex", async (current) => current)).rejects.toThrow(/does not own/);
	});

	it("rejects an unsupported document version", async () => {
		const store = await tempStore();
		await writeFile(
			store.filename,
			`${JSON.stringify({
				version: 99,
				credential: { type: "oauth", access: "a", refresh: "r", expires: 1 },
			})}\n`,
			{ mode: 0o600 },
		);
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unsupported auth format version/);
	});

	it("rejects unknown credential fields", async () => {
		const store = await tempStore();
		await writeFile(
			store.filename,
			`${JSON.stringify({
				version: 1,
				credential: { type: "oauth", access: "a", refresh: "r", expires: 1, leak: "nope" },
			})}\n`,
			{ mode: 0o600 },
		);
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unknown field/);
	});

	it("deletes only the xAI credential", async () => {
		const store = await tempStore();
		await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 1,
		}));
		await store.delete(XAI_PI_PROVIDER);
		expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});
});

describe("OAuthCredentialFileStore", () => {
	it("isolates provider ids and preserves Codex accountId", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-codex-store-"));
		const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, "codex.json"), "codex-oauth");
		const credential = await store.modify(CODEX_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			expires: 1_800_000_000_000,
			accountId: "account-1",
		}));
		expect(credential).toMatchObject({ accountId: "account-1" });
		expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined();
		await expect(store.modify(XAI_PI_PROVIDER, async (current) => current)).rejects.toThrow(/does not own provider/);
	});

	it("keeps two provider files independent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-oauth-stores-"));
		const codex = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, "codex.json"), "codex-oauth");
		const other = new OAuthCredentialFileStore("anthropic", join(dir, "claude.json"), "claude-code-oauth");
		await codex.modify(CODEX_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "c",
			refresh: "cr",
			expires: 10,
		}));
		await other.modify("anthropic", async () => ({
			type: "oauth",
			access: "a",
			refresh: "ar",
			expires: 20,
		}));
		expect(await codex.read(CODEX_PI_PROVIDER)).toMatchObject({ access: "c" });
		expect(await other.read("anthropic")).toMatchObject({ access: "a" });
		await codex.delete(CODEX_PI_PROVIDER);
		expect(await other.read("anthropic")).toMatchObject({ access: "a" });
	});

	it("invalidate backdates expires while preserving the token pair", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-invalidate-"));
		const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, "codex.json"), "codex-oauth");
		const future = Date.now() + 3_600_000;
		await store.modify(CODEX_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			expires: future,
			accountId: "account-1",
		}));
		const before = Date.now();
		expect(await store.invalidate(CODEX_PI_PROVIDER)).toBe(true);
		const after = Date.now();
		const credential = await store.read(CODEX_PI_PROVIDER);
		expect(credential).toMatchObject({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			accountId: "account-1",
		});
		// Backdated into the past (so getAuth refreshes) yet still a valid document.
		expect(credential?.type === "oauth" && credential.expires).toBeGreaterThan(0);
		expect(credential?.type === "oauth" && credential.expires).toBeLessThanOrEqual(after);
		expect(credential?.type === "oauth" && credential.expires).toBeLessThanOrEqual(before);
	});

	it("invalidate is a no-op without a stored credential and for foreign ids", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-invalidate-empty-"));
		const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, "codex.json"), "codex-oauth");
		expect(await store.invalidate(CODEX_PI_PROVIDER)).toBe(false);
		expect(await store.invalidate(XAI_PI_PROVIDER)).toBe(false);
	});
});

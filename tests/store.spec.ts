import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_PI_PROVIDER, XAI_PI_PROVIDER } from "../src/ids.ts";
import { OAUTH_SOURCE_MAX_BYTES } from "../src/oauth-sources.ts";
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

	it("lets modify replace an owner-only unreadable JSON file", async () => {
		const store = await tempStore();
		await writeFile(store.filename, "{not-json", { mode: 0o600 });
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/is not valid JSON/);
		await expect(store.list()).rejects.toThrow(/is not valid JSON/);

		let seen: unknown = "unset";
		const written = await store.modify(XAI_PI_PROVIDER, async (current) => {
			seen = current;
			return { type: "oauth", access: "new-access", refresh: "new-refresh", expires: 2 };
		});
		expect(seen).toBeUndefined();
		expect(written).toMatchObject({ type: "oauth", access: "new-access", refresh: "new-refresh", expires: 2 });
		expect(await store.read(XAI_PI_PROVIDER)).toEqual(written);
		const { stat } = await import("node:fs/promises");
		expect((await stat(store.filename)).mode & 0o777).toBe(0o600);
		const text = await readFile(store.filename, "utf8");
		expect(JSON.parse(text)).toMatchObject({ version: 1, credential: { access: "new-access" } });
		expect(text).not.toContain("{not-json");
	});

	it("lets modify replace owner-only documents that fail schema while read stays loud", async () => {
		const store = await tempStore();
		await writeFile(
			store.filename,
			`${JSON.stringify({
				version: 99,
				credential: { type: "oauth", access: "old", refresh: "old-r", expires: 1 },
			})}\n`,
			{ mode: 0o600 },
		);
		await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unsupported auth format version/);
		const replaced = await store.modify(XAI_PI_PROVIDER, async (current) => {
			expect(current).toBeUndefined();
			return { type: "oauth", access: "fixed", refresh: "fixed-r", expires: 3 };
		});
		expect(replaced).toMatchObject({ access: "fixed" });

		await writeFile(
			store.filename,
			`${JSON.stringify({
				version: 1,
				credential: { type: "oauth", access: "a", refresh: "r", expires: 1, leak: "nope" },
			})}\n`,
			{ mode: 0o600 },
		);
		await expect(store.list()).rejects.toThrow(/unknown field/);
		await store.modify(XAI_PI_PROVIDER, async (current) => {
			expect(current).toBeUndefined();
			return { type: "oauth", access: "clean", refresh: "clean-r", expires: 4 };
		});
		expect(await store.read(XAI_PI_PROVIDER)).toMatchObject({ access: "clean" });
	});

	it("refuses to modify a group-readable, symlink, or oversized destination", async () => {
		if (process.platform !== "win32") {
			const wide = await tempStore();
			await writeFile(wide.filename, "{not-json", { mode: 0o600 });
			await chmod(wide.filename, 0o644);
			await expect(
				wide.modify(XAI_PI_PROVIDER, async () => ({ type: "oauth", access: "a", refresh: "r", expires: 1 })),
			).rejects.toThrow(/owner-only no-follow validation/);
			expect(await readFile(wide.filename, "utf8")).toBe("{not-json");

			const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-symlink-mod-"));
			const target = join(dir, "real-auth.json");
			const linked = new GrokBuildCredentialStore(join(dir, "auth.json"));
			await writeFile(target, "{not-json", { mode: 0o600 });
			await symlink(target, linked.filename);
			await expect(
				linked.modify(XAI_PI_PROVIDER, async () => ({ type: "oauth", access: "a", refresh: "r", expires: 1 })),
			).rejects.toThrow(/owner-only no-follow validation/);
			expect((await lstat(linked.filename)).isSymbolicLink()).toBe(true);
			expect(await readFile(target, "utf8")).toBe("{not-json");
		}

		const huge = await tempStore();
		await writeFile(huge.filename, "x".repeat(OAUTH_SOURCE_MAX_BYTES + 1), { mode: 0o600 });
		await expect(
			huge.modify(XAI_PI_PROVIDER, async () => ({ type: "oauth", access: "a", refresh: "r", expires: 1 })),
		).rejects.toMatchObject({ code: "too_large" });
		expect((await readFile(huge.filename)).byteLength).toBe(OAUTH_SOURCE_MAX_BYTES + 1);
	});

	it("revalidates the destination immediately before replace", async () => {
		if (process.platform === "win32") return;
		const store = await tempStore();
		await writeFile(store.filename, "{not-json", { mode: 0o600 });
		await expect(
			store.modify(XAI_PI_PROVIDER, async (current) => {
				expect(current).toBeUndefined();
				await chmod(store.filename, 0o644);
				return { type: "oauth", access: "a", refresh: "r", expires: 1 };
			}),
		).rejects.toThrow(/owner-only no-follow validation/);
		expect(await readFile(store.filename, "utf8")).toBe("{not-json");

		const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-revalidate-"));
		const store2 = new GrokBuildCredentialStore(join(dir, "auth.json"));
		const target = join(dir, "outside.json");
		await writeFile(store2.filename, "{not-json", { mode: 0o600 });
		await writeFile(target, "secret-outside", { mode: 0o600 });
		await expect(
			store2.modify(XAI_PI_PROVIDER, async (current) => {
				expect(current).toBeUndefined();
				await rm(store2.filename);
				await symlink(target, store2.filename);
				return { type: "oauth", access: "a", refresh: "r", expires: 1 };
			}),
		).rejects.toThrow(/owner-only no-follow validation/);
		expect((await lstat(store2.filename)).isSymbolicLink()).toBe(true);
		expect(await readFile(target, "utf8")).toBe("secret-outside");
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

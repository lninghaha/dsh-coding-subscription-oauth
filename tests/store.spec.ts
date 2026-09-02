import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_PI_PROVIDER, XAI_PI_PROVIDER } from "../src/ids.ts";
import { OAUTH_SOURCE_MAX_BYTES } from "../src/oauth-sources.ts";
import {
	GrokBuildCredentialStore,
	OAUTH_MAX_ACCOUNTS,
	OAuthCredentialFileStore,
	oauthCredentialPath,
} from "../src/store.ts";

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

describe("oauthCredentialPath", () => {
	it("accepts only a local basename and cannot escape DSH_HOME", () => {
		expect(oauthCredentialPath("codex-oauth.json", "/tmp/example-dsh-home")).toBe(
			resolve("/tmp/example-dsh-home", "codex-oauth.json"),
		);
		for (const basename of ["../outside.json", "nested/auth.json", "nested\\auth.json", ".", "..", ""]) {
			expect(() => oauthCredentialPath(basename, "/tmp/example-dsh-home")).toThrow(/safe local filename/);
		}
	});
});

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
		const onDisk = JSON.parse(text) as { version: number; activeAccountId: string; accounts: unknown[] };
		expect(onDisk.version).toBe(2);
		expect(onDisk.accounts).toHaveLength(1);
		expect(onDisk.activeAccountId).toBeTruthy();
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
		if (process.platform !== "win32") expect(mode).toBe(0o600);
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
		if (process.platform !== "win32") expect((await stat(store.filename)).mode & 0o777).toBe(0o600);
		const text = await readFile(store.filename, "utf8");
		expect(JSON.parse(text)).toMatchObject({
			version: 2,
			accounts: [expect.objectContaining({ credential: expect.objectContaining({ access: "new-access" }) })],
		});
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

function oauthCredential(overrides: Partial<OAuthCredential> & { access: string; refresh: string }): OAuthCredential {
	return {
		type: "oauth",
		expires: Date.now() + 3_600_000,
		...overrides,
	};
}

describe("OAuthCredentialFileStore AuthDocument v2", () => {
	async function createStore(): Promise<{ store: OAuthCredentialFileStore; path: string }> {
		const directory = await mkdtemp(join(tmpdir(), "sub-oauth-store-v2-"));
		const path = join(directory, "provider.json");
		files.push(path);
		const store = new OAuthCredentialFileStore("test-provider", path, "test-oauth");
		return { store, path };
	}

	it("exports the Hub-aligned account cap", () => {
		expect(OAUTH_MAX_ACCOUNTS).toBe(8);
	});

	it("migrates a v1 document to one account under lock", async () => {
		const { store, path } = await createStore();
		const credential = oauthCredential({
			access: "access-v1",
			refresh: "refresh-v1",
			accountId: "safe-user",
		});
		await writeFile(path, `${JSON.stringify({ version: 1, credential }, null, 2)}\n`, { mode: 0o600 });

		expect(await store.getActiveAccountId()).toBe("safe-user");
		expect(await store.listAccounts()).toEqual([
			{
				id: "safe-user",
				expires: credential.expires,
				accountId: "safe-user",
			},
		]);

		const onDisk = JSON.parse(await readFile(path, "utf8")) as {
			version: number;
			activeAccountId: string;
			accounts: Array<{ id: string; credential: OAuthCredential }>;
		};
		expect(onDisk.version).toBe(2);
		expect(onDisk.activeAccountId).toBe("safe-user");
		expect(onDisk.accounts).toHaveLength(1);
		expect(onDisk.accounts[0]?.credential.access).toBe("access-v1");
	});

	it("migrates unsafe v1 credential.accountId to legacy", async () => {
		const { store, path } = await createStore();
		await writeFile(
			path,
			`${JSON.stringify(
				{
					version: 1,
					credential: oauthCredential({
						access: "a",
						refresh: "r",
						accountId: "has spaces",
					}),
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);

		expect(await store.getActiveAccountId()).toBe("legacy");
		const onDisk = JSON.parse(await readFile(path, "utf8")) as { activeAccountId: string };
		expect(onDisk.activeAccountId).toBe("legacy");
	});

	it("serializes concurrent mutateDocument calls through the file lock", async () => {
		const { store, path } = await createStore();
		await writeFile(
			path,
			`${JSON.stringify(
				{
					version: 1,
					credential: oauthCredential({ access: "access-v1", refresh: "refresh-v1", accountId: "locked" }),
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);

		const started: number[] = [];
		const finished: number[] = [];
		const run = async (index: number) => {
			started.push(index);
			await store.upsertAccount({
				id: `acct-${String(index)}`,
				credential: oauthCredential({
					access: `access-${String(index)}`,
					refresh: `refresh-${String(index)}`,
				}),
			});
			finished.push(index);
		};

		await Promise.all([run(1), run(2), run(3)]);
		expect(started).toHaveLength(3);
		expect([...finished].sort((a, b) => a - b)).toEqual([1, 2, 3]);

		const onDisk = JSON.parse(await readFile(path, "utf8")) as {
			version: number;
			accounts: Array<{ id: string }>;
		};
		expect(onDisk.version).toBe(2);
		expect(onDisk.accounts.map((account) => account.id).sort()).toEqual(["acct-1", "acct-2", "acct-3", "locked"]);
	});

	it("upserts a second account and setActive switches CredentialStore.read", async () => {
		const { store } = await createStore();
		await store.upsertAccount({
			id: "acct-a",
			label: "Alpha",
			credential: oauthCredential({ access: "access-a", refresh: "refresh-a", accountId: "provider-a" }),
			makeActive: true,
		});
		await store.upsertAccount({
			id: "acct-b",
			label: "Beta",
			credential: oauthCredential({ access: "access-b", refresh: "refresh-b", accountId: "provider-b" }),
		});

		expect(await store.getActiveAccountId()).toBe("acct-a");
		expect(await store.read("test-provider")).toMatchObject({ access: "access-a", refresh: "refresh-a" });
		expect(await store.listAccounts()).toEqual([
			{ id: "acct-a", label: "Alpha", expires: expect.any(Number), accountId: "provider-a" },
			{ id: "acct-b", label: "Beta", expires: expect.any(Number), accountId: "provider-b" },
		]);
		expect(JSON.stringify(await store.listAccounts())).not.toMatch(/access-|refresh-/u);

		await store.setActiveAccount("acct-b");
		expect(await store.getActiveAccountId()).toBe("acct-b");
		expect(await store.read("test-provider")).toMatchObject({ access: "access-b", refresh: "refresh-b" });
	});

	it("removeAccount failovers when the active account is removed", async () => {
		const { store, path } = await createStore();
		await store.upsertAccount({
			id: "first",
			credential: oauthCredential({ access: "access-1", refresh: "refresh-1" }),
			makeActive: true,
		});
		await store.upsertAccount({
			id: "second",
			credential: oauthCredential({ access: "access-2", refresh: "refresh-2" }),
		});
		await store.setActiveAccount("first");

		await store.removeAccount("first");
		expect(await store.getActiveAccountId()).toBe("second");
		expect(await store.read("test-provider")).toMatchObject({ access: "access-2" });

		await store.removeAccount("second");
		expect(await store.getActiveAccountId()).toBeUndefined();
		expect(await store.read("test-provider")).toBeUndefined();
		await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects a ninth distinct account", async () => {
		const { store } = await createStore();
		for (let index = 1; index <= 8; index += 1) {
			await store.upsertAccount({
				id: `acct-${String(index)}`,
				credential: oauthCredential({
					access: `access-${String(index)}`,
					refresh: `refresh-${String(index)}`,
				}),
				makeActive: index === 1,
			});
		}
		await expect(
			store.upsertAccount({
				id: "acct-9",
				credential: oauthCredential({ access: "access-9", refresh: "refresh-9" }),
			}),
		).rejects.toThrow(/at most 8 accounts/u);

		await store.upsertAccount({
			id: "acct-1",
			credential: oauthCredential({ access: "access-1-updated", refresh: "refresh-1-updated" }),
		});
		expect(await store.listAccounts()).toHaveLength(8);
		expect(await store.read("test-provider")).toMatchObject({ access: "access-1-updated" });
	});

	it("persistLoginCredential add mode upserts without leaking through listAccounts", async () => {
		const { store } = await createStore();
		await store.persistLoginCredential(
			oauthCredential({ access: "access-1", refresh: "refresh-1", accountId: "user-one" }),
			{ mode: "add" },
		);
		await store.persistLoginCredential(
			oauthCredential({ access: "access-2", refresh: "refresh-2", accountId: "user-two" }),
			{ mode: "add" },
		);
		expect(await store.getActiveAccountId()).toBe("user-two");
		expect(await store.listAccounts()).toEqual([
			expect.objectContaining({ id: "user-one", accountId: "user-one" }),
			expect.objectContaining({ id: "user-two", accountId: "user-two" }),
		]);
		expect(JSON.stringify(await store.listAccounts())).not.toMatch(/access-|refresh-/u);
	});

	it("CredentialStore.modify and invalidate touch only the active account", async () => {
		const { store } = await createStore();
		const inactiveExpires = Date.now() + 9_000_000;
		await store.upsertAccount({
			id: "active",
			credential: oauthCredential({
				access: "access-active",
				refresh: "refresh-active",
				expires: Date.now() + 5_000_000,
			}),
			makeActive: true,
		});
		await store.upsertAccount({
			id: "inactive",
			credential: oauthCredential({
				access: "access-inactive",
				refresh: "refresh-inactive",
				expires: inactiveExpires,
			}),
		});

		await store.modify("test-provider", async (current) => {
			expect(current).toMatchObject({ access: "access-active" });
			if (current?.type !== "oauth") return undefined;
			return { ...current, access: "access-active-refreshed" };
		});
		expect(await store.read("test-provider")).toMatchObject({ access: "access-active-refreshed" });

		const beforeInvalidate = Date.now();
		expect(await store.invalidate("test-provider")).toBe(true);
		const active = await store.read("test-provider");
		expect(active?.type).toBe("oauth");
		if (active?.type === "oauth") {
			expect(active.expires).toBeLessThan(beforeInvalidate);
			expect(active.access).toBe("access-active-refreshed");
			expect(active.refresh).toBe("refresh-active");
		}

		await store.setActiveAccount("inactive");
		expect(await store.read("test-provider")).toMatchObject({
			access: "access-inactive",
			refresh: "refresh-inactive",
			expires: inactiveExpires,
		});
	});

	it("overwrite-active without confirmOverwrite rejects", async () => {
		const { store } = await createStore();
		await store.persistLoginCredential(oauthCredential({ access: "access-keep", refresh: "refresh-keep" }), {
			mode: "add",
		});
		await expect(
			store.persistLoginCredential(oauthCredential({ access: "access-new", refresh: "refresh-new" }), {
				mode: "overwrite-active",
			}),
		).rejects.toThrow(/confirmOverwrite/u);
		expect(await store.read("test-provider")).toMatchObject({ access: "access-keep", refresh: "refresh-keep" });
	});

	it("delete(provider) removes a multi-account document", async () => {
		const { store, path } = await createStore();
		await store.upsertAccount({
			id: "acct-a",
			credential: oauthCredential({ access: "access-a", refresh: "refresh-a" }),
			makeActive: true,
		});
		await store.upsertAccount({
			id: "acct-b",
			credential: oauthCredential({ access: "access-b", refresh: "refresh-b" }),
		});
		expect(await store.listAccounts()).toHaveLength(2);

		await store.delete("test-provider");
		expect(await store.listAccounts()).toEqual([]);
		await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OAuthCredentialFileStore } from "../src/store.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const credential = (id: string, access = `test-${id}`) => ({
	type: "oauth" as const,
	access,
	refresh: `refresh-${id}`,
	expires: 2_000_000_000_000,
	accountId: id,
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "account-workflow-"));
	dirs.push(dir);
	const store = new OAuthCredentialFileStore("test-provider", join(dir, "auth.json"), "test-provider");
	await store.persistLoginCredential(credential("a"), { mode: "add" });
	return store;
}
it("adding an account preserves the existing default and returns the newly saved credential", async () => {
	const store = await fixture();
	const result = await store.runLoginPersist({ mode: "add" }, () =>
		store.modify("test-provider", async () => credential("b")),
	);
	expect(await store.getActiveAccountId()).toBe("a");
	expect(result).toEqual(credential("b"));
});
it("background credential refresh does not inherit an unrelated pending login intent", async () => {
	const store = await fixture();
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const login = store.runLoginPersist({ mode: "add" }, async () => {
		await waiting;
	});
	await store.modify("test-provider", async () => credential("a", "refreshed-a"));
	release();
	await login;
	expect(await store.listAccounts()).toHaveLength(1);
	expect((await store.read("test-provider"))?.type).toBe("oauth");
});

it("reauthorization binds the selected account even if the default changes", async () => {
	const store = await fixture();
	await store.persistLoginCredential(credential("b"), { mode: "add" });
	const intent = await store.prepareLoginPersist({ mode: "reauthorize", targetAccountId: "a" });
	await store.setActiveAccount("b");
	await store.persistLoginCredential(credential("a", "renewed-a"), intent);
	expect(await store.getActiveAccountId()).toBe("b");
	expect(await store.read("test-provider")).toEqual(credential("b"));
	await store.setActiveAccount("a");
	expect(await store.read("test-provider")).toEqual(credential("a", "renewed-a"));
});
it("rejects a mismatched identity and a deleted or changed target without replacing credentials", async () => {
	const store = await fixture();
	const intent = await store.prepareLoginPersist({ mode: "reauthorize", targetAccountId: "a", confirmOverwrite: true });
	await expect(store.persistLoginCredential(credential("b"), intent)).rejects.toMatchObject({
		code: "account-identity-mismatch",
	});
	await store.modify("test-provider", async () => credential("a", "newer-a"));
	await expect(store.persistLoginCredential(credential("a", "late-a"), intent)).rejects.toMatchObject({
		code: "account-conflict",
	});
	expect(await store.read("test-provider")).toEqual(credential("a", "newer-a"));
	await store.removeAccount("a");
	await expect(store.persistLoginCredential(credential("a"), intent)).rejects.toMatchObject({
		code: "account-conflict",
	});
	expect(await store.listAccounts()).toEqual([]);
});
it("requires explicit confirmation when the provider does not disclose identity", async () => {
	const store = await fixture();
	const intent = await store.prepareLoginPersist({ mode: "reauthorize", targetAccountId: "a" });
	const { accountId: _identity, ...unknown } = credential("a");
	await expect(store.persistLoginCredential(unknown, intent)).rejects.toMatchObject({
		code: "account-identity-unverified",
	});
	await store.persistLoginCredential(unknown, { ...intent, confirmOverwrite: true });
	expect(await store.getActiveAccountId()).toBe("a");
});

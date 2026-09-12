import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KIMI_CODE_OAUTH_PROVIDER } from "../src/oauth-providers.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import { GrokBuildSession } from "../src/session.ts";
import { OAuthCredentialFileStore } from "../src/store.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture(kind: string) {
	const dir = await mkdtemp(join(tmpdir(), "selection-contract-"));
	dirs.push(dir);
	const file = join(dir, "cache", "models.json");
	const session =
		kind === "oauth"
			? new OAuthProviderSession(
					KIMI_CODE_OAUTH_PROVIDER,
					undefined,
					new OAuthCredentialFileStore(KIMI_CODE_OAUTH_PROVIDER.nativeProviderId, join(dir, "auth.json"), "fixture"),
					file,
				)
			: new GrokBuildSession();
	Reflect.set(session, "cacheFile", file);
	const load = () =>
		session instanceof OAuthProviderSession ? session.loadCachedModels() : session.loadCachedCatalog();
	return { dir, file, session, load };
}
describe.each(["oauth", "grok"])("%s model selection contract", (kind) => {
	it("explicit empty selection remains empty after reload", async () => {
		const { session, load } = await fixture(kind);
		await session.setSelectedModels([]);
		expect(session.visibleModels()).toEqual([]);
		expect(session.provider().getModels()).toEqual([]);
		await load();
		expect(session.selectedModelIds()).toEqual([]);
		expect(session.visibleModels()).toEqual([]);
	});
	it("failed disk persistence does not publish changed selection", async () => {
		const { dir, session } = await fixture(kind);
		await writeFile(join(dir, "cache"), "blocked");
		const before = session.selectedModelIds();
		await expect(session.setSelectedModels([session.availableModels()[0]!.id])).rejects.toThrow();
		expect(session.selectedModelIds()).toEqual(before);
	});
	it("legacy empty arrays retain the default model set and are backed up before migration", async () => {
		const { dir, file, session, load } = await fixture(kind);
		await mkdir(join(dir, "cache"));
		const legacy = JSON.stringify({ version: kind === "oauth" ? 1 : 2, ids: [], selected: [], fetchedAt: 0 });
		await writeFile(file, legacy);
		await load();
		expect(session.visibleModels().length).toBeGreaterThan(0);
		await session.setSelectedModels([]);
		expect(await readFile(`${file}.pre-selection-mode`, "utf8")).toBe(legacy);
	});
});

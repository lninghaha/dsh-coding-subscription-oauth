#!/usr/bin/env node

/**
 * Offline repro for issue #38 against @deepseek-ai/dsh-llm-pi-ai@0.1.5-rc.1.
 *
 * The plugin keeps dsh-llm-pi-ai external, so a 0.1.5 host reads profile.modelErrors
 * during resolveModel. This installs that host package into a scratch tree and feeds
 * it the plugin's profiles so the crash is observable without a full dsh web install.
 *
 * Usage: node scripts/repro-modelerrors-015.mjs [path-to-plugin-lib-index.js]
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const pluginEntry = resolve(process.argv[2] ?? "lib/index.js");
const scratch = await mkdtemp(join(tmpdir(), "dsh-modelerrors-repro-"));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = scratch;

try {
	const hostDir = join(scratch, "host");
	spawnSync("mkdir", ["-p", hostDir], { stdio: "inherit" });
	await writeFile(
		join(hostDir, "package.json"),
		JSON.stringify({
			name: "dsh-modelerrors-host",
			private: true,
			type: "module",
			dependencies: { "@deepseek-ai/dsh-llm-pi-ai": "0.1.5-rc.1" },
		}),
	);
	const install = spawnSync("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], {
		cwd: hostDir,
		encoding: "utf8",
	});
	if (install.status !== 0) {
		console.error(install.stderr || install.stdout);
		process.exit(1);
	}
	const { PiAiAdapter } = await import(
		pathToFileURL(join(hostDir, "node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js")).href
	);
	const plugin = await import(pathToFileURL(pluginEntry).href);
	const grok = new plugin.GrokBuildSession(new plugin.GrokBuildCredentialStore(join(scratch, "grok.json")));
	const subscriptions = plugin.OAUTH_PROVIDER_DEFINITIONS.map(
		(definition) =>
			new plugin.OAuthProviderSession(
				definition,
				undefined,
				new plugin.OAuthCredentialFileStore(
					definition.nativeProviderId,
					join(scratch, `${definition.slug}.json`),
					definition.route,
				),
				join(scratch, `${definition.slug}-models.json`),
			),
	);
	const exampleCredential = () => ({
		type: "oauth",
		access: "EXAMPLE_ACCESS_TOKEN",
		refresh: "EXAMPLE_REFRESH_TOKEN",
		expires: Date.now() + 3_600_000,
	});
	await grok.store.modify("xai", async () => exampleCredential());
	for (const session of subscriptions) {
		await session.store.modify(session.definition.nativeProviderId, async () => exampleCredential());
	}
	const coding = plugin.createCodingOAuthAdapter(grok, subscriptions, () => undefined, {
		codexFast: { isEligible: () => true },
	});
	const profiles = coding.inner.config.profiles();
	assert.ok(profiles.size > 0, "expected OAuth profiles");
	for (const [route, profile] of profiles) {
		assert.ok(profile.modelErrors instanceof Map, `${route}: modelErrors must be a Map`);
		const hostAdapter = new PiAiAdapter({
			profiles: () => new Map([[route, profile]]),
			resolveApiKey: async () => "EXAMPLE_ACCESS_TOKEN",
		});
		try {
			await hostAdapter.resolveModel(route, "missing-example-model");
			assert.fail(`${route}: expected UNKNOWN_MODEL / INVALID_CONFIG`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			assert.notEqual(
				message,
				"Cannot read properties of undefined (reading 'get')",
				`${route}: still crashes on modelErrors.get`,
			);
		}
		console.log(`PASS ${route}: modelErrors present; host resolveModel does not crash on .get`);
	}
} finally {
	if (previousHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = previousHome;
	await rm(scratch, { recursive: true, force: true });
}

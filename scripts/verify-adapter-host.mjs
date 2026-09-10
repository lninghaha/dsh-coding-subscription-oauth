#!/usr/bin/env node

// Run against a plugin installed in an isolated host, not this checkout's peers.
// Metadata resolution is offline and uses disposable example credentials.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.argv[2];
if (!entry) throw new Error("Usage: node scripts/verify-adapter-host.mjs <installed-plugin>/lib/index.js");
const scratch = await mkdtemp(join(tmpdir(), "dsh-adapter-host-"));
const previousHome = process.env.DSH_HOME;
const previousFetch = globalThis.fetch;
process.env.DSH_HOME = scratch;
globalThis.fetch = async () => {
	throw new Error("Model metadata checks must not make network requests");
};
try {
	const plugin = await import(pathToFileURL(resolve(entry)).href);
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
	const adapter = plugin.createCodingOAuthAdapter(grok, subscriptions, () => undefined, {
		codexFast: { isEligible: () => true },
	});
	for (const route of [...plugin.CODING_OAUTH_ROUTES, "codex-oauth-fast"]) {
		const models = await adapter.listModels(route);
		assert.ok(models.length > 0, `${route}: expected catalog entries`);
		const model = route === "grok-build" ? models.find((item) => item.id === "grok-4.6") : models[0];
		assert.ok(model, `${route}: expected model`);
		const resolved = await adapter.resolveModel(route, model.id);
		assert.equal(resolved.provider, route);
		assert.equal(resolved.id, model.id);
		const prepared = await adapter.prepareCall(route, model.id);
		assert.equal(prepared.model.id, model.id);
		await assert.rejects(adapter.resolveModel(route, "missing-example-model"), { code: "UNKNOWN_MODEL" });
		console.log(`PASS ${route}: catalog, model resolution, request preparation, unknown-model error`);
	}
	const standalone = plugin.createGrokBuildAdapter(grok, () => undefined);
	assert.equal((await standalone.resolveModel("grok-build", "grok-4.6")).id, "grok-4.6");
	console.log("PASS standalone Grok adapter");
} finally {
	globalThis.fetch = previousFetch;
	if (previousHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = previousHome;
	await rm(scratch, { recursive: true, force: true });
}

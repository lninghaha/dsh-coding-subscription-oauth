import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { readDshClientPlatformContract } from "./dsh-client-platform.mjs";

const root = resolve(".");
const execute = promisify(execFile);
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.name, "dsh-coding-subscription-oauth");
assert.notEqual(manifest.private, true, "release package must not be private");
assert.match(manifest.version, /^\d+\.\d+\.\d+/, "release manifest must use semver");
assert.equal(manifest.version, "0.6.4");
assert.equal(manifest.dependencies?.["dsh-coding-oauth-core"], "0.1.1");
assert.equal(manifest.dependencies?.undici, "7.29.0");
assert.equal(manifest.devDependencies?.undici, "7.29.0");
const clientConstants = await readFile(resolve(root, "src/client/constants.ts"), "utf8");
assert.match(clientConstants, new RegExp(`PLUGIN_VERSION\\s*=\\s*["']${manifest.version}["']`));
assert.deepEqual(manifest.bin, {
	"dsh-coding-oauth": "lib/bin.js",
	"dsh-grok-build": "lib/bin.js",
});

for (const path of [
	"lib/index.js",
	"lib/index.js.map",
	"lib/index.d.ts",
	"lib/index.d.ts.map",
	"lib/bin.js",
	"lib/bin.js.map",
	"lib/bin.d.ts",
	"lib/bin.d.ts.map",
	"lib/invariant.js",
	"lib/invariant.js.map",
	"lib/invariant.d.ts",
	"lib/invariant.d.ts.map",
	"lib/client.js",
	"lib/client.js.map",
	"cordis.patch.yml",
	"README.md",
	"LICENSE",
]) {
	await access(resolve(root, path));
}
for (const path of [manifest.main, manifest.types, manifest.exports?.["."]?.default, manifest.exports?.["."]?.types]) {
	assert.equal(typeof path, "string", "root package entrypoints must be strings");
	await access(resolve(root, path));
}
assert.equal(manifest.exports?.["./client"], "./lib/client.js");
assert.equal(manifest.exports?.["./package.json"], "./package.json");
await assert.rejects(access(resolve(root, "lib/client.cjs")), { code: "ENOENT" });

// Host externals must stay external; undici must be inlined. Only genuine
// top-level ESM imports count — inlined module bodies may mention these names.
const serverSource = await readFile(resolve(root, "lib/index.js"), "utf8");
assert.doesNotMatch(serverSource, /undici@(?:7\.24\.8|8\.)/u, "server bundle must not retain a split Undici runtime");
const topLevelImports = serverSource.match(/^import .*$/gm) ?? [];
for (const statement of topLevelImports) {
	assert.doesNotMatch(statement, /["']undici["']/, "undici must be inlined, not imported");
	assert.doesNotMatch(statement, /["']react/, "react must not be imported by the server bundle");
	assert.match(
		statement,
		/from ["'](?:node:[^"']+|@deepseek-ai\/[^"']+|@earendil-works\/[^"']+)["'];?$/u,
		`unexpected server external: ${statement}`,
	);
	assert.doesNotMatch(statement, /\.ts["'];?$/u, "release imports must not retain TypeScript extensions");
}
assert.ok(
	topLevelImports.some((statement) => statement.includes('"@deepseek-ai/dsh-llm"')),
	"harness LLM runtime imports should stay external",
);
assert.ok(
	!topLevelImports.some((statement) => statement.includes('"@deepseek-ai/dsh-tools"')),
	"optional tools peer must not be imported while evaluating the root entrypoint",
);
const requiredRuntimePeers = [
	"@deepseek-ai/dsh-atomic-write",
	"@deepseek-ai/dsh-home-paths",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-llm-pi-ai",
	"@deepseek-ai/schemastery",
	"@earendil-works/pi-ai",
];
for (const name of requiredRuntimePeers) {
	assert.equal(typeof manifest.peerDependencies?.[name], "string", `missing runtime peer: ${name}`);
	assert.notEqual(
		manifest.peerDependenciesMeta?.[name]?.optional,
		true,
		`runtime peer must be required (pnpm auto-installs it in the profile): ${name}`,
	);
	assert.equal(
		manifest.peerDependencies?.[name] === "*" || /^[~^]/.test(manifest.peerDependencies?.[name] ?? ""),
		false,
		`runtime peer must pin an exact resolvable version (not "*" or a range): ${name}`,
	);
}
for (const marker of [
	"/plugins/dsh-grok-build/oauth/sources",
	"/plugins/dsh-grok-build/capabilities",
	"codex-oauth-fast",
	"XAI_API_KEY",
	"/plugins/dsh-grok-build/imagine/media/",
]) {
	assert.ok(serverSource.includes(marker), `server bundle is missing v0.4 runtime marker ${marker}`);
}

const plugin = await import(`${pathToFileURL(resolve(root, "lib/index.js")).href}?verify=${Date.now()}`);
assert.equal(plugin.name, "llm-grok-build-oauth");
assert.equal(typeof plugin.apply, "function");
assert.ok(Array.isArray(plugin.inject));
assert.deepEqual(plugin.inject, ["webServer"], "webServer is the sole required top-level host service");
assert.equal(plugin.XAI_API_KEY_CREDENTIAL, "XAI_API_KEY");
assert.equal(plugin.IMAGINE_MEDIA_STORE_DIRNAME, ".dsh-coding-subscription-oauth-media");

const clientSource = await readFile(resolve(root, "lib/client.js"), "utf8");
assert.ok(clientSource.includes(manifest.version), "client bundle must include the manifest version");
assert.match(
	clientSource.slice(0, 500),
	/window\.__ModuleLoader__\.load\(\{id:["']dsh-coding-subscription-oauth["'],factory:/,
);
assert.equal((clientSource.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1);
for (const marker of [
	"/plugins/dsh-grok-build/capabilities",
	"/plugins/dsh-grok-build/imagine/credential-status",
	"codexSearch",
	"codexImages",
	"codexImageEdits",
	"codexUsage",
	"codexFast",
	"grokImagineImage",
	"grokImagineVideo",
	"searchResults",
	"imageCount",
	"videoArtifactTtlMs",
	"capVideoTtlHoursHint",
]) {
	assert.ok(clientSource.includes(marker), `client bundle is missing v0.4 settings marker ${marker}`);
}
const clientRequires = [
	...new Set([...clientSource.matchAll(/\brequire\((["'])([^"']+)\1\)/g)].map((match) => match[2])),
].sort();
const platform = await readDshClientPlatformContract();
const unsupportedClientRequires = clientRequires.filter((id) => !platform.modules.includes(id));
assert.deepEqual(
	unsupportedClientRequires,
	[],
	`client may require only official DSH PLATFORM_MODULES (${platform.version})`,
);
for (const requiredPlatformModule of ["react", "react/jsx-runtime", "react-dom/client"]) {
	assert.ok(clientRequires.includes(requiredPlatformModule), `client bundle is missing ${requiredPlatformModule}`);
}

const binPath = resolve(root, "lib/bin.js");
const binSource = await readFile(binPath, "utf8");
assert.match(binSource.slice(0, 100), /^#!\/usr\/bin\/env node/);
assert.equal((binSource.match(/^#!\/usr\/bin\/env node$/gm) ?? []).length, 1, "CLI bundle must contain one shebang");
await execute(process.execPath, ["--check", binPath]);
const cliHelp = await execute(process.execPath, [binPath, "--help"], { timeout: 10_000 });
assert.match(cliHelp.stdout, /^Usage: dsh-coding-oauth /u);

async function collectFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}
for (const path of await collectFiles(resolve(root, "lib"))) {
	const text = await readFile(path, "utf8");
	assert.doesNotMatch(text, /\/home\/[^/\s]+\//u, `release artifact contains an absolute home path: ${path}`);
	assert.doesNotMatch(text, /[A-Za-z]:\\\\Users\\\\/u, `release artifact contains an absolute user path: ${path}`);
	if (path.endsWith(".d.ts")) {
		assert.doesNotMatch(
			text,
			/(?:from|import)\s*(?:\([^)]*)?["']\.[^"']*\.ts["']/u,
			`declaration import retains a TypeScript extension: ${path}`,
		);
	}
}

console.log(`verified ${manifest.name}@${manifest.version} release artifacts`);

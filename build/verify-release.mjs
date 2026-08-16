import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(".");
const execute = promisify(execFile);
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.name, "dsh-coding-subscription-oauth");
assert.notEqual(manifest.private, true, "release package must not be private");
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
await assert.rejects(access(resolve(root, "lib/client.cjs")), { code: "ENOENT" });

// Host externals must stay external; undici must be inlined. Only genuine
// top-level ESM imports count — inlined module bodies may mention these names.
const serverSource = await readFile(resolve(root, "lib/index.js"), "utf8");
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

const plugin = await import(`${pathToFileURL(resolve(root, "lib/index.js")).href}?verify=${Date.now()}`);
assert.equal(plugin.name, "llm-grok-build-oauth");
assert.equal(typeof plugin.apply, "function");
assert.ok(Array.isArray(plugin.inject));
assert.ok(plugin.inject.includes("llm"));

const clientSource = await readFile(resolve(root, "lib/client.js"), "utf8");
assert.match(
	clientSource.slice(0, 500),
	/window\.__ModuleLoader__\.load\(\{id:["']dsh-coding-subscription-oauth["'],factory:/,
);
assert.equal((clientSource.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1);
const clientRequires = [
	...new Set([...clientSource.matchAll(/\brequire\((["'])([^"']+)\1\)/g)].map((match) => match[2])),
].sort();
assert.deepEqual(clientRequires, ["react", "react/jsx-runtime"], "client may require only platform React modules");

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
}

console.log(`verified ${manifest.name}@${manifest.version} release artifacts`);

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const source = resolve(".next/lib");
const target = resolve("lib");
const staging = resolve(`.release-lib-${process.pid}`);
const backup = resolve(`.release-lib-backup-${process.pid}`);
const runtimeFiles = new Set([
	"index.js",
	"index.js.map",
	"bin.js",
	"bin.js.map",
	"invariant.js",
	"invariant.js.map",
	"client.js",
	"client.js.map",
]);

async function collectFiles(from, relative = "") {
	const out = [];
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const nextRelative = join(relative, entry.name);
		const absolute = join(from, entry.name);
		if (entry.isDirectory()) out.push(...(await collectFiles(absolute, nextRelative)));
		else if (entry.isFile()) out.push(nextRelative);
	}
	return out;
}

// Keep bundled runtime files plus every .d.ts/.d.ts.map emitted by tsc; skip
// intermediate .js/.js.map from the declaration step and esbuild intermediates.
const wanted = [];
for (const name of await collectFiles(source)) {
	const base = name.split("/").pop() ?? name;
	if (runtimeFiles.has(base) && !name.includes("/")) {
		wanted.push(name);
	} else if (name.endsWith(".d.ts") || name.endsWith(".d.ts.map")) {
		if (base === "index.esbuild.d.ts" || base === "index.esbuild.d.ts.map") continue;
		wanted.push(name);
	}
}

await rm(staging, { recursive: true, force: true });
await rm(backup, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const name of wanted) {
	const info = await stat(join(source, name));
	if (info.size === 0) throw new Error(`refusing to promote empty artifact: ${name}`);
	const staged = join(staging, name);
	await mkdir(dirname(staged), { recursive: true });
	await cp(join(source, name), staged);
	if (name.endsWith(".d.ts")) {
		const declaration = await readFile(staged, "utf8");
		const rewritten = declaration.replace(/(["'])(\.[^"']*)(?<!\.d)\.ts\1/gu, "$1$2.js$1");
		if (rewritten !== declaration) await writeFile(staged, rewritten);
	}
}

let replacedExisting = false;
try {
	await rename(target, backup);
	replacedExisting = true;
} catch (error) {
	if (error?.code !== "ENOENT") throw error;
}
try {
	await rename(staging, target);
} catch (error) {
	if (replacedExisting) await rename(backup, target);
	throw error;
}
try {
	await import(`./verify-release.mjs?promotion=${Date.now()}`);
} catch (error) {
	await rm(target, { recursive: true, force: true });
	if (replacedExisting) await rename(backup, target);
	throw error;
}
await rm(backup, { recursive: true, force: true });
console.log(`promoted and verified ${target} (${wanted.length} files)`);

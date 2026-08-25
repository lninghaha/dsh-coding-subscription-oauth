import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [left, right] = process.argv.slice(2);
if (left === undefined || right === undefined) throw new Error("usage: node build/compare-lib.mjs <left> <right>");
async function files(root, base = root) {
	const out = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) out.push(...(await files(path, base)));
		else out.push(relative(base, path));
	}
	return out.sort();
}
function normalizedMap(text) {
	const value = JSON.parse(text);
	if (Array.isArray(value.sourcesContent))
		value.sourcesContent = value.sourcesContent.map((item) =>
			typeof item === "string" ? item.replace(/\r\n/g, "\n") : item,
		);
	return value;
}
const names = await files(left);
assert.deepEqual(names, await files(right), "lib file list differs");
for (const name of names) {
	const [a, b] = await Promise.all([readFile(join(left, name)), readFile(join(right, name))]);
	if (!name.endsWith(".map")) assert.deepEqual(a, b, `lib differs: ${name}`);
	else assert.deepEqual(normalizedMap(a.toString()), normalizedMap(b.toString()), `source map differs: ${name}`);
}

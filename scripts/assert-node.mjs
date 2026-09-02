#!/usr/bin/env node
/**
 * Fail fast when the active Node.js is below package.json#engines.
 * Cursor Cloud may expose /exec-daemon/node@22.14 ahead of nvm; that triggers
 * pnpm "Unsupported engine" warnings and is not a supported runtime.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engines = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines?.node;
const current = process.versions.node;
const [major = 0, minor = 0] = current.split(".").map((part) => Number(part));
const ok = (major === 22 && minor >= 19) || major >= 24;

if (!ok) {
	console.error(
		`Unsupported Node.js ${current}. This package requires ${String(engines)}.\n` +
			`Use nvm (see .nvmrc) so Node 22.19+ is first on PATH — avoid /exec-daemon/node (22.14).`,
	);
	process.exit(1);
}

console.log(`node ${current} (engines: ${String(engines)})`);

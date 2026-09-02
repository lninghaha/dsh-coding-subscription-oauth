#!/usr/bin/env node
/**
 * Assert Subscription pins a published dsh-coding-oauth-core that exports the
 * shared helper subpaths (replaces the old vendor/runtime-slice mirror check).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MIN = "0.1.2";
const SUBPATHS = ["http-json", "grok-errors", "kimi-errors", "gateway-protocol"];

const pkg = require("dsh-coding-oauth-core/package.json");
assert.equal(typeof pkg.version, "string", "missing dsh-coding-oauth-core package.json");
assert.ok(compareSemver(pkg.version, MIN) >= 0, `expected dsh-coding-oauth-core >= ${MIN}, got ${pkg.version}`);

for (const subpath of SUBPATHS) {
	const key = `./${subpath}`;
	assert.ok(pkg.exports?.[key], `missing export ${key}`);
	await import(`dsh-coding-oauth-core/${subpath}`);
}

console.log(`assert:oauth-core ok — dsh-coding-oauth-core@${pkg.version} (+ ${SUBPATHS.join(", ")})`);

function compareSemver(a, b) {
	const norm = (v) =>
		String(v)
			.split("-")[0]
			.split(".")
			.map((x) => Number.parseInt(x, 10) || 0);
	const pa = norm(a);
	const pb = norm(b);
	for (let i = 0; i < 3; i += 1) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
	}
	return 0;
}

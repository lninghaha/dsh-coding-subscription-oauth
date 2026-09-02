#!/usr/bin/env node
/**
 * Assert that Subscription's mirrored shared-runtime slice stays byte-identical
 * to Hub's vendored `dsh-coding-oauth-core` helpers (and to `src/runtime/`).
 *
 * Hub checkout is resolved from (in order):
 *   1. HUB_OAUTH_GATEWAY_ROOT
 *   2. sibling ../dsh-hub-oauth-gateway
 *   3. AGENT_REPOS_ROOT/dsh-hub-oauth-gateway
 *
 * Usage: node scripts/assert-runtime-slice-sync.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["http-json.ts", "grok-errors.ts", "kimi-errors.ts", "gateway-protocol.ts"];

function sha256(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveHubCoreSrc() {
	const candidates = [];
	if (process.env.HUB_OAUTH_GATEWAY_ROOT) {
		candidates.push(resolve(process.env.HUB_OAUTH_GATEWAY_ROOT, "vendor/dsh-coding-oauth-core/src"));
	}
	candidates.push(resolve(ROOT, "../dsh-hub-oauth-gateway/vendor/dsh-coding-oauth-core/src"));
	if (process.env.AGENT_REPOS_ROOT) {
		candidates.push(
			resolve(process.env.AGENT_REPOS_ROOT, "dsh-hub-oauth-gateway/vendor/dsh-coding-oauth-core/src"),
		);
	}
	candidates.push(resolve("/agent/repos/dsh-hub-oauth-gateway/vendor/dsh-coding-oauth-core/src"));

	for (const candidate of candidates) {
		if (await exists(resolve(candidate, FILES[0]))) return candidate;
	}
	return null;
}

const hubCore = await resolveHubCoreSrc();
assert.ok(
	hubCore !== null,
	"Hub vendor core not found. Set HUB_OAUTH_GATEWAY_ROOT or check out dsh-hub-oauth-gateway as a sibling.",
);

const vendorSlice = resolve(ROOT, "vendor/runtime-slice");
const srcRuntime = resolve(ROOT, "src/runtime");

let mismatches = 0;
for (const name of FILES) {
	const hubPath = resolve(hubCore, name);
	const vendorPath = resolve(vendorSlice, name);
	const srcPath = resolve(srcRuntime, name);
	const [hubBuf, vendorBuf, srcBuf] = await Promise.all([
		readFile(hubPath),
		readFile(vendorPath),
		readFile(srcPath),
	]);
	const hubHash = sha256(hubBuf);
	const vendorHash = sha256(vendorBuf);
	const srcHash = sha256(srcBuf);
	if (hubHash !== vendorHash || vendorHash !== srcHash) {
		mismatches += 1;
		console.error(`drift: ${name}`);
		console.error(`  hub vendor : ${hubHash} (${hubPath})`);
		console.error(`  vendor/slice: ${vendorHash} (${vendorPath})`);
		console.error(`  src/runtime : ${srcHash} (${srcPath})`);
	} else {
		console.log(`ok ${name} ${hubHash.slice(0, 12)}`);
	}
}

assert.equal(mismatches, 0, `${mismatches} runtime-slice file(s) drifted from Hub vendor core`);
console.log("runtime-slice sync: all files match Hub vendor dsh-coding-oauth-core");

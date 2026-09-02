#!/usr/bin/env node
/**
 * Assert Subscription's mirrored shared-runtime slice stays coherent.
 *
 * Always:
 *   1. vendor/runtime-slice/<file> byte-identical to src/runtime/<file>
 *   2. vendor hashes match vendor/runtime-slice/SYNC_HASHES.json
 *
 * When a Hub checkout is available (optional):
 *   3. also compare against Hub's vendored dsh-coding-oauth-core helpers
 *
 * Hub checkout is resolved from (in order):
 *   1. HUB_OAUTH_GATEWAY_ROOT
 *   2. sibling ../dsh-hub-oauth-gateway
 *   3. AGENT_REPOS_ROOT/dsh-hub-oauth-gateway
 *   4. /agent/repos/dsh-hub-oauth-gateway
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
const LOCK_PATH = resolve(ROOT, "vendor/runtime-slice/SYNC_HASHES.json");

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
		candidates.push(resolve(process.env.AGENT_REPOS_ROOT, "dsh-hub-oauth-gateway/vendor/dsh-coding-oauth-core/src"));
	}
	candidates.push(resolve("/agent/repos/dsh-hub-oauth-gateway/vendor/dsh-coding-oauth-core/src"));

	for (const candidate of candidates) {
		if (await exists(resolve(candidate, FILES[0]))) return candidate;
	}
	return null;
}

const vendorSlice = resolve(ROOT, "vendor/runtime-slice");
const srcRuntime = resolve(ROOT, "src/runtime");
const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
assert.ok(lock && typeof lock === "object" && lock.files, `missing lock file: ${LOCK_PATH}`);

let mismatches = 0;
for (const name of FILES) {
	const vendorPath = resolve(vendorSlice, name);
	const srcPath = resolve(srcRuntime, name);
	const [vendorBuf, srcBuf] = await Promise.all([readFile(vendorPath), readFile(srcPath)]);
	const vendorHash = sha256(vendorBuf);
	const srcHash = sha256(srcBuf);
	const lockedHash = lock.files?.[name];
	if (typeof lockedHash !== "string") {
		mismatches += 1;
		console.error(`drift: ${name}`);
		console.error(`  lock missing entry in ${LOCK_PATH}`);
		continue;
	}
	if (vendorHash !== srcHash || vendorHash !== lockedHash) {
		mismatches += 1;
		console.error(`drift: ${name}`);
		console.error(`  lock        : ${lockedHash}`);
		console.error(`  vendor/slice: ${vendorHash} (${vendorPath})`);
		console.error(`  src/runtime : ${srcHash} (${srcPath})`);
	} else {
		console.log(`ok ${name} ${vendorHash.slice(0, 12)} (vendor=src=lock)`);
	}
}

assert.equal(mismatches, 0, `${mismatches} runtime-slice file(s) drifted from src/runtime or SYNC_HASHES.json`);

const hubCore = await resolveHubCoreSrc();
if (hubCore === null) {
	console.log("runtime-slice sync: Hub checkout not present; verified vendor/src against SYNC_HASHES.json only");
	process.exit(0);
}

mismatches = 0;
for (const name of FILES) {
	const hubPath = resolve(hubCore, name);
	const vendorPath = resolve(vendorSlice, name);
	const [hubBuf, vendorBuf] = await Promise.all([readFile(hubPath), readFile(vendorPath)]);
	const hubHash = sha256(hubBuf);
	const vendorHash = sha256(vendorBuf);
	if (hubHash !== vendorHash) {
		mismatches += 1;
		console.error(`hub-drift: ${name}`);
		console.error(`  hub vendor  : ${hubHash} (${hubPath})`);
		console.error(`  vendor/slice: ${vendorHash} (${vendorPath})`);
	} else {
		console.log(`ok ${name} matches Hub ${hubHash.slice(0, 12)}`);
	}
}

assert.equal(mismatches, 0, `${mismatches} runtime-slice file(s) drifted from Hub vendor core`);
console.log("runtime-slice sync: all files match Hub vendor dsh-coding-oauth-core");

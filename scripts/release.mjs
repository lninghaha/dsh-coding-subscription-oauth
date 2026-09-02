#!/usr/bin/env node
/**
 * Local release verifier/packer.
 *
 * This helper never bumps versions, commits, tags, pushes, or publishes. Those
 * operations require an explicit human decision outside this script.
 */
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "output");
const knownFlags = new Set(["--dry-run", "--pack", "--help"]);
const args = new Set(process.argv.slice(2));
for (const argument of args) {
	if (!knownFlags.has(argument)) {
		console.error(`Unknown option: ${argument}`);
		process.exit(2);
	}
}
if (args.has("--dry-run") && args.has("--pack")) {
	console.error("Choose either --dry-run or --pack, not both.");
	process.exit(2);
}
if (args.has("--help")) {
	console.log(`dsh-coding-subscription-oauth release helper

Usage:
  node scripts/release.mjs --dry-run   Verify current release artifacts and packed file list
  node scripts/release.mjs --pack      Rebuild, verify, and write a local tarball under output/

This command never changes versions, commits, tags, pushes, or publishes.`);
	process.exit(0);
}

const mode = args.has("--pack") ? "pack" : "dry-run";
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");
const expectedName = "dsh-coding-subscription-oauth";
const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

function fail(message) {
	throw new Error(message);
}

function run(command, commandArgs, options = {}) {
	let executable = command;
	let args = commandArgs;
	if (process.platform === "win32" && command === "pnpm") {
		const pnpmCli =
			process.env.npm_execpath ??
			(process.env.APPDATA === undefined
				? undefined
				: resolve(process.env.APPDATA, "npm/node_modules/pnpm/bin/pnpm.cjs"));
		if (pnpmCli === undefined) fail("pnpm CLI path is unavailable on Windows");
		executable = process.execPath;
		args = [pnpmCli, ...commandArgs];
	} else if (process.platform === "win32" && command === "npm") {
		executable = process.execPath;
		args = [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...commandArgs];
	}
	const result = spawnSync(executable, args, {
		cwd: root,
		encoding: "utf8",
		stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		const details = options.capture === true ? `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() : "";
		fail(`${command} ${commandArgs.join(" ")} failed${details === "" ? "" : `:\n${details}`}`);
	}
	return result.stdout ?? "";
}

if (manifest.name !== expectedName) fail(`package name must be ${expectedName}; found ${String(manifest.name)}`);
if (typeof manifest.version !== "string" || !semver.test(manifest.version)) {
	fail(`package version is not valid semver: ${String(manifest.version)}`);
}
if (manifest.private === true) fail("release package must not be private");

const releaseVersions = [
	...changelog.matchAll(/^##\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s+-\s+\d{4}-\d{2}-\d{2})?\s*$/gmu),
].map((match) => match[1]);
if (releaseVersions[0] !== manifest.version) {
	fail(`top CHANGELOG release (${releaseVersions[0] ?? "missing"}) does not match package version ${manifest.version}`);
}
if (!readme.includes(manifest.version)) fail(`README.md does not mention ${manifest.version}`);
const installDoc = await readFile(join(root, "INSTALL.md"), "utf8");
if (!installDoc.includes(manifest.version)) fail(`INSTALL.md does not mention ${manifest.version}`);
const readmeZh = await readFile(join(root, "README.zh-CN.md"), "utf8");
if (!readmeZh.includes(manifest.version)) fail(`README.zh-CN.md does not mention ${manifest.version}`);

if (mode === "pack") run("pnpm", ["run", "release:build"]);
else run("pnpm", ["run", "release:verify"]);

const packOutput = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { capture: true });
let packReport;
try {
	packReport = JSON.parse(packOutput);
} catch (error) {
	throw new Error("npm pack --dry-run returned invalid JSON", { cause: error });
}
const report = Array.isArray(packReport) ? packReport[0] : undefined;
if (report === undefined || !Array.isArray(report.files)) fail("npm pack did not return a file manifest");
const packedFiles = report.files.map((entry) => entry.path).sort();
const packed = new Set(packedFiles);
const missingModes = report.files.filter((entry) => typeof entry.mode !== "number").map((entry) => entry.path);
if (missingModes.length > 0) fail(`npm pack omitted file modes:\n${missingModes.sort().join("\n")}`);
const privateModes = report.files
	.filter((entry) => typeof entry.mode === "number" && (entry.mode & 0o044) !== 0o044)
	.map((entry) => `${entry.path} (${entry.mode.toString(8)})`)
	.sort();
if (privateModes.length > 0)
	fail(`packed release contains files unreadable outside their owner:\n${privateModes.join("\n")}`);
const writableModes = report.files
	.filter((entry) => typeof entry.mode === "number" && (entry.mode & 0o022) !== 0)
	.map((entry) => `${entry.path} (${entry.mode.toString(8)})`)
	.sort();
if (writableModes.length > 0) fail(`packed release contains group/world-writable files:\n${writableModes.join("\n")}`);
for (const required of [
	"package.json",
	"README.md",
	"LICENSE",
	"cordis.patch.yml",
	"lib/index.js",
	"lib/index.d.ts",
	"lib/client.js",
	"lib/bin.js",
	"lib/invariant.js",
	"compatibility/dsh-bom.json",
]) {
	if (!packed.has(required)) fail(`packed release is missing ${required}`);
}
const packedBin = report.files.find((entry) => entry.path === "lib/bin.js");
if (process.platform !== "win32" && typeof packedBin?.mode === "number" && (packedBin.mode & 0o111) === 0) {
	fail(`packed CLI is not executable: lib/bin.js (${packedBin.mode.toString(8)})`);
}
const forbiddenFragments = [
	"docs/local",
	"reference/",
	"src/",
	".env",
	".secrets",
	"package-lock.json",
	"tsdown.config",
	"lib/client.cjs",
	"docs/MIGRATION.md",
];
const leaked = packedFiles.filter((path) => forbiddenFragments.some((fragment) => path.includes(fragment)));
if (leaked.length > 0) fail(`packed release contains forbidden files:\n${leaked.join("\n")}`);

console.log(`Verified ${manifest.name}@${manifest.version}`);
console.log(`Packed files: ${packedFiles.length}`);

if (mode === "dry-run") {
	console.log("Dry-run complete. No version, Git, registry, or tarball changes were made.");
	process.exit(0);
}

const staging = join(output, `.pack-${process.pid}`);
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
try {
	const actualOutput = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", staging], {
		capture: true,
	});
	let actualReport;
	try {
		actualReport = JSON.parse(actualOutput);
	} catch (error) {
		throw new Error("npm pack returned invalid JSON", { cause: error });
	}
	const filename = Array.isArray(actualReport) ? actualReport[0]?.filename : undefined;
	if (typeof filename !== "string" || filename.length === 0) fail("npm pack did not report a tarball filename");
	const source = join(staging, filename);
	await access(source);
	await mkdir(output, { recursive: true });
	const target = join(output, `${manifest.name}-${manifest.version}.tgz`);
	await rm(target, { force: true });
	await rename(source, target);
	console.log(`Wrote ${target}`);
} finally {
	await rm(staging, { recursive: true, force: true });
}

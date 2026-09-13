#!/usr/bin/env node
/**
 * Maintainer-only final gate + npm publish.
 * Agent prepares everything else; the operator runs only:
 *   cd <repo>
 *   npm login --registry https://registry.npmjs.org/
 *   pnpm run release:publish
 *
 * Prefers Node from `$HOME/.nvm/versions/node/v$(.nvmrc)/bin` so Cursor Cloud's
 * `/exec-daemon/node` 22.14 does not drive the publish path.
 *
 * Prints the exact publish target and refuses if that SemVer already exists on
 * the registry (same guard as dsh-hub-oauth-gateway), so a stale checkout or
 * accidental republish of an older tarball fails fast instead of 403 / wrong tag.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim();
const nvmBin = join(homedir(), ".nvm", "versions", "node", `v${nvmrc}`, "bin");
const nvmNode = join(nvmBin, "node");
const packageName = typeof manifest.name === "string" ? manifest.name : "";
const packageVersion = typeof manifest.version === "string" ? manifest.version : "";
const publishTag = packageVersion.includes("-") ? "next" : "latest";
const registry = "https://registry.npmjs.org/";

function run(command, args, options = {}) {
	let executable = command;
	let executableArgs = args;
	if (process.platform === "win32" && command === "pnpm") {
		const envExec = process.env.npm_execpath;
		const installedCli =
			envExec !== undefined && /pnpm/i.test(envExec)
				? envExec
				: process.env.APPDATA === undefined
					? undefined
					: join(process.env.APPDATA, "npm/node_modules/pnpm/bin/pnpm.cjs");
		if (installedCli !== undefined && existsSync(installedCli)) {
			executable = process.execPath;
			executableArgs = [installedCli, ...args];
		} else {
			executable = "pnpm.cmd";
		}
	} else if (process.platform === "win32" && command === "npm") {
		const npmCli = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
		if (existsSync(npmCli)) {
			executable = process.execPath;
			executableArgs = [npmCli, ...args];
		} else {
			executable = "npm.cmd";
		}
	}
	const result = spawnSync(executable, executableArgs, {
		cwd: root,
		env: process.env,
		stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
		shell: false,
		encoding: options.capture === true ? "utf8" : undefined,
		...options,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		if (options.capture === true) {
			const details = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
			if (details) console.error(details);
		}
		process.exit(result.status ?? 1);
	}
	return options.capture === true ? String(result.stdout ?? "") : "";
}

function assertPublishTarget() {
	if (packageName !== "dsh-coding-subscription-oauth") {
		console.error(`refusing to publish unexpected package name: ${packageName || "<missing>"}`);
		process.exit(1);
	}
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)) {
		console.error(`refusing to publish invalid SemVer: ${packageVersion || "<missing>"}`);
		process.exit(1);
	}
	console.log(`Publish target: ${packageName}@${packageVersion} (tag ${publishTag})`);
	console.log(`Repository root: ${root}`);

	const view = spawnSync(
		"npm",
		["view", `${packageName}@${packageVersion}`, "version", "--registry", registry],
		{ cwd: root, env: process.env, encoding: "utf8", shell: false },
	);
	if (view.error) throw view.error;
	const remoteVersion = String(view.stdout ?? "").trim();
	if (view.status === 0 && remoteVersion === packageVersion) {
		console.error(
			`refusing to publish ${packageName}@${packageVersion}: this version already exists on ${registry}`,
		);
		console.error(
			"If you meant a newer release, check out main / the release tag so package.json matches that version, then retry.",
		);
		process.exit(1);
	}
	// npm view exits non-zero when the version is absent; that is the success path here.
	if (view.status !== 0) {
		const errText = `${view.stderr ?? ""}${view.stdout ?? ""}`;
		if (!/E404|404|Not Found|is not in this registry/i.test(errText) && remoteVersion !== "") {
			console.error(errText.trim() || `npm view failed with status ${String(view.status)}`);
			process.exit(view.status ?? 1);
		}
	}
}

if (existsSync(nvmNode)) {
	process.env.PATH = `${nvmBin}${delimiter}${process.env.PATH ?? ""}`;
	if (process.execPath !== nvmNode) {
		const relaunch = spawnSync(nvmNode, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
			cwd: root,
			env: process.env,
			stdio: "inherit",
		});
		process.exit(relaunch.status ?? 1);
	}
}

run(process.execPath, [join(root, "scripts/assert-node.mjs")]);
assertPublishTarget();
run("pnpm", ["run", "release:inspect"]);
run("npm", ["publish", "--access", "public", "--tag", publishTag, "--registry", registry]);
run("npm", ["view", "dsh-coding-subscription-oauth", "version", "--registry", registry]);
run("npm", ["view", "dsh-coding-subscription-oauth", "dist-tags", "--registry", registry]);

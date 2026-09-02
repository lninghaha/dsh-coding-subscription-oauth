#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALPHA = process.env.DSH_ALPHA_VERSION || "0.1.2-alpha.5";
const WEB_PORT = Number(process.env.WEB_PORT || 18381);
const CLI_PREFIX = process.env.DSH_CLI_PREFIX || `/tmp/dsh-cli-${ALPHA}`;
const DSH_HOME = process.env.DSH_HOME || `/tmp/dsh-verify-sub-${ALPHA}`;
const PKG = "@deepseek-ai/dsh";

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
}
const log = (m) => process.stdout.write(`${m}\n`);
async function waitHttp(url, timeoutMs = 90_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { redirect: "manual" });
			if (res.status > 0) return res;
		} catch {}
		await new Promise((r) => setTimeout(r, 400));
	}
	throw new Error(`timeout waiting for ${url}`);
}

if (WEB_PORT === 3080) throw new Error("refusing operator port 3080");
log(`== smoke ${PKG}@${ALPHA} subscription ==`);
mkdirSync(CLI_PREFIX, { recursive: true });
run("npm", ["install", "--prefix", CLI_PREFIX, `${PKG}@${ALPHA}`], { cwd: ROOT });
const dshBin = join(CLI_PREFIX, "node_modules", ".bin", "dsh");
if (!existsSync(dshBin)) throw new Error(`missing ${dshBin}`);
run("pnpm", ["run", "release:pack"], { cwd: ROOT });
const tgz = run("bash", ["-lc", `ls -1 ${ROOT}/output/dsh-coding-subscription-oauth-*.tgz | tail -1`]).trim();
rmSync(DSH_HOME, { recursive: true, force: true });
mkdirSync(join(DSH_HOME, "packages"), { recursive: true });
const destTgz = join(DSH_HOME, "packages", tgz.split("/").at(-1));
cpSync(tgz, destTgz);
const env = { ...process.env, DSH_HOME, HOME: homedir() };
run(dshBin, ["plugin", "--profile", "web", "add", destTgz], { env });

const logFile = join(DSH_HOME, "smoke-web.log");
const out = createWriteStream(logFile);
const child = spawn(dshBin, ["web", "--port", String(WEB_PORT), "--no-open"], { env, stdio: ["ignore", out, out] });

let failed = false;
try {
	const base = `http://127.0.0.1:${WEB_PORT}`;
	await waitHttp(`${base}/`);
	const paths = [
		"/plugins/dsh-coding-subscription-oauth/gateway/reveal",
		"/plugins/dsh-grok-build/gateway/reveal",
	];
	let sawDeny = false;
	for (const path of paths) {
		const allow = await fetch(`${base}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				host: `127.0.0.1:${WEB_PORT}`,
				origin: base,
			},
			body: "{}",
		});
		const deny = await fetch(`${base}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				host: "gateway.example.com",
				origin: "https://gateway.example.com",
			},
			body: "{}",
		});
		log(`${path} loopback=${allow.status} remote=${deny.status}`);
		if (deny.status === 403) sawDeny = true;
	}
	if (!sawDeny) throw new Error("expected remote reveal 403 on at least one path");
	log("PASS: remote reveal denied");
} catch (error) {
	failed = true;
	console.error(error);
} finally {
	child.kill("SIGTERM");
	await new Promise((r) => child.on("exit", r));
	out.close();
}
if (failed) process.exit(1);
log(`OK — comment on GitHub #29 (log: ${logFile})`);

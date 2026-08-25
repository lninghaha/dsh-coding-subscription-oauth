import { execFile, spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertHttp200 } from "./rc2-http-status.mjs";

const run = promisify(execFile);
const root = "/opt/dsh";
const bin = join(root, "node_modules/.bin/dsh");
const home = process.env.DSH_HOME;
const port = Number(process.env.DSH_RC2_PORT);
if (home === undefined || !Number.isSafeInteger(port)) throw new Error("rc2 smoke requires DSH_HOME and DSH_RC2_PORT");

const candidates = (await readdir("/tmp/candidate")).filter((name) => name.endsWith(".tgz"));
if (candidates.length !== 1) throw new Error(`expected one candidate tarball, found ${String(candidates.length)}`);
const candidate = join("/tmp/candidate", candidates[0]);
const environment = { ...process.env, DSH_HOME: home };
const execute = async (...args) => run(bin, args, { cwd: root, env: environment, timeout: 30_000 });
let child;


try {
	await execute("plugin", "--profile", "web", "add", candidate);
	const pluginManifest = JSON.parse(await readFile(join(home, "profiles", "web", "node_modules", "dsh-coding-subscription-oauth", "package.json"), "utf8"));
	if (pluginManifest.name !== "dsh-coding-subscription-oauth" || pluginManifest.version !== "0.6.2") {
		throw new Error("candidate package was not installed into a fresh DSH web profile");
	}
	if (JSON.stringify(pluginManifest).includes("file:../dsh-coding-oauth-core")) {
		throw new Error("packed manifest retained a sibling core path");
	}
	child = spawn(bin, ["web", "--port", String(port)], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
	let log = "";
	child.stdout.on("data", (chunk) => (log += chunk));
	child.stderr.on("data", (chunk) => (log += chunk));
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`dsh web exited early: ${log}`);
		try {
			const response = await fetch(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(1_000) });
			if (response.status === 200) break;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	if (Date.now() >= deadline) throw new Error("timed out waiting for rc.2 DSH root route to return 200");
	for (const path of ["/", "/plugins/dsh-grok-build/oauth/status", "/plugins/dsh-grok-build/auth/status", "/plugins/dsh-grok-build/capabilities"]) {
		const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { signal: AbortSignal.timeout(3_000) });
		assertHttp200(path, response.status);
		console.log(`rc2 smoke ${path}=${String(response.status)}`);
	}
	if (/plugin tree failed|required DSH webServer routes did not activate|cannot create effect|duplicate route|Cannot find package/iu.test(log)) {
		throw new Error(`rc.2 DSH startup log contains a plugin failure: ${log}`);
	}
	console.log(`rc2 resolved ${JSON.stringify({ dsh: JSON.parse(await readFile(join(root, "node_modules/@deepseek-ai/dsh/package.json"), "utf8")).version, plugin: pluginManifest.version })}`);
} finally {
	if (child !== undefined && child.exitCode === null) {
		child.kill("SIGTERM");
		await new Promise((resolve) => child.once("exit", resolve));
	}
	await rm(home, { recursive: true, force: true });
}

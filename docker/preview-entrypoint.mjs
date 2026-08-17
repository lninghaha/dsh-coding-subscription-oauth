import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPreviewProxy } from "./preview-proxy.mjs";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PROFILE_MARKER = ".preview-seed-version";
const EXPECTED_PROFILE_MARKER = "dsh-oauth-preview-v1";

function configuredPort(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	if (!/^\d{1,5}$/u.test(raw)) throw new Error(`${name} must be a TCP port number`);
	const port = Number(raw);
	const allowed = (port >= 17_800 && port <= 17_999) || (port >= 19_000 && port <= 19_199);
	if (!Number.isSafeInteger(port) || !allowed) {
		throw new Error(`${name} must be in the isolated preview ranges 17800-17999 or 19000-19199`);
	}
	return port;
}

function configuredProtocol() {
	const value = process.env.DSH_PREVIEW_PUBLIC_PROTOCOL ?? "http";
	if (value !== "http" && value !== "https") throw new Error("DSH_PREVIEW_PUBLIC_PROTOCOL must be http or https");
	return value;
}

const backendHost = "127.0.0.1";
const backendPort = configuredPort("DSH_PREVIEW_BACKEND_PORT", 17_802);
const proxyHost = "0.0.0.0";
const proxyPort = configuredPort("DSH_PREVIEW_PORT", 17_800);
if (backendPort === proxyPort) throw new Error("DSH_PREVIEW_BACKEND_PORT and DSH_PREVIEW_PORT must differ");
const publicProtocol = configuredProtocol();
const seedProfile = "/opt/dsh-seed/profiles/web";
const dshHome = process.env.DSH_HOME ?? "/data/dsh";
const tokenPath = "/run/dsh-preview/token";
const targetProfiles = join(dshHome, "profiles");
const targetProfile = join(targetProfiles, "web");

async function profileManifest(profile) {
	const value = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
	if (value.name !== "dsh-profile-web-preview") throw new Error("preview profile manifest has an unexpected name");
	const bundles = value.dsh?.profile?.bundles;
	if (!Array.isArray(bundles) || !bundles.includes("dsh-coding-subscription-oauth")) {
		throw new Error("preview profile manifest does not load dsh-coding-subscription-oauth");
	}
}

async function validateProfile(profile) {
	await profileManifest(profile);
	const marker = (await readFile(join(profile, PROFILE_MARKER), "utf8")).trim();
	if (marker !== EXPECTED_PROFILE_MARKER) throw new Error("preview profile seed version is incompatible with this image");
	await readFile(join(profile, "cordis.patch.yml"), "utf8");
	await readFile(join(profile, "pnpm-workspace.yaml"), "utf8");
	const pluginLink = join(profile, "node_modules", "dsh-coding-subscription-oauth");
	const info = await lstat(pluginLink);
	if (!info.isSymbolicLink() || (await readlink(pluginLink)) !== "/opt/dsh-plugin") {
		throw new Error("preview profile plugin link is invalid");
	}
}

async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function prepareHome() {
	await mkdir(dshHome, { recursive: true, mode: 0o700 });
	await chmod(dshHome, 0o700);
	await mkdir(targetProfiles, { recursive: true, mode: 0o700 });
	if (await pathExists(targetProfile)) {
		await validateProfile(targetProfile);
		return;
	}
	const temporaryRoot = await mkdtemp(join(targetProfiles, ".web-preview-seed-"));
	const temporaryProfile = join(temporaryRoot, "web");
	try {
		await cp(seedProfile, temporaryProfile, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
		await validateProfile(temporaryProfile);
		await rename(temporaryProfile, targetProfile);
		await rm(temporaryRoot, { recursive: true, force: true });
	} catch (error) {
		await rm(temporaryRoot, { recursive: true, force: true });
		if (error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY")) {
			await validateProfile(targetProfile);
			return;
		}
		throw error;
	}
}

async function previewToken() {
	await mkdir("/run/dsh-preview", { recursive: true, mode: 0o700 });
	const existing = process.env.DSH_PREVIEW_TOKEN;
	const token = existing === undefined || existing === "" ? randomBytes(32).toString("base64url") : existing;
	if (!TOKEN_PATTERN.test(token)) throw new Error("DSH_PREVIEW_TOKEN must be exactly 32 base64url-encoded bytes");
	await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
	await chmod(tokenPath, 0o600);
	return token;
}

function authorities() {
	const values = (process.env.DSH_PREVIEW_AUTHORITIES ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value !== "");
	if (values.length === 0) throw new Error("DSH_PREVIEW_AUTHORITIES must list at least one host:port authority");
	return values;
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function childOutcome(child) {
	let settled;
	const promise = new Promise((resolve) => {
		child.once("error", (error) => resolve({ kind: "error", error }));
		child.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
	});
	void promise.then((value) => {
		settled = value;
	});
	return { promise, current: () => settled };
}

function describeChildOutcome(outcome, stage) {
	if (outcome.kind === "error") return new Error(`dsh web ${stage}: ${outcome.error.message}`, { cause: outcome.error });
	return new Error(`dsh web exited ${stage} with code ${String(outcome.code)} signal ${String(outcome.signal)}`);
}

async function waitForBackend(outcome, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const childState = outcome.current();
		if (childState !== undefined) throw describeChildOutcome(childState, "during startup");
		try {
			const response = await fetch(`http://${backendHost}:${String(backendPort)}/`, {
				signal: AbortSignal.timeout(1_000),
			});
			if (response.ok) return;
		} catch {
			// The backend may still be composing its profile.
		}
		await delay(250);
	}
	throw new Error("timed out waiting for dsh web backend");
}

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(proxyPort, proxyHost, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

async function close(server) {
	if (!server.listening) return;
	await new Promise((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

async function stopChild(child, outcome, signal, timeoutMs = 5_000) {
	if (outcome.current() !== undefined) return await outcome.promise;
	child.kill(signal);
	const graceful = await Promise.race([outcome.promise, delay(timeoutMs).then(() => undefined)]);
	if (graceful !== undefined) return graceful;
	child.kill("SIGKILL");
	return await outcome.promise;
}

await prepareHome();
const token = await previewToken();
const allowedAuthorities = authorities();
const proxy = createPreviewProxy({ backendHost, backendPort, token, allowedAuthorities, publicProtocol });
const childEnvironment = { ...process.env, DSH_HOME: dshHome };
delete childEnvironment.DSH_PREVIEW_TOKEN;
const child = spawn(
	process.execPath,
	["--expose-internals", "/opt/dsh/lib/bin.js", "web", "--port", String(backendPort)],
	{
		cwd: "/workspace",
		env: childEnvironment,
		stdio: "inherit",
	},
);
const outcome = childOutcome(child);
let stopping = false;
let requestedSignal;

async function stop(signal) {
	if (stopping) return;
	stopping = true;
	proxy.closeAllConnections();
	await close(proxy).catch(() => undefined);
	await stopChild(child, outcome, signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		requestedSignal = signal;
		void stop(signal).catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
	});
}

try {
	await waitForBackend(outcome);
	await listen(proxy);
	console.log(`dsh preview proxy listening on ${proxyHost}:${String(proxyPort)}`);
	const result = await outcome.promise;
	if (!stopping) {
		proxy.closeAllConnections();
		await close(proxy).catch(() => undefined);
	}
	if (result.kind === "error") throw describeChildOutcome(result, "after startup");
	if (requestedSignal !== undefined) process.exitCode = requestedSignal === "SIGINT" ? 130 : 0;
	else process.exitCode = result.code ?? 1;
} catch (error) {
	await stop("SIGTERM");
	throw error;
}

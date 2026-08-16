#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
//#region src/ids.ts
const CODEX_PI_PROVIDER = "openai-codex";
const KIMI_PI_PROVIDER = "kimi-coding";
const CLAUDE_PI_PROVIDER = "anthropic";
/** Harness LLM routes. OAuth aliases avoid the user's API-key route ids. */
const GROK_BUILD_ROUTE = "grok-build";
const CODEX_OAUTH_ROUTE = "codex-oauth";
const KIMI_CODE_OAUTH_ROUTE = "kimi-code-oauth";
const CLAUDE_CODE_OAUTH_ROUTE = "claude-code-oauth";
/** Basenames of private OAuth documents inside the Harness home. */
const GROK_BUILD_AUTH_FILENAME = ".grok-build-auth.json";
const CODEX_OAUTH_AUTH_FILENAME = ".codex-oauth-auth.json";
const KIMI_CODE_OAUTH_AUTH_FILENAME = ".kimi-code-oauth-auth.json";
const CLAUDE_CODE_OAUTH_AUTH_FILENAME = ".claude-code-oauth-auth.json";
/** Basenames of model selection/catalog caches inside the Harness home. */
const GROK_BUILD_MODELS_CACHE_FILENAME = ".grok-build-models.json";
const CODEX_OAUTH_MODELS_CACHE_FILENAME = ".codex-oauth-models.json";
const KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME = ".kimi-code-oauth-models.json";
const CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME = ".claude-code-oauth-models.json";
//#endregion
//#region src/grok-import.ts
/**
* One-shot import of Grok CLI credentials into the dsh-owned store.
* The source file is never written. Refresh tokens rotate, so later dsh
* refresh may invalidate ~/.grok/auth.json — that is documented, not a bug.
* @module dsh-grok-build/grok-import
*/
const DEFAULT_TOKEN_LIFETIME_MS = 36e5;
function isENOENT$3(error) {
	return error?.code === "ENOENT";
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function firstString(record, keys) {
	for (const key of keys) {
		const value = nonEmptyString(record[key]);
		if (value !== void 0) return value;
	}
}
function parseTime(value) {
	const parsed = Date.parse(value);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	const trimmed = value.replace(/(\.\d{3})\d+/, "$1");
	const again = Date.parse(trimmed);
	return Number.isFinite(again) && again > 0 ? again : NaN;
}
function parseExpires(record) {
	const expiresAt = record["expires_at"];
	if (typeof expiresAt === "string" && expiresAt.length > 0) {
		const parsed = parseTime(expiresAt);
		if (Number.isFinite(parsed)) return parsed;
	}
	if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt < 0xe8d4a51000 ? expiresAt * 1e3 : expiresAt;
	const expires = record["expires"];
	if (typeof expires === "number" && Number.isFinite(expires) && expires > 0) return expires < 0xe8d4a51000 ? expires * 1e3 : expires;
	const expiresIn = record["expires_in"];
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) return Date.now() + expiresIn * 1e3;
	return Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
}
function walk(value, key) {
	if (Array.isArray(value)) return value.flatMap((item, index) => walk(item, `${key}[${index}]`));
	if (!isRecord$1(value)) return [];
	const access = firstString(value, [
		"key",
		"access",
		"access_token"
	]);
	const refresh = firstString(value, ["refresh_token", "refresh"]);
	if (access !== void 0 && refresh !== void 0) {
		const issuer = firstString(value, ["oidc_issuer", "issuer"]);
		const preferred = key.includes("auth.x.ai") || issuer !== void 0 && issuer.includes("auth.x.ai");
		const accountId = firstString(value, [
			"user_id",
			"accountId",
			"principal_id"
		]);
		return [{
			credential: {
				type: "oauth",
				access,
				refresh,
				expires: parseExpires(value),
				...accountId === void 0 ? {} : { accountId }
			},
			preferred
		}];
	}
	return Object.entries(value).flatMap(([child, nested]) => walk(nested, child));
}
/** Resolve the Grok CLI auth document. */
function grokAuthPath(home = homedir()) {
	return resolve(join(home, ".grok", "auth.json"));
}
/** Parse a Grok CLI / generic OAuth document into a pi-ai credential. */
function parseGrokAuthDocument(text, filename) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`grok-build: ${filename} is not valid JSON`);
	}
	const candidates = walk(value, "");
	if (candidates.length === 0) throw new Error(`grok-build: ${filename} does not contain a Grok OAuth refresh token`);
	return (candidates.find((candidate) => candidate.preferred) ?? candidates[0]).credential;
}
/** Copy Grok CLI tokens into the dsh store. Does not write the Grok file. */
async function importGrokAuth(store, filename = grokAuthPath()) {
	let text;
	try {
		text = await readFile(filename, "utf8");
	} catch (error) {
		if (isENOENT$3(error)) throw new Error(`grok-build: Grok CLI auth file not found at ${filename}`);
		throw error;
	}
	const credential = parseGrokAuthDocument(text, filename);
	const written = await store.modify("xai", async () => credential);
	if (written === void 0 || written.type !== "oauth") throw new Error("grok-build: failed to persist the imported Grok credential");
	return written;
}
//#endregion
//#region src/store.ts
/**
* Owner-only persistent OAuth credential storage for coding-subscription routes.
* @module dsh-grok-build/store
*/
/** Current on-disk format; readers reject every other version. */
const AUTH_FORMAT_VERSION = 1;
function isENOENT$2(error) {
	return error?.code === "ENOENT";
}
async function assertOwnerOnly(filename, label) {
	let mode;
	try {
		mode = (await stat(filename)).mode;
	} catch (error) {
		if (isENOENT$2(error)) return;
		throw error;
	}
	if (process.platform === "win32") return;
	if ((mode & 63) !== 0) throw new Error(`${label}: ${filename} is readable beyond its owner (mode ${(mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
}
function parseDocument(text, filename, label) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`${label}: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}: ${filename} must contain an object`);
	const document = value;
	if (document["version"] !== AUTH_FORMAT_VERSION) throw new Error(`${label}: ${filename} has unsupported auth format version ${String(document["version"])}`);
	if (Object.keys(document).some((key) => key !== "version" && key !== "credential")) throw new Error(`${label}: ${filename} contains an unknown top-level field`);
	const raw = document["credential"];
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${label}: ${filename} credential must be an object`);
	const credential = raw;
	const allowed = /* @__PURE__ */ new Set([
		"type",
		"access",
		"refresh",
		"expires",
		"accountId"
	]);
	if (Object.keys(credential).some((key) => !allowed.has(key))) throw new Error(`${label}: ${filename} credential contains an unknown field`);
	if (credential["type"] !== "oauth") throw new Error(`${label}: ${filename} credential type must be oauth`);
	for (const key of ["access", "refresh"]) if (typeof credential[key] !== "string" || credential[key].length === 0) throw new Error(`${label}: ${filename} credential ${key} must be a non-empty string`);
	if (credential["accountId"] !== void 0 && (typeof credential["accountId"] !== "string" || credential["accountId"].length === 0)) throw new Error(`${label}: ${filename} credential accountId must be a non-empty string when present`);
	if (typeof credential["expires"] !== "number" || !Number.isFinite(credential["expires"]) || credential["expires"] <= 0) throw new Error(`${label}: ${filename} credential expires must be a positive finite number`);
	return {
		version: AUTH_FORMAT_VERSION,
		credential
	};
}
function cloneCredential(credential) {
	return structuredClone(credential);
}
/** Resolve one private OAuth document path beneath DSH_HOME. */
function oauthCredentialPath(basename, dshHome) {
	return resolve(join(resolveDshHome(dshHome), basename));
}
/** Resolve the legacy Grok Build OAuth document path. */
function grokBuildAuthPath(dshHome) {
	return oauthCredentialPath(GROK_BUILD_AUTH_FILENAME, dshHome);
}
/**
* File-backed pi-ai store scoped to exactly one provider id. Separate provider
* files prevent one corrupted or rotated credential from affecting another.
*/
var OAuthCredentialFileStore = class {
	providerId;
	label;
	filename;
	constructor(providerId, filename, label) {
		this.providerId = providerId;
		this.label = label;
		this.filename = resolve(filename);
	}
	async readCurrent() {
		await assertOwnerOnly(this.filename, this.label);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT$2(error)) return void 0;
			throw error;
		}
		return cloneCredential(parseDocument(text, this.filename, this.label).credential);
	}
	async read(providerId) {
		return providerId === this.providerId ? this.readCurrent() : void 0;
	}
	async list() {
		return await this.readCurrent() === void 0 ? [] : [{
			providerId: this.providerId,
			type: "oauth"
		}];
	}
	async modify(providerId, fn) {
		if (providerId !== this.providerId) throw new Error(`${this.label}: credential store does not own provider "${providerId}"`);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			const candidate = await fn(current);
			if (candidate === void 0) return current;
			const document = parseDocument(JSON.stringify({
				version: AUTH_FORMAT_VERSION,
				credential: candidate
			}), this.filename, this.label);
			await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return cloneCredential(document.credential);
		});
	}
	async delete(providerId) {
		if (providerId !== this.providerId) return;
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		await withFileLock(this.filename, () => rm(this.filename, { force: true }));
	}
};
/** Legacy-named store retained for existing imports and credential migration. */
var GrokBuildCredentialStore = class extends OAuthCredentialFileStore {
	constructor(filename = grokBuildAuthPath()) {
		super("xai", filename, "grok-build");
	}
};
//#endregion
//#region src/auth.ts
/**
* Grok Build OAuth orchestration shared by the plugin and standalone CLI.
* @module dsh-grok-build/auth
*/
/**
* Complete the xAI device-code OAuth flow and persist the credential.
* The Grok Build backend accepts the same auth.x.ai tokens (scope
* `grok-cli:access`); the PKCE authorization-code flow lands in a later
* milestone as the primary path.
*/
async function loginGrokBuild(interaction, store = new GrokBuildCredentialStore()) {
	const models = createModels({ credentials: store });
	models.setProvider(xaiProvider());
	await models.login("xai", "oauth", interaction);
}
/** Copy ~/.grok/auth.json into the dsh store. Does not modify the Grok file. */
async function importGrokBuildFromGrok(store = new GrokBuildCredentialStore(), filename) {
	await importGrokAuth(store, filename);
}
/** Read non-secret login state without refreshing the token. */
async function grokBuildAuthStatus(store = new GrokBuildCredentialStore()) {
	const credential = await store.read("xai");
	return credential?.type === "oauth" ? {
		authenticated: true,
		expiresAt: new Date(credential.expires)
	} : { authenticated: false };
}
/** Login then refresh the account model list when a session is available. */
async function loginGrokBuildSession(interaction, session) {
	await loginGrokBuild(interaction, session.store);
	await session.refreshLiveCatalog();
}
async function importGrokBuildSession(session, filename) {
	await importGrokBuildFromGrok(session.store, filename);
	await session.refreshLiveCatalog();
}
const DISCOVERY_PATH = "/.well-known/openid-configuration";
const DEFAULT_LOGIN_TIMEOUT_MS = 6e5;
const PORT_SCAN_ATTEMPTS = 10;
/** OAuth failure with a stable, secret-free machine code. */
var GrokBuildOAuthError = class extends Error {
	code;
	constructor(code, message) {
		super(`grok-build oauth: ${message}`);
		this.name = "GrokBuildOAuthError";
		this.code = code;
	}
};
/** Resolve OAuth parameters from overrides then GROK_OAUTH2_* env vars. */
function resolveOAuthParams(overrides = {}) {
	const env = process.env;
	return {
		issuer: overrides.issuer ?? env["GROK_OAUTH2_ISSUER"] ?? "https://auth.x.ai",
		clientId: overrides.clientId ?? env["GROK_OAUTH2_CLIENT_ID"] ?? "b1a00492-073a-47ea-816f-4c329264a828",
		scope: overrides.scope ?? env["GROK_OAUTH2_SCOPES"] ?? "openid profile email offline_access grok-cli:access api:access",
		port: overrides.port ?? (env["GROK_OAUTH2_PORT"] !== void 0 ? Number(env["GROK_OAUTH2_PORT"]) : 56121),
		...overrides.referrer ?? env["GROK_OAUTH2_REFERRER"] ? { referrer: overrides.referrer ?? env["GROK_OAUTH2_REFERRER"] } : {}
	};
}
let discoveryCache;
/** Fetch (and cache for the process) the issuer's discovery document. */
async function discoverOAuthEndpoints(issuer, signal) {
	if (discoveryCache !== void 0 && discoveryCache.issuer === issuer && Date.now() - discoveryCache.fetchedAt < 36e5) return discoveryCache.document;
	let response;
	try {
		response = await fetch(`${issuer}${DISCOVERY_PATH}`, {
			headers: { accept: "application/json" },
			signal
		});
	} catch {
		throw new GrokBuildOAuthError("discovery", `issuer ${issuer} is unreachable`);
	}
	if (!response.ok) throw new GrokBuildOAuthError("discovery", `issuer ${issuer} discovery failed (HTTP ${response.status})`);
	let body;
	try {
		body = await response.json();
	} catch {
		throw new GrokBuildOAuthError("discovery", `issuer ${issuer} discovery returned invalid JSON`);
	}
	const document = body;
	if (typeof document.authorization_endpoint !== "string" || typeof document.token_endpoint !== "string") throw new GrokBuildOAuthError("discovery", `issuer ${issuer} discovery lacks OAuth endpoints`);
	const parsed = {
		authorization_endpoint: document.authorization_endpoint,
		token_endpoint: document.token_endpoint
	};
	discoveryCache = {
		issuer,
		document: parsed,
		fetchedAt: Date.now()
	};
	return parsed;
}
/** Generate an S256 PKCE verifier/challenge pair (Web Crypto compatible). */
function generatePkce() {
	const verifier = randomBytes(32).toString("base64url");
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url")
	};
}
function randomToken() {
	return randomBytes(16).toString("base64url");
}
/** Build the authorization URL for one login attempt. */
function buildAuthorizeUrl(endpoints, params, redirectUri, challenge, state, nonce) {
	const url = new URL(endpoints.authorization_endpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", params.clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", params.scope);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("nonce", nonce);
	if (params.referrer !== void 0) url.searchParams.set("referrer", params.referrer);
	return url.href;
}
const LOOPBACK_OK_PAGE = "<!doctype html><meta charset=\"utf-8\"><title>Grok Build</title><body style=\"font-family:system-ui;text-align:center;padding:4rem\"><h2>Grok Build sign-in complete</h2><p>You can close this tab and return to dsh.</p></body>";
const LOOPBACK_ERROR_PAGE = "<!doctype html><meta charset=\"utf-8\"><title>Grok Build</title><body style=\"font-family:system-ui;text-align:center;padding:4rem\"><h2>Sign-in failed</h2><p>State mismatch or missing code — try again in dsh.</p></body>";
/**
* Listen on 127.0.0.1 for the IdP redirect. Falls forward across a small port
* scan on EADDRINUSE. Any request path is accepted; only the query matters.
*/
async function listenForCode(port, state, signal) {
	let lastError;
	for (let attempt = 0; attempt < PORT_SCAN_ATTEMPTS; attempt += 1) {
		const candidate = port + attempt;
		const server = createServer();
		const wait = new Promise((resolvePromise, rejectPromise) => {
			server.on("request", (request, response) => {
				const url = new URL(request.url ?? "/", "http://127.0.0.1");
				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const returnedState = url.searchParams.get("state");
				if (error !== null) {
					response.writeHead(400, { "content-type": "text/html" }).end(LOOPBACK_ERROR_PAGE);
					rejectPromise(new GrokBuildOAuthError("token_exchange", `authorization returned error: ${error}`));
					return;
				}
				if (code === null || returnedState !== state) {
					response.writeHead(400, { "content-type": "text/html" }).end(LOOPBACK_ERROR_PAGE);
					rejectPromise(new GrokBuildOAuthError("state_mismatch", "loopback redirect carried a mismatched state"));
					return;
				}
				response.writeHead(200, { "content-type": "text/html" }).end(LOOPBACK_OK_PAGE);
				resolvePromise({ code });
			});
			server.on("error", (error) => rejectPromise(error));
			signal.addEventListener("abort", () => {
				rejectPromise(/* @__PURE__ */ new Error("loopback listener aborted"));
			}, { once: true });
		});
		try {
			await new Promise((resolvePromise, rejectPromise) => {
				server.once("error", rejectPromise);
				server.listen(candidate, "127.0.0.1", resolvePromise);
			});
			wait.catch(() => {});
			const address = server.address();
			return {
				server,
				port: typeof address === "object" && address !== null ? address.port : candidate,
				wait
			};
		} catch (error) {
			lastError = error;
			server.removeAllListeners();
			await new Promise((resolvePromise) => server.close(() => resolvePromise()));
			if (error?.code !== "EADDRINUSE") break;
		}
	}
	throw new GrokBuildOAuthError("loopback", `could not bind a loopback listener near port ${port}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
function credentialFromTokenResponse(body, previousRefresh) {
	const access = body.access_token;
	if (typeof access !== "string" || access.length === 0) throw new GrokBuildOAuthError("token_exchange", "token response missing access_token");
	const refresh = typeof body.refresh_token === "string" && body.refresh_token.length > 0 ? body.refresh_token : previousRefresh;
	if (refresh === void 0) throw new GrokBuildOAuthError("token_exchange", "token response missing refresh_token");
	const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : 3600;
	return {
		type: "oauth",
		access,
		refresh,
		expires: Date.now() + expiresIn * 1e3
	};
}
async function postTokenForm(tokenEndpoint, fields, signal, previousRefresh) {
	let response;
	try {
		response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams(fields),
			signal
		});
	} catch (error) {
		if (signal?.aborted) throw new GrokBuildOAuthError("cancelled", "request was cancelled");
		throw new GrokBuildOAuthError("token_exchange", `token endpoint is unreachable: ${error instanceof Error ? error.message : String(error)}`);
	}
	let body;
	try {
		body = await response.json();
	} catch {
		throw new GrokBuildOAuthError("token_exchange", `token endpoint returned invalid JSON (HTTP ${response.status})`);
	}
	if (!response.ok) throw new GrokBuildOAuthError("token_exchange", `token endpoint rejected the request (${typeof body.error === "string" ? body.error : `HTTP ${response.status}`})${typeof body.error_description === "string" ? `: ${body.error_description}` : ""}`);
	return credentialFromTokenResponse(body, previousRefresh);
}
/** Extract a bare code from user input that may be a full redirect URL. */
function extractCode(input) {
	const trimmed = input.trim();
	if (trimmed.length === 0) return trimmed;
	try {
		return new URL(trimmed).searchParams.get("code") ?? trimmed;
	} catch {
		return trimmed;
	}
}
/**
* Run the authorization-code + PKCE login. The code arrives via the loopback
* listener or the manual-paste channel, whichever wins. The caller persists
* the returned credential (store.modify under the file lock).
*/
async function loginGrokBuildPkce(callbacks, overrides = {}) {
	const params = resolveOAuthParams(overrides);
	const timeoutMs = callbacks.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
	const controller = new AbortController();
	/** Aborts the losing code-capture channel once one channel wins. */
	const channelsController = new AbortController();
	const onParentAbort = () => {
		controller.abort();
	};
	callbacks.signal?.addEventListener("abort", onParentAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref?.();
	try {
		const endpoints = await discoverOAuthEndpoints(params.issuer, controller.signal);
		const { verifier, challenge } = generatePkce();
		const state = randomToken();
		const nonce = randomToken();
		const listener = await listenForCode(params.port, state, controller.signal);
		const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
		const url = buildAuthorizeUrl(endpoints, params, redirectUri, challenge, state, nonce);
		try {
			callbacks.onAuthorizeUrl(url);
			const channels = [listener.wait.then((result) => result.code)];
			if (callbacks.awaitCode !== void 0) channels.push(callbacks.awaitCode(channelsController.signal).then((input) => input === void 0 || extractCode(input).length === 0 ? new Promise(() => {}) : extractCode(input)));
			const code = await Promise.race(channels);
			channelsController.abort();
			return await postTokenForm(endpoints.token_endpoint, {
				grant_type: "authorization_code",
				client_id: params.clientId,
				redirect_uri: redirectUri,
				code,
				code_verifier: verifier
			}, controller.signal);
		} finally {
			listener.server.close();
		}
	} catch (error) {
		if (controller.signal.aborted && !(error instanceof GrokBuildOAuthError)) {
			const timedOut = !callbacks.signal?.aborted;
			throw new GrokBuildOAuthError(timedOut ? "timeout" : "cancelled", timedOut ? `no authorization completed within ${Math.round(timeoutMs / 6e4)} minutes` : "login was cancelled");
		}
		throw error;
	} finally {
		clearTimeout(timer);
		callbacks.signal?.removeEventListener("abort", onParentAbort);
	}
}
//#endregion
//#region src/oauth-providers.ts
function requestTokenAuth(name, bearerHeader) {
	return {
		name,
		resolve: async ({ credential }) => {
			const token = credential?.key?.trim();
			if (token === void 0 || token.length === 0) return void 0;
			return bearerHeader ? {
				auth: { headers: { Authorization: `Bearer ${token}` } },
				source: "OAuth bridge"
			} : {
				auth: { apiKey: token },
				source: "OAuth bridge"
			};
		}
	};
}
function selectedProvider(base, selectedIds, apiKey) {
	const selected = selectedIds === void 0 || selectedIds.length === 0 ? void 0 : new Set(selectedIds);
	return {
		...base,
		auth: apiKey === void 0 ? base.auth : {
			...base.auth,
			apiKey
		},
		getModels: () => {
			const models = base.getModels();
			return selected === void 0 ? models : models.filter((model) => selected.has(model.id));
		}
	};
}
/**
* PiAiAdapter's api-key resolver seam necessarily populates `options.apiKey`.
* Kimi OAuth is header-owned Bearer auth, so remove that transport-only carrier
* after Models has derived Authorization and before the Anthropic client sees
* it (otherwise the SDK also emits an invalid x-api-key header).
*/
function stripApiKeyBeforeStream(provider) {
	return {
		...provider,
		stream: (model, context, options) => provider.stream(model, context, options === void 0 ? void 0 : {
			...options,
			apiKey: void 0
		}),
		streamSimple: (model, context, options) => provider.streamSimple(model, context, options === void 0 ? void 0 : {
			...options,
			apiKey: void 0
		})
	};
}
function asProvider(factory) {
	return factory;
}
const createCodexProvider = asProvider(openaiCodexProvider);
const createKimiProvider = asProvider(kimiCodingProvider);
const createClaudeProvider = asProvider(anthropicProvider);
const OAUTH_PROVIDER_DEFINITIONS = [
	{
		slug: "codex",
		route: CODEX_OAUTH_ROUTE,
		nativeProviderId: CODEX_PI_PROVIDER,
		displayName: "OpenAI Codex (ChatGPT Plus/Pro)",
		authFilename: CODEX_OAUTH_AUTH_FILENAME,
		modelsCacheFilename: CODEX_OAUTH_MODELS_CACHE_FILENAME,
		loginMethods: ["device", "browser"],
		recommendedLoginMethod: "device",
		providerFactory: createCodexProvider,
		requestProvider: (selectedIds) => selectedProvider(createCodexProvider(), selectedIds, requestTokenAuth("OpenAI Codex OAuth token", false))
	},
	{
		slug: "kimi",
		route: KIMI_CODE_OAUTH_ROUTE,
		nativeProviderId: KIMI_PI_PROVIDER,
		displayName: "Kimi Code (subscription)",
		authFilename: KIMI_CODE_OAUTH_AUTH_FILENAME,
		modelsCacheFilename: KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME,
		loginMethods: ["device"],
		recommendedLoginMethod: "device",
		providerFactory: createKimiProvider,
		requestProvider: (selectedIds) => stripApiKeyBeforeStream(selectedProvider(createKimiProvider(), selectedIds, requestTokenAuth("Kimi Code OAuth token", true)))
	},
	{
		slug: "claude",
		route: CLAUDE_CODE_OAUTH_ROUTE,
		nativeProviderId: CLAUDE_PI_PROVIDER,
		displayName: "Claude Code (Pro/Max)",
		authFilename: CLAUDE_CODE_OAUTH_AUTH_FILENAME,
		modelsCacheFilename: CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
		loginMethods: ["browser"],
		recommendedLoginMethod: "browser",
		providerFactory: createClaudeProvider,
		requestProvider: (selectedIds) => selectedProvider(createClaudeProvider(), selectedIds, void 0)
	}
];
function oauthProviderDefinition(slug) {
	return OAUTH_PROVIDER_DEFINITIONS.find((provider) => provider.slug === slug);
}
//#endregion
//#region src/oauth-session.ts
/**
* Persistent OAuth session and static model selection for one subscription provider.
* @module dsh-grok-build/oauth-session
*/
const MODELS_CACHE_VERSION$1 = 1;
function isENOENT$1(error) {
	return error?.code === "ENOENT";
}
function parseIdList$1(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((id) => typeof id === "string" && id.length > 0))];
}
function parseCache$1(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const document = value;
	if (document["version"] !== MODELS_CACHE_VERSION$1) return void 0;
	const selected = parseIdList$1(document["selected"]);
	return selected.length === 0 ? void 0 : selected;
}
function oauthModelsCachePath(basename, dshHome) {
	return resolve(join(resolveDshHome(dshHome), basename));
}
var OAuthProviderSession = class {
	definition;
	store;
	models;
	catalog;
	cacheFile;
	selectedIds;
	constructor(definition, onCatalogChange, store = new OAuthCredentialFileStore(definition.nativeProviderId, oauthCredentialPath(definition.authFilename), definition.route), cacheFile = oauthModelsCachePath(definition.modelsCacheFilename)) {
		this.definition = definition;
		this.store = store;
		this.cacheFile = resolve(cacheFile);
		const provider = definition.providerFactory();
		this.catalog = [...provider.getModels()];
		this.models = createModels({ credentials: store });
		this.models.setProvider(provider);
		this.onCatalogChange = onCatalogChange;
	}
	onCatalogChange;
	availableModels() {
		return [...this.catalog];
	}
	selectedModelIds() {
		return this.selectedIds === void 0 ? void 0 : [...this.selectedIds];
	}
	visibleModels() {
		if (this.selectedIds === void 0 || this.selectedIds.length === 0) return this.availableModels();
		const byId = new Map(this.catalog.map((model) => [model.id, model]));
		return this.selectedIds.flatMap((id) => {
			const model = byId.get(id);
			return model === void 0 ? [] : [model];
		});
	}
	provider() {
		return this.definition.requestProvider(this.visibleModels().map((model) => model.id));
	}
	async loadCachedModels() {
		try {
			this.selectedIds = parseCache$1(await readFile(this.cacheFile, "utf8"));
		} catch (error) {
			if (!isENOENT$1(error)) throw error;
		}
	}
	async setSelectedModels(ids) {
		const available = new Set(this.catalog.map((model) => model.id));
		const selected = [...new Set(ids.filter((id) => available.has(id)))];
		this.selectedIds = selected.length === 0 ? void 0 : selected;
		await this.writeCache();
		this.onCatalogChange?.();
	}
	async status() {
		const credential = await this.store.read(this.definition.nativeProviderId);
		if (credential?.type !== "oauth") return { authenticated: false };
		return {
			authenticated: true,
			expiresAt: credential.expires
		};
	}
	async login(interaction) {
		const credential = await this.models.login(this.definition.nativeProviderId, "oauth", interaction);
		this.onCatalogChange?.();
		return credential;
	}
	async resolveAccessToken() {
		if (await this.models.getAuth(this.definition.nativeProviderId) === void 0) return void 0;
		const credential = await this.store.read(this.definition.nativeProviderId);
		return credential?.type === "oauth" ? credential.access : void 0;
	}
	async storedCredential() {
		const credential = await this.store.read(this.definition.nativeProviderId);
		return credential?.type === "oauth" ? credential : void 0;
	}
	async logout() {
		try {
			await this.models.logout(this.definition.nativeProviderId);
			this.selectedIds = void 0;
			await mkdir(dirname(this.cacheFile), {
				recursive: true,
				mode: 448
			});
			await rm(this.cacheFile, { force: true });
		} finally {
			this.onCatalogChange?.();
		}
	}
	async writeCache() {
		const document = {
			version: MODELS_CACHE_VERSION$1,
			selected: this.selectedIds === void 0 ? [] : [...this.selectedIds]
		};
		await mkdir(dirname(this.cacheFile), {
			recursive: true,
			mode: 448
		});
		await writeFileAtomic(this.cacheFile, `${JSON.stringify(document)}\n`, {
			mode: 384,
			dirMode: 448
		});
	}
};
//#endregion
//#region src/proxy.ts
/**
* Scoped egress proxy for coding-subscription OAuth and inference traffic.
* @module dsh-grok-build/proxy
*/
const DEFAULT_PROXIED_HOSTS = [
	"auth.x.ai",
	"cli-chat-proxy.grok.com",
	"auth.openai.com",
	"chatgpt.com",
	"claude.ai",
	"platform.claude.com",
	"api.anthropic.com",
	"accounts.google.com",
	"oauth2.googleapis.com",
	"cloudcode-pa.googleapis.com",
	"www.googleapis.com"
];
const KIMI_PROXIED_HOSTS = ["auth.kimi.com", "api.kimi.com"];
var CodingOAuthDispatcher = class extends Dispatcher {
	proxied;
	fallback;
	hosts;
	constructor(proxied, fallback, hosts) {
		super();
		this.proxied = proxied;
		this.fallback = fallback;
		this.hosts = hosts;
	}
	dispatch(options, handler) {
		const origin = options.origin;
		const host = origin instanceof URL ? origin.hostname : typeof origin === "string" ? new URL(origin).hostname : "";
		if (this.hosts.has(host)) return this.proxied.dispatch(options, handler);
		return this.fallback.dispatch(options, handler);
	}
	async close() {
		await this.proxied.close();
	}
	async destroy() {
		await this.proxied.destroy();
	}
};
let installedProxy;
let installed = false;
function firstEnv(names) {
	for (const name of names) {
		const value = process.env[name];
		if (value !== void 0 && value.length > 0) return value;
	}
}
/** Install one process-wide dispatcher that proxies only the audited host list. */
function ensureCodingOAuthProxy(explicit, options = {}) {
	if (installed) return installedProxy;
	const url = explicit ?? firstEnv([
		"CODING_OAUTH_PROXY",
		"GROK_BUILD_PROXY",
		"HTTPS_PROXY",
		"https_proxy",
		"HTTP_PROXY",
		"http_proxy"
	]);
	if (url === void 0) return void 0;
	const hosts = new Set(DEFAULT_PROXIED_HOSTS);
	if (options.proxyKimi === true) for (const host of KIMI_PROXIED_HOSTS) hosts.add(host);
	const fallback = getGlobalDispatcher();
	setGlobalDispatcher(new CodingOAuthDispatcher(new ProxyAgent(url), fallback, hosts));
	installed = true;
	installedProxy = url;
	return url;
}
function codingOAuthProxyInEffect() {
	return installedProxy;
}
//#endregion
//#region src/redact.ts
/** Remove token-like strings from an external OAuth diagnostic. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/\bsk-ant-oat[A-Za-z0-9_-]*\b/giu, "[redacted token]").replace(/(\bBearer\s+)[^\s"',}]+/giu, "$1[redacted]").replace(/(\b(?:code|user_code|token|id_token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").replace(/(["']?(?:code|user_code|id_token|refresh_token|access_token)["']?\s*:\s*["'])[^"']+/giu, "$1[redacted]").slice(0, 1e3);
}
//#endregion
//#region src/provider.ts
/**
* Grok Build provider: a pi-ai provider pointed at the official Grok CLI
* coding backend (`cli-chat-proxy.grok.com`) carrying the CLI fingerprint
* headers the risk-control middleware requires.
* @module dsh-grok-build/provider
*/
/** Inference backend base URL (Responses API lives under `${baseUrl}/responses`). */
const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Account model catalog endpoint fetched by the official CLI. */
const GROK_BUILD_MODELS_URL = `${GROK_BUILD_BASE_URL}/models-v2`;
/**
* Official Grok CLI version this plugin fingerprints as.
* Track the `@xai-official/grok` npm release stream; make overridable via
* GROK_BUILD_CLIENT_VERSION for urgent drift fixes without a release.
*/
const GROK_CLIENT_VERSION = process.env["GROK_BUILD_CLIENT_VERSION"] ?? "0.1.220";
/**
* Fingerprint headers required by the Grok Build middleware. Missing headers
* are a known 403 trigger (codex-app-transfer field notes, 2026-07).
*/
function grokBuildFingerprintHeaders() {
	return {
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-identifier": "grok-shell",
		"x-grok-client-version": GROK_CLIENT_VERSION,
		"User-Agent": `grok-shell/${GROK_CLIENT_VERSION}`
	};
}
/** Static baseline catalog, used until a live `/models-v2` listing succeeds. */
function grokBuildBaselineModels() {
	return [{
		id: "grok-4.5",
		name: "Grok 4.5",
		api: "openai-responses",
		provider: GROK_BUILD_ROUTE,
		baseUrl: GROK_BUILD_BASE_URL,
		reasoning: true,
		thinkingLevelMap: { off: null },
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		contextWindow: 5e5,
		maxTokens: 128e3
	}, {
		id: "grok-composer-2.5-fast",
		name: "Grok Composer 2.5 Fast",
		api: "openai-responses",
		provider: GROK_BUILD_ROUTE,
		baseUrl: GROK_BUILD_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		contextWindow: 2e5,
		maxTokens: 64e3
	}];
}
/**
* Build the Grok Build pi-ai provider. Auth is apiKey-shaped: the OAuth
* access token is injected as the bearer key by the surrounding adapter
* (`Models.getAuth` on the login provider performs refresh under the store
* lock before the key ever reaches here).
*/
function grokBuildProvider(models) {
	return createProvider({
		id: GROK_BUILD_ROUTE,
		name: "xAI Grok Build",
		baseUrl: GROK_BUILD_BASE_URL,
		headers: grokBuildFingerprintHeaders(),
		auth: { apiKey: {
			name: "Grok Build OAuth access token",
			async resolve({ credential }) {
				const apiKey = credential?.key;
				return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
					auth: { apiKey },
					source: "OAuth"
				};
			}
		} },
		models,
		api: { "openai-responses": openAIResponsesApi() }
	});
}
//#endregion
//#region src/catalog.ts
const BODY_LIMIT_BYTES = 4194304;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Pull model ids from a listing body. The `/v1/models-v2` response shape is
* not a published contract, so accept the common envelopes: a bare array, an
* OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
* ids or objects with an `id` field.
*/
function extractModelIds(body) {
	const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body["data"]) ? body["data"] : isRecord(body) && Array.isArray(body["models"]) ? body["models"] : [];
	const ids = [];
	for (const row of rows) if (typeof row === "string" && row.length > 0) ids.push(row);
	else if (isRecord(row) && typeof row["id"] === "string" && row["id"].length > 0) ids.push(row["id"]);
	return [...new Set(ids)];
}
function titleCaseId(id) {
	return id.split(/[-_]/g).map((part) => part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)).join(" ");
}
function catalogModels(baseline = grokBuildBaselineModels()) {
	return baseline;
}
function templateFor(id, catalog) {
	const exact = catalog.find((model) => model.id === id);
	if (exact !== void 0) return exact;
	const lower = id.toLowerCase();
	const fallback = catalog.find((model) => model.id === "grok-4.5") ?? catalog[0];
	if (fallback === void 0) throw new Error("grok-build: baseline catalog is empty");
	if (lower.includes("composer") || lower.includes("fast")) return catalog.find((model) => model.id === "grok-composer-2.5-fast") ?? fallback;
	return fallback;
}
/** Turn a live id into a pi-ai model, inheriting baseline metadata when possible. */
function materializeLiveModel(id, catalog = catalogModels()) {
	const template = templateFor(id, catalog);
	if (template.id === id) return template;
	return {
		...template,
		id,
		name: titleCaseId(id)
	};
}
/**
* If `liveIds` is missing or empty, serve the baseline catalog.
* Otherwise serve only the live ids, each materialized against the baseline.
*/
function mergeLiveCatalog(catalog, liveIds) {
	if (liveIds === void 0 || liveIds.length === 0) return [...catalog];
	return liveIds.map((id) => materializeLiveModel(id, catalog));
}
/**
* Fetch the account-visible model ids from `/v1/models-v2` with the CLI
* fingerprint headers. Throws a secret-free error on failure.
*/
async function fetchLiveModelIds(accessToken, signal) {
	let response;
	try {
		response = await fetch(GROK_BUILD_MODELS_URL, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
				...grokBuildFingerprintHeaders()
			},
			signal
		});
	} catch (error) {
		if (signal?.aborted) throw new Error("Live model listing was cancelled");
		throw new Error("Grok Build model listing is unreachable (proxy required on some networks)");
	}
	const raw = Buffer.from(await response.arrayBuffer());
	if (raw.byteLength > BODY_LIMIT_BYTES) throw new Error("Grok Build model listing exceeded the 4 MiB read ceiling");
	let body;
	try {
		body = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error(`Grok Build model listing returned invalid JSON (HTTP ${response.status})`);
	}
	if (!response.ok) {
		const code = isRecord(body) && typeof body["error"] === "string" ? body["error"] : void 0;
		throw new Error(`Grok Build model listing failed (HTTP ${response.status})${code === void 0 ? "" : `: ${code}`}`);
	}
	const ids = extractModelIds(body);
	if (ids.length === 0) throw new Error("Grok Build model listing contained no model ids");
	return ids;
}
//#endregion
//#region src/session.ts
/**
* Shared OAuth store + live catalog for the host plugin and CLI.
* @module dsh-grok-build/session
*/
const MODELS_CACHE_VERSION = 2;
function isENOENT(error) {
	return error?.code === "ENOENT";
}
function modelsCachePath(dshHome) {
	return resolve(join(resolveDshHome(dshHome), GROK_BUILD_MODELS_CACHE_FILENAME));
}
function parseIdList(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((id) => typeof id === "string" && id.length > 0))];
}
function parseCache(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const document = value;
	if (document["version"] !== 1 && document["version"] !== MODELS_CACHE_VERSION) return void 0;
	const ids = parseIdList(document["ids"]);
	const selected = parseIdList(document["selected"]);
	if (ids.length === 0 && selected.length === 0) return void 0;
	return {
		ids,
		...selected.length === 0 ? {} : { selected }
	};
}
function asHarnessModels(models) {
	return models.map((model) => model.provider === "grok-build" ? model : {
		...model,
		provider: GROK_BUILD_ROUTE
	});
}
/** One process-local owner of the credential and the account model list. */
var GrokBuildSession = class {
	store;
	models;
	baselineCatalog;
	liveIds;
	selectedIds;
	source = "fallback";
	listingError;
	cacheFile;
	onCatalogChange;
	constructor(store = new GrokBuildCredentialStore(), onCatalogChange) {
		this.store = store;
		this.cacheFile = modelsCachePath();
		this.baselineCatalog = grokBuildBaselineModels();
		this.models = createModels({ credentials: store });
		this.models.setProvider(xaiProvider());
		this.onCatalogChange = onCatalogChange;
	}
	/** Secret-free listing diagnostic from the last refresh. */
	get catalogError() {
		return this.listingError;
	}
	get catalogSource() {
		return this.source;
	}
	availableModels() {
		return mergeLiveCatalog(this.baselineCatalog, this.liveIds);
	}
	selectedModelIds() {
		return this.selectedIds;
	}
	visibleModels() {
		const available = this.availableModels();
		if (this.selectedIds === void 0 || this.selectedIds.length === 0) return available;
		const byId = new Map(available.map((model) => [model.id, model]));
		return this.selectedIds.map((id) => byId.get(id) ?? materializeLiveModel(id, this.baselineCatalog));
	}
	/** Provider whose id matches the harness route so PiAiAdapter can list models. */
	provider() {
		return {
			...grokBuildProvider(this.visibleModels()),
			getModels: () => asHarnessModels(this.visibleModels())
		};
	}
	async loadCachedCatalog() {
		try {
			const cache = parseCache(await readFile(this.cacheFile, "utf8"));
			if (cache === void 0) return;
			if (cache.ids.length > 0) {
				this.liveIds = cache.ids;
				this.source = "cache";
			}
			this.selectedIds = cache.selected;
		} catch (error) {
			if (!isENOENT(error)) throw error;
		}
	}
	async refreshLiveCatalog(signal) {
		const access = (await this.models.getAuth("xai"))?.auth.apiKey;
		if (access === void 0 || access.length === 0) {
			this.listingError = void 0;
			return;
		}
		try {
			const ids = await fetchLiveModelIds(access, signal);
			this.liveIds = ids;
			this.source = "live";
			this.listingError = void 0;
			await this.writeCache();
		} catch (error) {
			this.listingError = error instanceof Error ? error.message : String(error);
			if (this.liveIds === void 0) this.source = "fallback";
		} finally {
			this.onCatalogChange?.();
		}
	}
	async setSelectedModels(ids) {
		const unique = [...new Set(ids.filter((id) => id.length > 0))];
		this.selectedIds = unique.length === 0 ? void 0 : unique;
		await this.writeCache();
		this.onCatalogChange?.();
	}
	async logout() {
		try {
			await this.store.delete("xai");
			this.liveIds = void 0;
			this.selectedIds = void 0;
			this.source = "fallback";
			this.listingError = void 0;
			await mkdir(dirname(this.cacheFile), {
				recursive: true,
				mode: 448
			});
			await rm(this.cacheFile, { force: true });
		} finally {
			this.onCatalogChange?.();
		}
	}
	async writeCache() {
		const document = {
			version: MODELS_CACHE_VERSION,
			ids: this.liveIds === void 0 ? [] : [...this.liveIds],
			fetchedAt: Date.now(),
			...this.selectedIds === void 0 ? {} : { selected: [...this.selectedIds] }
		};
		await mkdir(dirname(this.cacheFile), {
			recursive: true,
			mode: 448
		});
		await writeFileAtomic(this.cacheFile, `${JSON.stringify(document)}\n`, {
			mode: 384,
			dirMode: 448
		});
	}
};
//#endregion
//#region src/bin.ts
/** Standalone credential CLI for the coding-subscription bundle. */
function openBrowser(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") throw new Error(`refusing to open non-HTTPS authorization URL from ${url.host}`);
	const command = process.platform === "win32" ? {
		file: "rundll32.exe",
		args: ["url.dll,FileProtocolHandler", url.href]
	} : process.platform === "darwin" ? {
		file: "open",
		args: [url.href]
	} : {
		file: "xdg-open",
		args: [url.href]
	};
	try {
		const child = spawn(command.file, command.args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true
		});
		child.on("error", () => {});
		child.unref();
	} catch {}
}
function notify(event, useBrowser) {
	switch (event.type) {
		case "auth_url":
			process.stdout.write(`Open this URL to sign in:\n${event.url}\n`);
			if (event.instructions !== void 0) process.stdout.write(`${event.instructions}\n`);
			if (useBrowser) openBrowser(event.url);
			break;
		case "device_code":
			process.stdout.write(`Open this URL to sign in:\n${event.verificationUri}\n`);
			if (event.userCode.length > 0) process.stdout.write(`Enter code: ${event.userCode}\n`);
			if (useBrowser) openBrowser(event.verificationUri);
			break;
		case "info":
		case "progress": process.stdout.write(`${event.message}\n`);
	}
}
function selectLoginOption(prompt, method) {
	if (method !== void 0) {
		const exact = method === "device" ? [
			"device_code",
			"device-code",
			"device"
		] : ["browser", "browser_login"];
		for (const id of exact) if (prompt.options.some((option) => option.id === id)) return id;
		const label = method === "device" ? /device|headless/iu : /browser|pkce/iu;
		const match = prompt.options.find((option) => label.test(option.label));
		if (match !== void 0) return match.id;
	}
	return prompt.options.find((option) => option.id === "oauth" || option.id.includes("oauth"))?.id ?? prompt.options[0]?.id ?? "";
}
async function answerPrompt(prompt, question, method) {
	if (prompt.type === "select") return selectLoginOption(prompt, method);
	const suffix = prompt.placeholder === void 0 ? "" : ` (${prompt.placeholder})`;
	return question(`${prompt.message}${suffix}: `, { ...prompt.signal === void 0 ? {} : { signal: prompt.signal } });
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-grok-build <login|logout|status|import> [provider] [options]",
		"",
		"Providers: grok (default), codex, kimi, claude; status also accepts all.",
		"",
		"  login grok [--pkce|--device-auth]",
		"  login codex [--device-auth|--browser]  (device code is the default)",
		"  login kimi                              (device code)",
		"  login claude [--browser]                (PKCE + redirect paste fallback)",
		"  import [grok]                            import ~/.grok/auth.json only",
		"  logout [provider]",
		"  status [provider|all]",
		"",
		"Network: set CODING_OAUTH_PROXY, GROK_BUILD_PROXY, or HTTPS_PROXY.",
		"Only audited subscription hosts use the proxy; Kimi stays direct by default.",
		""
	].join("\n"));
}
function parseProvider(raw, action) {
	if (raw === void 0 || raw.startsWith("--")) return "grok";
	if (raw === "all" && action === "status") return raw;
	if (raw === "grok" || raw === "codex" || raw === "kimi" || raw === "claude") return raw;
	throw new Error(`unknown provider ${JSON.stringify(raw)}`);
}
function loginMethod(provider, flags) {
	if (provider === "codex") return flags.includes("--browser") ? "browser" : "device";
	if (provider === "kimi") return "device";
	if (provider === "claude") return "browser";
}
function allowedFlags(action, provider) {
	if (action !== "login") return [];
	if (provider === "grok") return ["--pkce", "--device-auth"];
	if (provider === "codex") return ["--device-auth", "--browser"];
	if (provider === "kimi") return ["--device-auth"];
	if (provider === "claude") return ["--browser"];
	return [];
}
async function subscriptionStatus(provider) {
	const definition = oauthProviderDefinition(provider);
	if (definition === void 0) throw new Error(`provider ${provider} is not configured`);
	const session = new OAuthProviderSession(definition);
	await session.loadCachedModels();
	const status = await session.status();
	if (!status.authenticated) {
		process.stdout.write(`${definition.displayName} for dsh: signed out\n`);
		return false;
	}
	const suffix = status.expiresAt === void 0 ? "" : `; access token expires ${new Date(status.expiresAt).toISOString()} (refresh is automatic)`;
	process.stdout.write(`${definition.displayName} for dsh: signed in${suffix}\n`);
	process.stdout.write(`models: ${session.visibleModels().map((model) => model.id).join(", ")}\n`);
	return true;
}
async function grokStatus() {
	const session = new GrokBuildSession();
	await session.loadCachedCatalog();
	const status = await grokBuildAuthStatus(session.store);
	if (!status.authenticated) {
		process.stdout.write("Grok Build for dsh: signed out\n");
		return false;
	}
	await session.refreshLiveCatalog();
	const expires = status.expiresAt;
	const suffix = expires === void 0 || Number.isNaN(expires.valueOf()) ? "" : `; access token expires ${expires.toISOString()} (refresh is automatic)`;
	process.stdout.write(`Grok Build for dsh: signed in${suffix}\n`);
	process.stdout.write(`models (${session.catalogSource}): ${session.visibleModels().map((model) => model.id).join(", ")}\n`);
	if (session.catalogError !== void 0) process.stderr.write(`dsh-grok-build: live models-v2 failed: ${session.catalogError}\n`);
	return true;
}
async function loginSubscription(provider, flags) {
	const definition = oauthProviderDefinition(provider);
	if (definition === void 0) throw new Error(`provider ${provider} is not configured`);
	const method = loginMethod(provider, flags);
	const session = new OAuthProviderSession(definition);
	await session.loadCachedModels();
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout
	});
	try {
		await session.login({
			prompt: (prompt) => answerPrompt(prompt, (text, options) => readline.question(text, options), method),
			notify: (event) => notify(event, true)
		});
	} finally {
		readline.close();
	}
	process.stdout.write(`${definition.displayName} for dsh: signed in; credentials saved to ${session.store.filename}\n`);
	process.stdout.write(`models: ${session.visibleModels().map((model) => model.id).join(", ")}\n`);
}
async function loginGrok(flags) {
	const usePkce = flags.includes("--pkce");
	const session = new GrokBuildSession();
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout
	});
	try {
		if (usePkce) {
			const credential = await loginGrokBuildPkce({
				onAuthorizeUrl: (url) => {
					process.stdout.write(`Open this URL to sign in:\n${url}\n`);
					openBrowser(url);
				},
				awaitCode: (signal) => readline.question("After authorizing, paste the code or full redirect URL: ", { signal })
			});
			if (await session.store.modify("xai", async () => credential) === void 0) throw new Error("credential store refused the login credential");
			await session.refreshLiveCatalog();
		} else await loginGrokBuildSession({
			prompt: (prompt) => answerPrompt(prompt, (text, options) => readline.question(text, options)),
			notify: (event) => notify(event, true)
		}, session);
	} finally {
		readline.close();
	}
	process.stdout.write(`Grok Build for dsh: signed in; credentials saved to ${grokBuildAuthPath()}\n`);
	process.stdout.write(`models (${session.catalogSource}): ${session.visibleModels().map((model) => model.id).join(", ")}\n`);
}
async function run(argv) {
	ensureCodingOAuthProxy();
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const rawAction = argv[0];
	if (rawAction !== "login" && rawAction !== "logout" && rawAction !== "status" && rawAction !== "import") {
		process.stderr.write(`dsh-grok-build: expected login, logout, status, or import; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	try {
		const provider = parseProvider(argv[1], action);
		const flags = argv[1]?.startsWith("--") === true ? argv.slice(1) : argv.slice(2);
		const allowed = allowedFlags(action, provider);
		if (flags.some((flag) => !allowed.includes(flag))) throw new Error(`invalid options for ${action} ${provider}: ${flags.join(" ")}`);
		if (action === "import" && provider !== "grok") throw new Error("import is supported only for Grok Build");
		if (action !== "status" && provider === "all") throw new Error(`${action} does not accept provider all`);
		if (action === "status") {
			if (provider === "all") return (await Promise.all([
				grokStatus(),
				subscriptionStatus("codex"),
				subscriptionStatus("kimi"),
				subscriptionStatus("claude")
			])).some(Boolean) ? 0 : 1;
			return (provider === "grok" ? await grokStatus() : await subscriptionStatus(provider)) ? 0 : 1;
		}
		if (action === "logout") {
			if (provider === "grok") {
				await new GrokBuildSession().logout();
				process.stdout.write(`Grok Build for dsh: signed out; removed ${grokBuildAuthPath()}\n`);
			} else {
				const definition = oauthProviderDefinition(provider);
				if (definition === void 0) throw new Error(`provider ${provider} is not configured`);
				const session = new OAuthProviderSession(definition);
				await session.logout();
				process.stdout.write(`${definition.displayName} for dsh: signed out; removed ${session.store.filename}\n`);
			}
			return 0;
		}
		if (action === "import") {
			const session = new GrokBuildSession();
			await importGrokBuildSession(session);
			process.stdout.write(`Grok Build for dsh: imported ${grokAuthPath()} into ${grokBuildAuthPath()}\n`);
			process.stdout.write("The Grok CLI file was not modified. Later dsh refresh may rotate the token.\n");
			process.stdout.write(`models (${session.catalogSource}): ${session.visibleModels().map((model) => model.id).join(", ")}\n`);
			return 0;
		}
		const proxy = codingOAuthProxyInEffect();
		if (proxy !== void 0) process.stdout.write(`Using scoped coding OAuth proxy ${proxy}\n`);
		if (provider === "all") throw new Error("login does not accept provider all");
		if (provider === "grok") await loginGrok(flags);
		else await loginSubscription(provider, flags);
		return 0;
	} catch (error) {
		process.stderr.write(`dsh-grok-build: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { run };

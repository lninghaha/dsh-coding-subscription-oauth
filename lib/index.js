import z from "@deepseek-ai/schemastery";
import { LlmAdapter, LlmError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
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
//#region src/alias-adapter.ts
/**
* Harness route aliases over a native-id PiAiAdapter.
* @module dsh-grok-build/alias-adapter
*/
function routePiAiReplayState(value, route) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const state = value;
	if (state["kind"] !== "pi-ai" || state["provider"] === route) return value;
	return {
		...state,
		provider: route
	};
}
function normalizeReplayForRoute(message, route) {
	if (message.role !== "assistant" || message.source.kind !== "model") return message;
	if (message.source.provider !== route) {
		if (message.source.replayState === void 0) return message;
		const { replayState: _foreignReplay, ...source } = message.source;
		return {
			...message,
			source
		};
	}
	const replayState = routePiAiReplayState(message.source.replayState, route);
	if (replayState === message.source.replayState) return message;
	return {
		...message,
		source: {
			...message.source,
			replayState
		}
	};
}
/**
* Keeps pi-ai model.provider identities native while exposing collision-free
* Harness route names. Every public operation translates exactly once.
*/
var AliasLlmAdapter = class extends LlmAdapter {
	inner;
	aliases;
	policies;
	constructor(inner, aliases, policies = /* @__PURE__ */ new Map()) {
		super();
		this.inner = inner;
		this.aliases = aliases;
		this.policies = policies;
	}
	nativeProvider(route) {
		const provider = this.aliases.get(route);
		if (provider === void 0) throw new LlmError(`OAuth adapter does not own provider "${route}"`, "NO_ADAPTER");
		return provider;
	}
	providerInfo(provider) {
		const native = this.nativeProvider(provider);
		const info = this.inner.providerInfo(native);
		const displayName = this.policies.get(provider)?.displayName;
		return {
			...info,
			id: provider,
			...displayName === void 0 ? {} : { name: displayName }
		};
	}
	providerRetryPolicy(provider) {
		return this.inner.providerRetryPolicy(this.nativeProvider(provider));
	}
	async listModels(provider) {
		const native = this.nativeProvider(provider);
		const isAuthenticated = this.policies.get(provider)?.isAuthenticated;
		if (isAuthenticated !== void 0) try {
			if (!await isAuthenticated()) return [];
		} catch {
			return [];
		}
		return (await this.inner.listModels(native)).map((model) => ({
			...model,
			provider
		}));
	}
	async resolveModel(provider, model, signal) {
		const native = this.nativeProvider(provider);
		return {
			...await this.inner.resolveModel(native, model, signal),
			provider
		};
	}
	async *stream(options) {
		const route = options.provider;
		const native = this.nativeProvider(route);
		const messages = options.messages.map((message) => normalizeReplayForRoute(message, route));
		for await (const chunk of this.inner.stream({
			...options,
			provider: native,
			messages
		})) if (chunk.type === "finish" && chunk.replayState !== void 0) yield {
			...chunk,
			replayState: routePiAiReplayState(chunk.replayState, route)
		};
		else yield chunk;
	}
};
//#endregion
//#region src/ids.ts
/** pi-ai provider ids used by login, refresh, and credential storage. */
const XAI_PI_PROVIDER = "xai";
const CODEX_PI_PROVIDER = "openai-codex";
const KIMI_PI_PROVIDER = "kimi-coding";
const CLAUDE_PI_PROVIDER = "anthropic";
/** Harness LLM routes. OAuth aliases avoid the user's API-key route ids. */
const GROK_BUILD_ROUTE = "grok-build";
const CODEX_OAUTH_ROUTE = "codex-oauth";
const KIMI_CODE_OAUTH_ROUTE = "kimi-code-oauth";
const CLAUDE_CODE_OAUTH_ROUTE = "claude-code-oauth";
const ANTIGRAVITY_ROUTE = "agy";
const CODING_OAUTH_ROUTES = [
	GROK_BUILD_ROUTE,
	CODEX_OAUTH_ROUTE,
	KIMI_CODE_OAUTH_ROUTE,
	CLAUDE_CODE_OAUTH_ROUTE
];
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
/** Fallback model when no live Grok catalog listing is available. */
const DEFAULT_GROK_BUILD_MODEL = "grok-4.5";
/** Provider idle ceiling used by every composite route. */
const GROK_BUILD_STREAM_IDLE_TIMEOUT_MS = 3e5;
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
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Pull model ids from a listing body. The `/v1/models-v2` response shape is
* not a published contract, so accept the common envelopes: a bare array, an
* OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
* ids or objects with an `id` field.
*/
function extractModelIds(body) {
	const rows = Array.isArray(body) ? body : isRecord$1(body) && Array.isArray(body["data"]) ? body["data"] : isRecord$1(body) && Array.isArray(body["models"]) ? body["models"] : [];
	const ids = [];
	for (const row of rows) if (typeof row === "string" && row.length > 0) ids.push(row);
	else if (isRecord$1(row) && typeof row["id"] === "string" && row["id"].length > 0) ids.push(row["id"]);
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
function preferredGrokBuildModelFrom(models) {
	if (new Set(models.map((model) => model.id)).has("grok-4.5")) return DEFAULT_GROK_BUILD_MODEL;
	return models[0]?.id ?? "grok-4.5";
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
		const code = isRecord$1(body) && typeof body["error"] === "string" ? body["error"] : void 0;
		throw new Error(`Grok Build model listing failed (HTTP ${response.status})${code === void 0 ? "" : `: ${code}`}`);
	}
	const ids = extractModelIds(body);
	if (ids.length === 0) throw new Error("Grok Build model listing contained no model ids");
	return ids;
}
//#endregion
//#region src/adapter.ts
/** Prefer grok-4.5 when the current (live or baseline) list has it. */
function preferredGrokBuildModel(models = grokBuildBaselineModels()) {
	return preferredGrokBuildModelFrom(models.length === 0 ? [{ id: DEFAULT_GROK_BUILD_MODEL }] : models);
}
function profile(provider, displayName, piProvider, headers) {
	return {
		provider,
		displayName,
		streamIdleTimeoutMs: GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-grok-build retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		...headers === void 0 ? {} : { headers },
		piProvider
	};
}
function missingCredential(name) {
	throw new LlmError(`${name} is not signed in. Open Settings → Coding OAuth and sign in with your subscription.`, "MISSING_CREDENTIAL");
}
/** Existing Grok-only constructor retained for public API compatibility. */
function createGrokBuildAdapter(session, resolveAttachments) {
	return new PiAiAdapter({
		profiles: () => /* @__PURE__ */ new Map([[GROK_BUILD_ROUTE, profile(GROK_BUILD_ROUTE, "xAI Grok Build", session.provider(), grokBuildFingerprintHeaders())]]),
		resolveApiKey: async () => {
			const apiKey = (await session.models.getAuth("xai"))?.auth.apiKey;
			if (apiKey === void 0 || apiKey.length === 0) return missingCredential("Grok Build");
			return apiKey;
		},
		resolveAttachments
	});
}
/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
function createCodingOAuthAdapter(grok, subscriptions, resolveAttachments) {
	const byNativeId = new Map(subscriptions.map((session) => [session.definition.nativeProviderId, session]));
	const aliases = /* @__PURE__ */ new Map([
		[GROK_BUILD_ROUTE, GROK_BUILD_ROUTE],
		[CODEX_OAUTH_ROUTE, CODEX_PI_PROVIDER],
		[KIMI_CODE_OAUTH_ROUTE, KIMI_PI_PROVIDER],
		[CLAUDE_CODE_OAUTH_ROUTE, CLAUDE_PI_PROVIDER]
	]);
	const policies = /* @__PURE__ */ new Map([[GROK_BUILD_ROUTE, {
		displayName: "xAI Grok Build (OAuth)",
		isAuthenticated: async () => (await grok.store.read("xai"))?.type === "oauth"
	}]]);
	for (const session of subscriptions) policies.set(session.definition.route, {
		displayName: `${session.definition.displayName.replace(/\s*\([^)]*\)$/u, "")} (OAuth)`,
		isAuthenticated: async () => (await session.status()).authenticated
	});
	return new AliasLlmAdapter(new PiAiAdapter({
		profiles: () => {
			const profiles = /* @__PURE__ */ new Map();
			profiles.set(GROK_BUILD_ROUTE, profile(GROK_BUILD_ROUTE, "xAI Grok Build", grok.provider(), grokBuildFingerprintHeaders()));
			for (const session of subscriptions) profiles.set(session.definition.nativeProviderId, profile(session.definition.nativeProviderId, session.definition.displayName, session.provider()));
			return profiles;
		},
		resolveApiKey: async (provider) => {
			if (provider === "grok-build") {
				const apiKey = (await grok.models.getAuth("xai"))?.auth.apiKey;
				if (apiKey === void 0 || apiKey.length === 0) return missingCredential("Grok Build");
				return apiKey;
			}
			const session = byNativeId.get(provider);
			if (session === void 0) throw new LlmError(`Unknown OAuth provider "${provider}"`, "NO_ADAPTER");
			const token = await session.resolveAccessToken();
			if (token === void 0 || token.length === 0) return missingCredential(session.definition.displayName);
			return token;
		},
		resolveAttachments
	}), aliases, policies);
}
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
function isRecord(value) {
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
	if (!isRecord(value)) return [];
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
/** Whether ~/.grok/auth.json exists and looks importable. Never returns secrets. */
async function probeGrokAuth(filename = grokAuthPath()) {
	try {
		await stat(filename);
		parseGrokAuthDocument(await readFile(filename, "utf8"), filename);
		return {
			available: true,
			path: filename
		};
	} catch (error) {
		if (isENOENT$3(error)) return {
			available: false,
			path: filename
		};
		return {
			available: false,
			path: filename
		};
	}
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
/** Remove the stored Grok Build credential. */
async function logoutGrokBuild(store = new GrokBuildCredentialStore()) {
	await store.delete("xai");
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
//#endregion
//#region src/oauth.ts
/**
* Grok Build OAuth authorization-code + PKCE flow (primary login path).
*
* Mirrors the official Grok CLI: OIDC discovery, S256 PKCE, dual-channel code
* capture (loopback listener + manual paste), form POST token exchange.
* The device-code flow remains the fallback (see auth.ts / bin.ts).
* @module dsh-grok-build/oauth
*/
/** OIDC issuer for both Grok CLI and Grok Build. */
const GROK_BUILD_OAUTH_ISSUER = "https://auth.x.ai";
/**
* Public client id known to work for the device flow; reused as the default
* for the authorization-code flow until the official CLI's own id is
* confirmed (T2.1). Override with GROK_OAUTH2_CLIENT_ID.
*/
const GROK_BUILD_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/** Scopes the official CLI requests (grok-cli:access = CLI inference pass). */
const GROK_BUILD_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
/** Default loopback port observed for the official CLI (codex-app-transfer). */
const GROK_BUILD_OAUTH_DEFAULT_PORT = 56121;
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
/** Exchange a refresh token for a fresh credential (rotation-tolerant). */
async function refreshGrokBuildToken(refreshToken, overrides = {}, signal) {
	const params = resolveOAuthParams(overrides);
	return postTokenForm((await discoverOAuthEndpoints(params.issuer, signal)).token_endpoint, {
		grant_type: "refresh_token",
		client_id: params.clientId,
		refresh_token: refreshToken
	}, signal, refreshToken);
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
//#region src/redact.ts
/** Remove token-like strings from an external OAuth diagnostic. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/\bsk-ant-oat[A-Za-z0-9_-]*\b/giu, "[redacted token]").replace(/(\bBearer\s+)[^\s"',}]+/giu, "$1[redacted]").replace(/(\b(?:code|user_code|token|id_token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").replace(/(["']?(?:code|user_code|id_token|refresh_token|access_token)["']?\s*:\s*["'])[^"']+/giu, "$1[redacted]").slice(0, 1e3);
}
//#endregion
//#region src/auth-routes.ts
const GROK_BUILD_AUTH_STATUS_PATH = "/plugins/dsh-grok-build/auth/status";
const GROK_BUILD_AUTH_LOGIN_PATH = "/plugins/dsh-grok-build/auth/login";
const GROK_BUILD_AUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/auth/login/code";
const GROK_BUILD_AUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/auth/login/cancel";
const GROK_BUILD_AUTH_IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
const GROK_BUILD_AUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/auth/logout";
const GROK_BUILD_AUTH_MODELS_PATH = "/plugins/dsh-grok-build/auth/models";
const CODING_OAUTH_STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
const CODING_OAUTH_LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
const CODING_OAUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
const CODING_OAUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
const CODING_OAUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
const CODING_OAUTH_MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
function waitForPromptAbort(prompt) {
	const signal = prompt.signal;
	if (signal === void 0) return new Promise(() => {});
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => {
			reject(signal.reason);
		}, { once: true });
	});
}
async function grokImportAvailable() {
	return (await probeGrokAuth()).available;
}
/**
* One lifecycle owner for the pending login (PKCE or device), the published
* challenge, the pasted-code channel, and the public status.
*/
var GrokBuildWebAuth = class {
	session;
	state = {
		status: "signed-out",
		grokImportAvailable: false
	};
	operation;
	cancellation;
	method = "pkce";
	challenge;
	challengeWaiters = [];
	codeResolver;
	constructor(session) {
		this.session = session;
	}
	async status() {
		if (this.operation !== void 0) return this.state;
		if (this.state.status === "error") return {
			...this.state,
			grokImportAvailable: await grokImportAvailable()
		};
		return this.readStoredStatus();
	}
	/** Start (or join) a login. A different method aborts and restarts the flow. */
	async signIn(method) {
		if (this.operation !== void 0 && this.method !== method) await this.cancel();
		if (this.operation === void 0) this.start(method);
		if (this.challenge !== void 0) return this.challenge;
		return new Promise((resolve, reject) => {
			this.challengeWaiters.push({
				resolve,
				reject
			});
		});
	}
	/** Hand a pasted authorization code (or redirect URL) to a pending PKCE login. */
	async submitCode(code) {
		const resolver = this.codeResolver;
		if (resolver === void 0) throw new Error("grok-build: no authorization-code login is waiting for a code");
		this.codeResolver = void 0;
		resolver(code);
	}
	/** Abort a pending login without touching any stored credential. */
	async cancel() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		this.challenge = void 0;
		this.state = await this.readStoredStatus();
	}
	async importGrok() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		await importGrokBuildSession(this.session);
		this.challenge = void 0;
		this.state = await this.readStoredStatus();
	}
	async setModels(ids) {
		await this.session.setSelectedModels(ids);
		this.state = await this.readStoredStatus();
	}
	async signOut() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		await this.session.logout();
		this.state = {
			status: "signed-out",
			grokImportAvailable: await grokImportAvailable()
		};
		this.challenge = void 0;
	}
	async dispose() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("grok-build: plugin disposed"));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
	}
	start(method) {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.method = method;
		this.challenge = void 0;
		this.state = {
			status: "signing-in",
			method,
			grokImportAvailable: false
		};
		const run = method === "pkce" ? this.runPkce(cancellation) : this.runDevice(cancellation);
		this.operation = run.then(async () => {
			this.state = await this.readStoredStatus();
		}, (error) => {
			this.rejectChallenge(error);
			this.state = {
				status: "error",
				message: safeMessage(error),
				grokImportAvailable: false
			};
		}).finally(() => {
			this.operation = void 0;
			this.cancellation = void 0;
			this.codeResolver = void 0;
		});
	}
	async runPkce(cancellation) {
		const credential = await loginGrokBuildPkce({
			signal: cancellation.signal,
			onAuthorizeUrl: (url) => this.acceptChallenge({
				method: "pkce",
				url
			}),
			awaitCode: (signal) => new Promise((resolve, reject) => {
				this.codeResolver = resolve;
				const onAbort = () => {
					this.codeResolver = void 0;
					reject(/* @__PURE__ */ new Error("grok-build: sign-in cancelled"));
				};
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
			})
		});
		const written = await this.session.store.modify("xai", async () => credential);
		if (written === void 0 || written.type !== "oauth") throw new Error("grok-build: failed to persist the login credential");
		await this.session.refreshLiveCatalog();
	}
	async runDevice(cancellation) {
		await loginGrokBuildSession({
			signal: cancellation.signal,
			prompt: (prompt) => prompt.type === "select" ? Promise.resolve(prompt.options.some((option) => option.id === "oauth") ? "oauth" : prompt.options[0]?.id ?? "oauth") : waitForPromptAbort(prompt),
			notify: (event) => {
				this.onEvent(event);
			}
		}, this.session);
	}
	onEvent(event) {
		if (event.type === "device_code") {
			this.acceptChallenge({
				method: "device",
				url: event.verificationUri,
				...event.userCode.length > 0 ? { userCode: event.userCode } : {}
			});
			return;
		}
		if (event.type === "auth_url") this.acceptChallenge({
			method: this.method,
			url: event.url
		});
	}
	acceptChallenge(challenge) {
		try {
			if (new URL(challenge.url).protocol !== "https:") {
				const error = /* @__PURE__ */ new Error("xAI returned an unsafe authorization URL");
				this.cancellation?.abort(error);
				this.rejectChallenge(error);
				return;
			}
		} catch {
			const error = /* @__PURE__ */ new Error("xAI returned an invalid authorization URL");
			this.cancellation?.abort(error);
			this.rejectChallenge(error);
			return;
		}
		this.challenge = challenge;
		this.state = {
			status: "signing-in",
			method: challenge.method,
			url: challenge.url,
			grokImportAvailable: false,
			...challenge.userCode === void 0 ? {} : { userCode: challenge.userCode }
		};
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}
	async readStoredStatus() {
		const [stored, grok] = await Promise.all([grokBuildAuthStatus(this.session.store), grokImportAvailable()]);
		if (!stored.authenticated) return {
			status: "signed-out",
			grokImportAvailable: grok
		};
		const available = this.session.availableModels().map((model) => model.id);
		const selected = this.session.selectedModelIds();
		return {
			status: "signed-in",
			models: this.session.visibleModels().map((model) => model.id),
			available,
			selected: selected ?? available,
			catalogSource: this.session.catalogSource,
			grokImportAvailable: grok,
			...this.session.catalogError === void 0 ? {} : { catalogError: this.session.catalogError }
		};
	}
	rejectChallenge(error) {
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
};
function optionForLoginMethod(prompt, method) {
	const exactIds = method === "device" ? [
		"device_code",
		"device-code",
		"device"
	] : [
		"browser",
		"browser_login",
		"browser-login"
	];
	for (const id of exactIds) if (prompt.options.some((option) => option.id === id)) return id;
	const label = method === "device" ? /device|headless/iu : /browser|pkce/iu;
	return prompt.options.find((option) => label.test(option.label))?.id ?? prompt.options[0]?.id ?? "";
}
/** Web lifecycle for one pi-ai subscription OAuth provider. */
var SubscriptionWebAuth = class {
	session;
	challengeTimeoutMs;
	state;
	operation;
	cancellation;
	method;
	challenge;
	challengeWaiters = [];
	codeResolver;
	constructor(session, challengeTimeoutMs = 6e4) {
		this.session = session;
		this.challengeTimeoutMs = challengeTimeoutMs;
		this.method = session.definition.recommendedLoginMethod;
	}
	async status() {
		if (this.operation !== void 0 && this.state !== void 0) return this.state;
		return this.readStoredStatus();
	}
	async signIn(method) {
		if (!this.session.definition.loginMethods.includes(method)) throw new Error(`${this.session.definition.route}: login method "${method}" is not supported`);
		if (this.operation !== void 0 && this.method !== method) await this.cancel();
		if (this.operation === void 0) this.start(method);
		if (this.challenge !== void 0) return this.challenge;
		return new Promise((resolve, reject) => {
			let timer;
			const waiter = {
				resolve: (challenge) => {
					if (timer !== void 0) clearTimeout(timer);
					resolve(challenge);
				},
				reject: (error) => {
					if (timer !== void 0) clearTimeout(timer);
					reject(error);
				}
			};
			this.challengeWaiters.push(waiter);
			timer = setTimeout(() => {
				const index = this.challengeWaiters.indexOf(waiter);
				if (index >= 0) this.challengeWaiters.splice(index, 1);
				const failure = /* @__PURE__ */ new Error(`${this.session.definition.route}: timed out waiting for an OAuth challenge`);
				this.cancellation?.abort(failure);
				reject(failure);
			}, this.challengeTimeoutMs);
		});
	}
	async submitCode(code) {
		const resolver = this.codeResolver;
		if (resolver === void 0) throw new Error(`${this.session.definition.route}: no authorization-code login is waiting for a code`);
		this.codeResolver = void 0;
		resolver(code);
	}
	async cancel() {
		this.cancellation?.abort(/* @__PURE__ */ new Error(`${this.session.definition.route}: sign-in cancelled`));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		this.challenge = void 0;
		this.state = await this.readStoredStatus();
	}
	async setModels(ids) {
		await this.session.setSelectedModels(ids);
		this.state = await this.readStoredStatus();
	}
	async signOut() {
		this.cancellation?.abort(/* @__PURE__ */ new Error(`${this.session.definition.route}: sign-in cancelled`));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		await this.session.logout();
		this.challenge = void 0;
		this.state = await this.readStoredStatus();
	}
	async dispose() {
		this.cancellation?.abort(/* @__PURE__ */ new Error(`${this.session.definition.route}: plugin disposed`));
		await this.operation?.catch(() => void 0);
		this.codeResolver = void 0;
		this.rejectChallenge(/* @__PURE__ */ new Error(`${this.session.definition.route}: plugin disposed`));
	}
	baseStatus() {
		const available = this.session.availableModels().map((model) => model.id);
		const selected = this.session.selectedModelIds() ?? available;
		return {
			provider: this.session.definition.slug,
			route: this.session.definition.route,
			displayName: this.session.definition.displayName,
			loginMethods: this.session.definition.loginMethods,
			recommendedLoginMethod: this.session.definition.recommendedLoginMethod,
			models: this.session.visibleModels().map((model) => model.id),
			available,
			selected
		};
	}
	async readStoredStatus() {
		const base = this.baseStatus();
		try {
			const stored = await this.session.status();
			return stored.authenticated ? {
				...base,
				status: "signed-in",
				...stored.expiresAt === void 0 ? {} : { expiresAt: stored.expiresAt }
			} : {
				...base,
				status: "signed-out"
			};
		} catch (error) {
			return {
				...base,
				status: "error",
				message: safeMessage(error)
			};
		}
	}
	start(method) {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.method = method;
		this.challenge = void 0;
		this.state = {
			...this.baseStatus(),
			status: "signing-in",
			method
		};
		this.operation = this.run(cancellation).then(async () => {
			if (this.challenge === void 0) this.rejectChallenge(/* @__PURE__ */ new Error(`${this.session.definition.route}: login completed without a challenge`));
			this.state = await this.readStoredStatus();
		}, (error) => {
			this.rejectChallenge(error);
			this.state = {
				...this.baseStatus(),
				status: "error",
				message: safeMessage(error)
			};
		}).finally(() => {
			this.operation = void 0;
			this.cancellation = void 0;
			this.codeResolver = void 0;
		});
	}
	async run(cancellation) {
		await this.session.login({
			signal: cancellation.signal,
			prompt: (prompt) => {
				if (prompt.type === "select") return Promise.resolve(optionForLoginMethod(prompt, this.method));
				if (prompt.type === "manual_code") return this.awaitCode(prompt, cancellation.signal);
				return Promise.reject(/* @__PURE__ */ new Error(`${this.session.definition.route}: unsupported OAuth prompt ${prompt.type}`));
			},
			notify: (event) => {
				this.onEvent(event);
			}
		});
	}
	awaitCode(prompt, cancellation) {
		const signal = prompt.signal === void 0 ? cancellation : AbortSignal.any([prompt.signal, cancellation]);
		return new Promise((resolve, reject) => {
			const resolver = (code) => {
				signal.removeEventListener("abort", onAbort);
				resolve(code);
			};
			const onAbort = () => {
				if (this.codeResolver === resolver) this.codeResolver = void 0;
				reject(signal.reason);
			};
			this.codeResolver = resolver;
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}
	onEvent(event) {
		if (event.type === "device_code") {
			this.acceptChallenge({
				method: "device",
				url: event.verificationUri,
				...event.userCode.length > 0 ? { userCode: event.userCode } : {}
			});
			return;
		}
		if (event.type === "auth_url") this.acceptChallenge({
			method: this.method,
			url: event.url
		});
	}
	acceptChallenge(challenge) {
		try {
			if (new URL(challenge.url).protocol !== "https:") throw new Error("authorization URL must use HTTPS");
		} catch (error) {
			const failure = new Error(`${this.session.definition.route}: invalid authorization URL`, { cause: error });
			this.cancellation?.abort(failure);
			this.rejectChallenge(failure);
			return;
		}
		this.challenge = challenge;
		this.state = {
			...this.baseStatus(),
			status: "signing-in",
			method: challenge.method,
			url: challenge.url,
			...challenge.userCode === void 0 ? {} : { userCode: challenge.userCode }
		};
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}
	rejectChallenge(error) {
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
};
function trustedRequest(req) {
	const remote = req.socket.remoteAddress;
	if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = req.headers.host;
	if (host === void 0) return false;
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === new URL(`http://${host}`).host;
	} catch {
		return false;
	}
}
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text.length === 0) return {};
	return JSON.parse(text);
}
function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(value));
}
function readLoginMethod(body) {
	if (typeof body === "object" && body !== null && "method" in body && body.method === "device") return "device";
	return "pkce";
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
function registerGrokBuildAuthRoutes(ctx, session, existingAuth) {
	const auth = existingAuth ?? new GrokBuildWebAuth(session);
	const ownsAuth = existingAuth === void 0;
	ctx.effect(() => {
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					json(res, 200, await auth.status());
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						json(res, 200, await auth.signIn(readLoginMethod(await readJson(req))));
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_CODE_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJson(req);
						const code = typeof body === "object" && body !== null && "code" in body ? body.code : void 0;
						if (typeof code !== "string" || code.trim().length === 0) return json(res, 400, { error: "code must be a non-empty string" });
						await auth.submitCode(code);
						json(res, 200, { ok: true });
					} catch (error) {
						json(res, 409, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					await auth.cancel();
					json(res, 200, await auth.status());
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_IMPORT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						await auth.importGrok();
						json(res, 200, await auth.status());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_MODELS_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJson(req);
						const selected = typeof body === "object" && body !== null && "selected" in body ? body.selected : void 0;
						if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")) return json(res, 400, { error: "selected must be an array of model ids" });
						await auth.setModels(selected);
						json(res, 200, await auth.status());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					await auth.signOut();
					json(res, 200, { ok: true });
				}
			})
		];
		return async () => {
			for (const dispose of routes) dispose();
			if (ownsAuth) await auth.dispose();
		};
	}, "dsh-grok-build: Web OAuth routes");
}
function recordBody(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("request body must be an object");
	return body;
}
function providerSlug(body) {
	const provider = recordBody(body)["provider"];
	if (provider === "grok" || provider === "codex" || provider === "kimi" || provider === "claude") return provider;
	throw new Error("provider must be one of grok, codex, kimi, or claude");
}
/** Register the unified Coding OAuth API plus the compatibility Grok routes. */
function registerCodingOAuthRoutes(ctx, grokSession, subscriptionSessions) {
	const grok = new GrokBuildWebAuth(grokSession);
	const subscriptions = new Map(subscriptionSessions.map((session) => [session.definition.slug, new SubscriptionWebAuth(session)]));
	const subscription = (slug) => {
		const auth = subscriptions.get(slug);
		if (auth === void 0) throw new Error(`OAuth provider "${slug}" is not configured`);
		return auth;
	};
	registerGrokBuildAuthRoutes(ctx, grokSession, grok);
	const allStatus = async () => {
		const [grokStatus, codex, kimi, claude] = await Promise.all([
			grok.status().catch(async (error) => ({
				status: "error",
				message: safeMessage(error),
				grokImportAvailable: await grokImportAvailable().catch(() => false)
			})),
			subscription("codex").status(),
			subscription("kimi").status(),
			subscription("claude").status()
		]);
		let antigravityInstalled = false;
		try {
			antigravityInstalled = ctx.llm.listProviders().some((provider) => provider.id === "agy");
		} catch {}
		return {
			providers: {
				grok: grokStatus,
				codex,
				kimi,
				claude
			},
			antigravity: {
				installed: antigravityInstalled,
				route: "agy",
				management: "cli"
			}
		};
	};
	ctx.effect(() => {
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						json(res, 200, await allStatus());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJson(req);
						const slug = providerSlug(body);
						const value = recordBody(body);
						if (slug === "grok") {
							const method = value["method"] === "device" ? "device" : "pkce";
							return json(res, 200, await grok.signIn(method));
						}
						const auth = subscription(slug);
						const requested = value["method"];
						const method = requested === "browser" || requested === "device" ? requested : auth.session.definition.recommendedLoginMethod;
						json(res, 200, await auth.signIn(method));
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_CODE_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJson(req);
						const slug = providerSlug(body);
						const code = recordBody(body)["code"];
						if (typeof code !== "string" || code.trim().length === 0) return json(res, 400, { error: "code must be a non-empty string" });
						if (slug === "grok") await grok.submitCode(code);
						else await subscription(slug).submitCode(code);
						json(res, 200, { ok: true });
					} catch (error) {
						json(res, 409, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_CANCEL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const slug = providerSlug(await readJson(req));
						if (slug === "grok") await grok.cancel();
						else await subscription(slug).cancel();
						json(res, 200, await allStatus());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_MODELS_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJson(req);
						const slug = providerSlug(body);
						const selected = recordBody(body)["selected"];
						if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")) return json(res, 400, { error: "selected must be an array of model ids" });
						if (slug === "grok") await grok.setModels(selected);
						else await subscription(slug).setModels(selected);
						json(res, 200, await allStatus());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const slug = providerSlug(await readJson(req));
						if (slug === "grok") await grok.signOut();
						else await subscription(slug).signOut();
						json(res, 200, await allStatus());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			})
		];
		return async () => {
			for (const dispose of routes) dispose();
			await Promise.all([grok.dispose(), ...[...subscriptions.values()].map((auth) => auth.dispose())]);
		};
	}, "dsh-grok-build: Coding OAuth routes");
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
const CODEX_OAUTH_PROVIDER = {
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
};
const KIMI_CODE_OAUTH_PROVIDER = {
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
};
const CLAUDE_CODE_OAUTH_PROVIDER = {
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
};
const OAUTH_PROVIDER_DEFINITIONS = [
	CODEX_OAUTH_PROVIDER,
	KIMI_CODE_OAUTH_PROVIDER,
	CLAUDE_CODE_OAUTH_PROVIDER
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
/** Backward-compatible name retained for existing callers. */
function ensureGrokBuildProxy(explicit) {
	return ensureCodingOAuthProxy(explicit);
}
function codingOAuthProxyInEffect() {
	return installedProxy;
}
/** Backward-compatible status accessor. */
function grokBuildProxyInEffect() {
	return codingOAuthProxyInEffect();
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
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-grok-build-oauth";
/** LLM registry required before the subscription route can register. */
const inject = ["llm"];
const Config = z.object({
	proxy: z.string(),
	proxyKimi: z.boolean().default(false)
});
/**
* Register the `grok-build` LLM route with a provider-native OAuth store.
* @param ctx - plugin context carrying the LLM registry plus optional web server.
*/
function apply(ctx, config) {
	ensureCodingOAuthProxy(config.proxy, { proxyKimi: config.proxyKimi });
	const logger = ctx.logger(name);
	const notifyCatalogChange = () => {
		try {
			ctx.emit("llm/adapters-updated");
		} catch (error) {
			logger.warn("an llm/adapters-updated listener failed");
			logger.warn(error);
		}
	};
	const grok = new GrokBuildSession(new GrokBuildCredentialStore(), notifyCatalogChange);
	const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map((definition) => new OAuthProviderSession(definition, notifyCatalogChange));
	Promise.all([grok.loadCachedCatalog(), ...subscriptions.map((session) => session.loadCachedModels())]).then(() => grok.refreshLiveCatalog());
	ctx.llm.registerAdapter([...CODING_OAUTH_ROUTES], createCodingOAuthAdapter(grok, subscriptions, () => ctx.get("attachments")));
	ctx.inject(["webServer"], (webCtx) => registerCodingOAuthRoutes(webCtx, grok, subscriptions));
}
//#endregion
export { ANTIGRAVITY_ROUTE, AliasLlmAdapter, CLAUDE_CODE_OAUTH_AUTH_FILENAME, CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME, CLAUDE_CODE_OAUTH_PROVIDER, CLAUDE_CODE_OAUTH_ROUTE, CLAUDE_PI_PROVIDER, CODEX_OAUTH_AUTH_FILENAME, CODEX_OAUTH_MODELS_CACHE_FILENAME, CODEX_OAUTH_PROVIDER, CODEX_OAUTH_ROUTE, CODEX_PI_PROVIDER, CODING_OAUTH_LOGIN_CANCEL_PATH, CODING_OAUTH_LOGIN_CODE_PATH, CODING_OAUTH_LOGIN_PATH, CODING_OAUTH_LOGOUT_PATH, CODING_OAUTH_MODELS_PATH, CODING_OAUTH_ROUTES, CODING_OAUTH_STATUS_PATH, Config, DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_AUTH_FILENAME, GROK_BUILD_AUTH_IMPORT_PATH, GROK_BUILD_AUTH_LOGIN_CANCEL_PATH, GROK_BUILD_AUTH_LOGIN_CODE_PATH, GROK_BUILD_AUTH_LOGIN_PATH, GROK_BUILD_AUTH_LOGOUT_PATH, GROK_BUILD_AUTH_MODELS_PATH, GROK_BUILD_AUTH_STATUS_PATH, GROK_BUILD_BASE_URL, GROK_BUILD_MODELS_CACHE_FILENAME, GROK_BUILD_MODELS_URL, GROK_BUILD_OAUTH_CLIENT_ID, GROK_BUILD_OAUTH_DEFAULT_PORT, GROK_BUILD_OAUTH_ISSUER, GROK_BUILD_OAUTH_SCOPE, GROK_BUILD_ROUTE, GROK_BUILD_STREAM_IDLE_TIMEOUT_MS, GROK_CLIENT_VERSION, GrokBuildCredentialStore, GrokBuildOAuthError, GrokBuildSession, GrokBuildWebAuth, KIMI_CODE_OAUTH_AUTH_FILENAME, KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME, KIMI_CODE_OAUTH_PROVIDER, KIMI_CODE_OAUTH_ROUTE, KIMI_PI_PROVIDER, OAUTH_PROVIDER_DEFINITIONS, OAuthCredentialFileStore, OAuthProviderSession, SubscriptionWebAuth, XAI_PI_PROVIDER, apply, buildAuthorizeUrl, codingOAuthProxyInEffect, createCodingOAuthAdapter, createGrokBuildAdapter, discoverOAuthEndpoints, ensureCodingOAuthProxy, ensureGrokBuildProxy, extractCode, extractModelIds, fetchLiveModelIds, generatePkce, grokAuthPath, grokBuildAuthPath, grokBuildAuthStatus, grokBuildBaselineModels, grokBuildFingerprintHeaders, grokBuildProvider, grokBuildProxyInEffect, importGrokAuth, importGrokBuildFromGrok, importGrokBuildSession, inject, loginGrokBuild, loginGrokBuildPkce, loginGrokBuildSession, logoutGrokBuild, materializeLiveModel, mergeLiveCatalog, name, oauthCredentialPath, oauthModelsCachePath, oauthProviderDefinition, parseGrokAuthDocument, preferredGrokBuildModel, preferredGrokBuildModelFrom, probeGrokAuth, refreshGrokBuildToken, registerCodingOAuthRoutes, registerGrokBuildAuthRoutes, resolveOAuthParams, safeMessage };

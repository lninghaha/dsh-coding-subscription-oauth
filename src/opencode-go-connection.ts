import type { IncomingMessage, ServerResponse } from "node:http";
import { type CredentialProvider, credentialRef } from "@deepseek-ai/dsh-credentials";
import { readJsonRequest } from "./http-json.ts";
import type { OpenCodeGoStatus } from "./opencode-go-header.ts";
import { type GoApi, goBaseURL, isGoApi, protocolMismatch } from "./opencode-go-protocol.ts";
import { safeMessage } from "./redact.ts";
import type { OwnerRequestPolicy } from "./web-origin.ts";
import { type PluginWebRouteRegistry, registerWebRouteSetupAtomically } from "./web-routes.ts";

export const OPENCODE_GO_CONNECTION_PATH = "/plugins/dsh-grok-build/opencode-go";
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_API = "openai-completions";
const KNOWN_REFS = ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"] as const;
type RecordValue = Record<string, unknown>;
type SettingsOp = { op: "set"; path: readonly string[]; value: unknown } | { op: "unset"; path: readonly string[] };
export interface OpenCodeGoSettingsProvider {
	readonly writable?: boolean;
	describe(options?: { redactSecrets?: boolean }): readonly { ns: string; value?: unknown; revision?: number }[];
	mutate(ns: string, ops: readonly SettingsOp[], expectedRevision?: number): Promise<void>;
}
export interface OpenCodeGoModel {
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
}
export type OpenCodeGoConnectionStatus = ReturnType<typeof statusDocument> extends Promise<infer T> ? T : never;

class ConnectionError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}
const record = (value: unknown): RecordValue | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : undefined;
const text = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
const positive = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
function model(value: unknown): OpenCodeGoModel | undefined {
	const item = record(value);
	const id = text(item?.["id"]);
	if (id === undefined) return undefined;
	const name = text(item?.["name"]);
	const contextWindow = positive(item?.["contextWindow"] ?? item?.["context_window"] ?? item?.["max_input_tokens"]);
	const maxTokens = positive(item?.["maxTokens"] ?? item?.["max_tokens"] ?? item?.["max_output_tokens"]);
	return {
		id,
		...(name === undefined ? {} : { name }),
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(maxTokens === undefined ? {} : { maxTokens }),
	};
}
function models(value: unknown): OpenCodeGoModel[] {
	if (Array.isArray(value)) return value.map(model).filter((entry): entry is OpenCodeGoModel => entry !== undefined);
	const item = record(value);
	if (item === undefined) return [];
	if (Array.isArray(item["data"])) return models(item["data"]);
	const catalog = record(item["models"]);
	if (catalog === undefined) return [];
	return Object.entries(catalog)
		.map(([id, entry]) => model({ id, ...record(entry) }))
		.filter((entry): entry is OpenCodeGoModel => entry !== undefined);
}
function refName(value: unknown) {
	const name = text(value);
	if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
		throw new ConnectionError("invalid-credential-ref", "OpenCode Go credential reference is invalid", 400);
	return credentialRef(name);
}
function keyValue(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	const key = text(value);
	if (key === undefined || !/^[\x21-\x7e]+$/u.test(key))
		throw new ConnectionError("invalid-api-key", "OpenCode Go API key is invalid", 400);
	return key;
}
function config(settings: OpenCodeGoSettingsProvider) {
	const descriptor = settings.describe({ redactSecrets: true }).find((entry) => entry.ns === "llm-pi-ai");
	return {
		revision: typeof descriptor?.revision === "number" ? descriptor.revision : null,
		provider: record(record(record(descriptor?.value)?.["providers"])?.["opencode-go"]) ?? {},
	};
}
function conflicts(provider: RecordValue, desired?: GoApi) {
	const result: Array<"protocol" | "base-url" | "static-session-header"> = [];
	const api = text(provider["api"]);
	const baseURL = text(provider["baseURL"]);
	if (api !== undefined && (!isGoApi(api) || (desired !== undefined && api !== desired))) result.push("protocol");
	if (
		baseURL !== undefined &&
		baseURL.replace(/\/+$/u, "") !== goBaseURL(desired ?? (isGoApi(api) ? api : OPENCODE_GO_API))
	)
		result.push("base-url");
	if (Object.keys(record(provider["headers"]) ?? {}).some((name) => name.toLowerCase() === "x-opencode-session"))
		result.push("static-session-header");
	return result;
}
async function candidates(credentials: CredentialProvider, provider: RecordValue) {
	const configuredRef = text(provider["apiKeyEnv"]);
	const refs = [...new Set([...(configuredRef ? [configuredRef] : []), ...KNOWN_REFS])];
	return Promise.all(
		refs.map(async (name) => {
			const ref = refName(name);
			const [info, resolved] = await Promise.all([credentials.describe(ref), credentials.resolve(ref)]);
			return { ref: name, info, value: resolved?.value };
		}),
	);
}
interface Options {
	credentials: CredentialProvider;
	settings: OpenCodeGoSettingsProvider;
	callStatus: () => OpenCodeGoStatus;
	onConfigurationChange?: () => void;
	fetchImpl?: typeof fetch;
}
async function statusDocument(options: Options, preferredRef?: string) {
	const current = config(options.settings);
	const found = await candidates(options.credentials, current.provider);
	const configured = found.filter((entry) => entry.info.configured);
	const configuredRef = text(current.provider["apiKeyEnv"]);
	const selected =
		found.find((entry) => entry.ref === text(preferredRef)) ??
		found.find((entry) => entry.ref === configuredRef) ??
		configured[0] ??
		found[0];
	if (selected === undefined)
		throw new ConnectionError("credential-unavailable", "Credential service is unavailable", 503);
	const configuredValues = new Set(
		configured.map((entry) => entry.value).filter((value): value is string => value !== undefined),
	);
	const catalog = models(current.provider["models"]);
	const api = text(current.provider["api"]) ?? null;
	const baseURL = text(current.provider["baseURL"]) ?? null;
	const issues = conflicts(current.provider);
	if (
		isGoApi(api) &&
		protocolMismatch(
			catalog.map((model) => model.id),
			api,
		) &&
		!issues.includes("protocol")
	)
		issues.push("protocol");
	return {
		credential: {
			selectedRef: selected.ref,
			configured: selected.info.configured,
			writable: selected.info.writable,
			source: selected.info.source ?? null,
			requiresChoice: configuredRef === undefined && configured.length > 1 && configuredValues.size > 1,
			candidates: found.map((entry) => ({
				ref: entry.ref,
				configured: entry.info.configured,
				writable: entry.info.writable,
				source: entry.info.source ?? null,
			})),
		},
		configuration: {
			revision: current.revision,
			writable: options.settings.writable !== false && current.revision !== null,
			api,
			baseURL,
			models: catalog,
			ready:
				selected.ref === configuredRef &&
				selected.info.configured &&
				isGoApi(api) &&
				baseURL?.replace(/\/+$/u, "") === goBaseURL(api) &&
				catalog.length > 0 &&
				issues.length === 0,
			conflicts: issues,
		},
		call: options.callStatus(),
	};
}
export function createOpenCodeGoConnectionController(options: Options) {
	return {
		status: (preferredRef?: string) => statusDocument(options, preferredRef),
		async models(preferredRef?: string) {
			const state = await statusDocument(options, preferredRef);
			if (!state.credential.configured)
				throw new ConnectionError("credential-missing", "Configure an OpenCode Go API key first", 409);
			const resolved = await options.credentials.resolve(refName(state.credential.selectedRef));
			if (resolved === undefined)
				throw new ConnectionError("credential-missing", "OpenCode Go API key is unavailable", 409);
			const response = await (options.fetchImpl ?? fetch)(`${OPENCODE_GO_BASE_URL}/models`, {
				headers: { authorization: `Bearer ${resolved.value}`, accept: "application/json" },
				redirect: "error",
			});
			if (!response.ok)
				throw new ConnectionError(
					response.status === 401 || response.status === 403 ? "credential-rejected" : "model-directory-failed",
					`OpenCode Go model directory returned HTTP ${response.status}`,
					response.status,
				);
			const catalog = models(await response.json());
			if (catalog.length === 0)
				throw new ConnectionError(
					"model-directory-empty",
					"OpenCode Go model directory returned no usable models",
					502,
				);
			return catalog;
		},
		async saveCredential(input: { credentialRef: string; apiKey?: string }) {
			const ref = refName(input.credentialRef);
			const apiKey = keyValue(input.apiKey);
			if (apiKey === undefined) {
				if (!(await options.credentials.describe(ref)).configured)
					throw new ConnectionError("credential-missing", "The selected OpenCode Go credential is not configured", 409);
			} else {
				if (!(await options.credentials.describe(ref)).writable)
					throw new ConnectionError("credential-readonly", "The selected credential source is read-only", 403);
				await options.credentials.set(ref, apiKey);
				options.onConfigurationChange?.();
			}
			return statusDocument(options, input.credentialRef);
		},
		async applyConfiguration(input: {
			api?: GoApi;
			credentialRef: string;
			model: OpenCodeGoModel;
			expectedRevision: number;
			confirmConflicts: boolean;
		}) {
			const ref = refName(input.credentialRef);
			if (!(await options.credentials.describe(ref)).configured)
				throw new ConnectionError("credential-missing", "Configure an OpenCode Go API key first", 409);
			const selected = model(input.model);
			if (selected === undefined || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
				throw new ConnectionError(
					"invalid-configuration",
					"Choose a model and reload the current settings revision",
					400,
				);
			const current = config(options.settings);
			if (options.settings.writable === false)
				throw new ConnectionError("settings-readonly", "DSH settings are read-only", 403);
			if (current.revision === null)
				throw new ConnectionError("settings-unavailable", "DSH model settings are unavailable", 503);
			const api = input.api ?? OPENCODE_GO_API;
			if (!isGoApi(api)) throw new ConnectionError("invalid-protocol", "Choose a supported Go protocol", 400);
			if (protocolMismatch([...models(current.provider["models"]).map((m) => m.id), selected.id], api))
				throw new ConnectionError(
					"model-protocol-mismatch",
					"Go uses one protocol per service. Remove models requiring another protocol in DSH model settings before applying this selection.",
					409,
				);
			const issues = conflicts(current.provider, api);
			if (issues.length > 0 && !input.confirmConflicts)
				throw new ConnectionError(
					"configuration-conflict",
					"Review existing OpenCode Go settings before applying",
					409,
				);
			const raw = current.provider["models"];
			const existing = Array.isArray(raw) ? structuredClone(raw) : [];
			const merged = existing.some((entry) => record(entry)?.["id"] === selected.id)
				? existing
				: [...existing, selected];
			const ops: SettingsOp[] = [
				{ op: "set", path: ["providers", "opencode-go", "apiKeyEnv"], value: input.credentialRef },
				{ op: "set", path: ["providers", "opencode-go", "api"], value: api },
				{ op: "set", path: ["providers", "opencode-go", "baseURL"], value: goBaseURL(api) },
				{ op: "set", path: ["providers", "opencode-go", "models"], value: merged },
			];
			if (issues.includes("static-session-header")) {
				const headers = record(current.provider["headers"]) ?? {};
				for (const key of Object.keys(headers))
					if (key.toLowerCase() === "x-opencode-session")
						ops.push({ op: "unset", path: ["providers", "opencode-go", "headers", key] });
			}
			await options.settings.mutate("llm-pi-ai", ops, input.expectedRevision);
			options.onConfigurationChange?.();
			return statusDocument(options, input.credentialRef);
		},
	};
}
function json(res: ServerResponse, status: number, value: unknown) {
	const body = Buffer.from(`${JSON.stringify(value)}\n`);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.byteLength,
		"cache-control": "no-store",
	});
	res.end(body);
}
export function registerOpenCodeGoConnectionRoute(
	ctx: { webServer: PluginWebRouteRegistry; effect(callback: () => () => void, label?: string): unknown },
	controller: ReturnType<typeof createOpenCodeGoConnectionController>,
	policy: OwnerRequestPolicy,
) {
	let dispose: () => void = () => undefined;
	ctx.effect(() => {
		dispose = registerWebRouteSetupAtomically(ctx.webServer, (webServer) => {
			return webServer.register({
				kind: "exact",
				path: OPENCODE_GO_CONNECTION_PATH,
				handler: async (req: IncomingMessage, res: ServerResponse) => {
					if (!policy.authorize(req).authorized) return json(res, 403, { error: "forbidden", code: "forbidden" });
					try {
						const url = new URL(req.url ?? OPENCODE_GO_CONNECTION_PATH, "http://owner.invalid");
						const body = req.method === "POST" ? (record(await readJsonRequest(req)) ?? {}) : {};
						if (req.method === "GET") {
							const preferredRef = url.searchParams.get("credentialRef") ?? undefined;
							const state = await controller.status(preferredRef);
							return json(
								res,
								200,
								url.searchParams.get("models") === "1"
									? { status: state, models: await controller.models(preferredRef) }
									: state,
							);
						}
						if (req.method !== "POST")
							return json(res, 405, { error: "method not allowed", code: "method-not-allowed" });
						if (body["action"] === "credential") {
							const apiKey = keyValue(body["apiKey"]);
							return json(
								res,
								200,
								await controller.saveCredential({
									credentialRef: String(body["credentialRef"] ?? ""),
									...(apiKey === undefined ? {} : { apiKey }),
								}),
							);
						}
						if (body["action"] === "apply")
							return json(
								res,
								200,
								await controller.applyConfiguration({
									...(body["api"] === undefined ? {} : { api: body["api"] as GoApi }),
									credentialRef: String(body["credentialRef"] ?? ""),
									model: model(body["model"]) ?? { id: "" },
									expectedRevision: Number(body["expectedRevision"]),
									confirmConflicts: body["confirmConflicts"] === true,
								}),
							);
						throw new ConnectionError("invalid-action", "OpenCode Go action must be credential or apply", 400);
					} catch (error) {
						if (error instanceof ConnectionError)
							return json(res, error.status, { error: error.message, code: error.code });
						if (record(error)?.["code"] === "SETTINGS_CONFLICT")
							return json(res, 409, {
								error: "DSH model settings changed; reload and retry",
								code: "settings-conflict",
							});
						return json(res, 500, { error: safeMessage(error), code: "opencode-go-failed" });
					}
				},
			});
		});
		return dispose;
	}, "dsh-coding-oauth: OpenCode Go connection route");
	return () => dispose();
}

/**
 * Plugin-owned same-origin Web routes for the capability-settings namespace.
 * Arbitrary Host settings namespaces are not remotely exposed, so this plugin
 * publishes only the secret-free snapshot and the two optional read surfaces.
 * @module dsh-coding-subscription-oauth/capability-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	CAPABILITY_SETTINGS_KEYS,
	type CapabilitySettings,
	type CapabilitySettingsPatch,
	type CapabilitySettingsSnapshot,
	isCapabilitySettingsConflictError,
	isCapabilitySettingsReadOnlyError,
	normalizeCapabilitySettingsPatch,
} from "./capability-settings.ts";
import { readJsonRequest, requestErrorStatus } from "./http-json.ts";
import { safeMessage } from "./redact.ts";

export const CAPABILITY_SETTINGS_PATH = "/plugins/dsh-grok-build/capabilities";
export const CODEX_USAGE_PATH = "/plugins/dsh-grok-build/codex/usage";
export const IMAGINE_CREDENTIAL_STATUS_PATH = "/plugins/dsh-grok-build/imagine/credential-status";

const SECRET_KEY = /secret|token|password|passphrase|apikey|api_key|authorization|credential|cookie|private[_-]?key/iu;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KNOWN_KEYS = new Set<string>(CAPABILITY_SETTINGS_KEYS);

/** Structural `ctx.webServer` + `ctx.effect` surface used by the registrar. */
export interface CapabilityRouteContext {
	readonly webServer: {
		register(route: {
			kind: "exact" | "prefix";
			path: string;
			handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
		}): () => void;
	};
	effect(callback: () => void | (() => void | Promise<void>), label?: string): unknown;
}

/** Owner-facing subset of {@link import("./capability-settings.ts").CapabilitySettingsController}. */
export interface CapabilityRouteController {
	snapshot(): CapabilitySettingsSnapshot;
	current(): CapabilitySettings;
	patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
	replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
}

/** Secret-free Imagine credential probe returned on the optional status route. */
export interface ImagineCredentialStatus {
	readonly configured: boolean;
	readonly source: string;
	readonly writable: boolean;
}

export interface CapabilityRouteOptions {
	readonly controller: CapabilityRouteController;
	readonly usage?: () => unknown | Promise<unknown>;
	readonly credentialInfo?: () => unknown | Promise<unknown>;
}

class CapabilityRouteRequestError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(message);
		this.name = "CapabilityRouteRequestError";
		this.statusCode = statusCode;
	}
}

/** Register the plugin-owned capability routes. Owns and returns the route disposer. */
export function registerCapabilityRoutes(ctx: CapabilityRouteContext, options: CapabilityRouteOptions): () => void {
	const { controller, usage, credentialInfo } = options;
	const releases: Array<() => void> = [];
	let disposed = false;

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		for (const release of releases.splice(0)) {
			try {
				release();
			} catch {
				// One route disposer must not strand the rest.
			}
		}
	};

	ctx.effect(() => {
		releases.push(
			ctx.webServer.register({
				kind: "exact",
				path: CAPABILITY_SETTINGS_PATH,
				handler: (req, res) => handleCapabilities(req, res, controller),
			}),
		);
		if (usage !== undefined) {
			releases.push(
				ctx.webServer.register({
					kind: "exact",
					path: CODEX_USAGE_PATH,
					handler: (req, res) => handleUsage(req, res, controller, usage),
				}),
			);
		}
		if (credentialInfo !== undefined) {
			releases.push(
				ctx.webServer.register({
					kind: "exact",
					path: IMAGINE_CREDENTIAL_STATUS_PATH,
					handler: (req, res) => handleCredentialStatus(req, res, credentialInfo),
				}),
			);
		}
		return dispose;
	}, "dsh-coding-subscription-oauth: capability routes");

	return dispose;
}

async function handleCapabilities(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CapabilityRouteController,
): Promise<void> {
	const method = req.method ?? "";
	if (method !== "GET" && method !== "PATCH" && method !== "PUT") {
		json(res, 405, { error: "method not allowed" });
		return;
	}
	if (!trustedRequest(req)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		if (method === "GET") {
			json(res, 200, controller.snapshot());
			return;
		}
		const body = await readJsonRequest(req);
		if (method === "PATCH") {
			const { expectedRevision, payload } = readWriteEnvelope(body, "patch");
			json(res, 200, await controller.patch(admitCapabilitySection(payload, "patch"), expectedRevision));
			return;
		}
		const { expectedRevision, payload } = readWriteEnvelope(body, "value");
		json(res, 200, await controller.replace(admitCapabilitySection(payload, "value"), expectedRevision));
	} catch (error: unknown) {
		json(res, statusFor(error), errorBody(error));
	}
}

async function handleUsage(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CapabilityRouteController,
	usage: () => unknown | Promise<unknown>,
): Promise<void> {
	if (req.method !== "GET") {
		json(res, 405, { error: "method not allowed" });
		return;
	}
	if (!trustedRequest(req)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		if (controller.current().codexUsage !== true) {
			json(res, 404, { error: "disabled" });
			return;
		}
		json(res, 200, await usage());
	} catch (error: unknown) {
		json(res, statusFor(error), errorBody(error));
	}
}

async function handleCredentialStatus(
	req: IncomingMessage,
	res: ServerResponse,
	credentialInfo: () => unknown | Promise<unknown>,
): Promise<void> {
	if (req.method !== "GET") {
		json(res, 405, { error: "method not allowed" });
		return;
	}
	if (!trustedRequest(req)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		json(res, 200, publicCredentialStatus(await credentialInfo()));
	} catch (error: unknown) {
		json(res, statusFor(error), errorBody(error));
	}
}

function trustedRequest(req: IncomingMessage): boolean {
	const remote = req.socket.remoteAddress;
	if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = req.headers.host;
	if (host === undefined) return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === new URL(`http://${host}`).host;
	} catch {
		return false;
	}
}

function readWriteEnvelope(
	body: unknown,
	payloadKey: "patch" | "value",
): { expectedRevision: number; payload: Record<string, unknown> } {
	if (!isPlainObject(body)) {
		throw new CapabilityRouteRequestError(400, "request body must be a JSON object");
	}
	const expectedRevision = body["expectedRevision"];
	if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
		throw new CapabilityRouteRequestError(400, "expectedRevision must be a nonnegative integer");
	}
	const payload = body[payloadKey];
	if (!isPlainObject(payload)) {
		throw new CapabilityRouteRequestError(400, `${payloadKey} must be a JSON object`);
	}
	return { expectedRevision, payload };
}

/**
 * Admit a wire section: reject unknown and secret-shaped keys first, then run
 * {@link normalizeCapabilitySettingsPatch} so only secret-free known fields remain.
 */
function admitCapabilitySection(input: Record<string, unknown>, label: string): CapabilitySettingsPatch {
	for (const key of Object.keys(input)) {
		if (RESERVED_KEYS.has(key) || SECRET_KEY.test(key)) {
			throw new CapabilityRouteRequestError(400, `${label} must be secret-free (rejected key ${key})`);
		}
		if (!KNOWN_KEYS.has(key)) {
			throw new CapabilityRouteRequestError(400, `${label} contains unknown key ${key}`);
		}
	}
	return normalizeCapabilitySettingsPatch(input);
}

function publicCredentialStatus(info: unknown): ImagineCredentialStatus {
	const record = isPlainObject(info) ? info : {};
	return {
		configured: record["configured"] === true,
		source: typeof record["source"] === "string" ? record["source"] : "none",
		writable: record["writable"] === true,
	};
}

function statusFor(error: unknown): number {
	if (error instanceof CapabilityRouteRequestError) return error.statusCode;
	const jsonStatus = requestErrorStatus(error, 0);
	if (jsonStatus !== 0) return jsonStatus;
	if (conflictInfo(error) !== undefined) return 409;
	if (isCapabilitySettingsReadOnlyError(error)) {
		return error.reason === "read-only" ? 403 : 503;
	}
	if (typeof error === "object" && error !== null) {
		const code = (error as { code?: unknown }).code;
		if (code === "SETTINGS_READ_ONLY") return 403;
		if (code === "SETTINGS_PROVIDER_ABSENT" || code === "SETTINGS_DISPOSED") return 503;
	}
	if (error instanceof TypeError) return 400;
	return 500;
}

function errorBody(error: unknown): Record<string, unknown> {
	const body: Record<string, unknown> = { error: safeMessage(error) };
	const conflict = conflictInfo(error);
	if (conflict !== undefined) {
		body["code"] = "SETTINGS_CONFLICT";
		body["expected"] = conflict.expected;
		body["actual"] = conflict.actual;
		return body;
	}
	if (isCapabilitySettingsReadOnlyError(error)) {
		body["code"] = error.code;
	}
	return body;
}

function conflictInfo(error: unknown): { expected: number; actual: number } | undefined {
	if (isCapabilitySettingsConflictError(error)) {
		return { expected: error.expected, actual: error.actual };
	}
	if (typeof error !== "object" || error === null) return undefined;
	const candidate = error as { code?: unknown; expected?: unknown; actual?: unknown };
	if (candidate.code !== "SETTINGS_CONFLICT") return undefined;
	if (typeof candidate.expected !== "number" || typeof candidate.actual !== "number") return undefined;
	return { expected: candidate.expected, actual: candidate.actual };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function json(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(value));
}

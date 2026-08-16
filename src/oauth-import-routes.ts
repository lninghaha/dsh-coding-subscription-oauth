/**
 * Same-origin Web API for allowlisted CLI OAuth source discovery and
 * two-phase import into destination stores. Preview tickets stay in one
 * process-local session; persist happens inside the destination store lock.
 * @module dsh-coding-subscription-oauth/oauth-import-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonRequest, requestErrorStatus } from "./http-json.ts";
import {
	createOAuthImportSession,
	isOAuthSourceError,
	isOAuthSourceKind,
	OAUTH_IMPORT_MAX_PREVIEW_TICKETS,
	type OAuthImportCommitAction,
	type OAuthImportCommitResult,
	type OAuthImportPreview,
	type OAuthImportSession,
	type OAuthImportSessionOptions,
	type OAuthSourceCredential,
	type OAuthSourceDiscovery,
	type OAuthSourceErrorCode,
	type OAuthSourceKind,
	type OAuthSourcePathOptions,
} from "./oauth-sources.ts";
import { safeMessage } from "./redact.ts";

export const OAUTH_IMPORT_SOURCES_PATH = "/plugins/dsh-grok-build/oauth/sources";
export const OAUTH_IMPORT_PREVIEW_PATH = "/plugins/dsh-grok-build/oauth/sources/preview";
export const OAUTH_IMPORT_COMMIT_PATH = "/plugins/dsh-grok-build/oauth/sources/commit";
export const OAUTH_IMPORT_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/sources/cancel";

export interface OAuthImportRouteContext {
	webServer: {
		register(route: {
			kind: "exact";
			path: string;
			handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
		}): () => void;
	};
	effect?(setup: () => void | (() => void | Promise<void>), label?: string): void;
}

export interface OAuthImportDestinationStore {
	readonly filename: string;
	modify(
		providerId: string,
		fn: (current: OAuthSourceCredential | undefined) => Promise<OAuthSourceCredential | undefined>,
	): Promise<OAuthSourceCredential | undefined>;
}

export interface OAuthImportDestination {
	providerId: string;
	store: OAuthImportDestinationStore;
}

export type OAuthImportDestinations = { [K in OAuthSourceKind]: OAuthImportDestination };

export interface OAuthImportAppliedEvent {
	kind: OAuthSourceKind;
	action: Extract<OAuthImportCommitAction, "imported" | "overwritten">;
}

export interface OAuthImportRouteOptions extends OAuthImportSessionOptions, OAuthSourcePathOptions {
	onImported?: (event: OAuthImportAppliedEvent) => void | Promise<void>;
}

export interface OAuthImportSourcesResponse {
	sources: OAuthSourceDiscovery[];
}

export interface OAuthImportCancelResult {
	ok: true;
	cancelled: boolean;
}

/** Register same-origin CLI source import routes when the Web server is composed. */
export function registerOAuthImportRoutes(
	ctx: OAuthImportRouteContext,
	destinations: OAuthImportDestinations,
	options: OAuthImportRouteOptions = {},
): void {
	const importer = createOAuthImportSession({
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
	});
	const previewKinds = new Map<string, { kind: OAuthSourceKind; expiresAt: number }>();
	const now = options.now ?? Date.now;
	const pathOptions: OAuthSourcePathOptions = {
		...(options.home === undefined ? {} : { home: options.home }),
		...(options.env === undefined ? {} : { env: options.env }),
	};

	const attach = (): (() => void) => {
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: OAUTH_IMPORT_SOURCES_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						json(res, 200, await discoverSources(importer, pathOptions));
					} catch (error: unknown) {
						writeError(res, error);
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OAUTH_IMPORT_PREVIEW_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const kind = readExactKind(await readJsonRequest(req));
						if (kind === undefined) {
							return json(res, 400, { error: "kind must be grok, codex, kimi, or claude" });
						}
						const preview = await previewSource(importer, destinations[kind], kind, pathOptions);
						for (const [previewId, tracked] of previewKinds) {
							if (tracked.expiresAt <= now()) previewKinds.delete(previewId);
						}
						while (previewKinds.size >= OAUTH_IMPORT_MAX_PREVIEW_TICKETS) {
							const oldest = previewKinds.keys().next().value;
							if (oldest === undefined) break;
							previewKinds.delete(oldest);
						}
						previewKinds.set(preview.previewId, { kind, expiresAt: preview.ticketExpiresAt });
						json(res, 200, preview);
					} catch (error: unknown) {
						writeError(res, error);
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OAUTH_IMPORT_COMMIT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const parsed = readCommitBody(await readJsonRequest(req));
						if (parsed.error !== undefined) {
							return json(res, 400, { error: parsed.error });
						}
						const expected = previewKinds.get(parsed.previewId);
						if (expected !== undefined && expected.kind !== parsed.kind) {
							return json(res, 400, { error: "kind does not match the preview" });
						}
						previewKinds.delete(parsed.previewId);
						const result = await commitSource(
							importer,
							destinations[parsed.kind],
							parsed,
							pathOptions,
							options.onImported,
						);
						json(res, 200, result);
					} catch (error: unknown) {
						writeError(res, error);
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OAUTH_IMPORT_CANCEL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const previewId = readPreviewId(await readJsonRequest(req));
						if (previewId === undefined) {
							return json(res, 400, { error: "previewId must be a non-empty string" });
						}
						previewKinds.delete(previewId);
						json(res, 200, { ok: true, cancelled: importer.cancel(previewId) } satisfies OAuthImportCancelResult);
					} catch (error: unknown) {
						writeError(res, error);
					}
				},
			}),
		];
		return () => {
			for (const dispose of routes) dispose();
		};
	};

	if (typeof ctx.effect === "function") {
		ctx.effect(attach, "dsh-coding-subscription-oauth: OAuth source import routes");
		return;
	}
	attach();
}

async function discoverSources(
	importer: OAuthImportSession,
	pathOptions: OAuthSourcePathOptions,
): Promise<OAuthImportSourcesResponse> {
	return { sources: await importer.discover(pathOptions) };
}

async function previewSource(
	importer: OAuthImportSession,
	destination: OAuthImportDestination,
	kind: OAuthSourceKind,
	pathOptions: OAuthSourcePathOptions,
): Promise<OAuthImportPreview> {
	return importer.preview({
		kind,
		...pathOptions,
		destination: { path: destination.store.filename },
	});
}

async function commitSource(
	importer: OAuthImportSession,
	destination: OAuthImportDestination,
	input: { kind: OAuthSourceKind; previewId: string; confirmOverwrite?: boolean },
	pathOptions: OAuthSourcePathOptions,
	onImported: OAuthImportRouteOptions["onImported"],
): Promise<OAuthImportCommitResult> {
	let result: OAuthImportCommitResult | undefined;
	await destination.store.modify(destination.providerId, async (current) => {
		const outcome = await importer.commit({
			previewId: input.previewId,
			...(input.confirmOverwrite === undefined ? {} : { confirmOverwrite: input.confirmOverwrite }),
			...pathOptions,
			destination: { path: destination.store.filename },
		});
		result = outcome.result;
		return outcome.takePersist() ?? current;
	});
	if (result === undefined) {
		throw new Error("oauth import: destination store did not complete commit");
	}
	if (result.action === "imported" || result.action === "overwritten") {
		try {
			await onImported?.({ kind: input.kind, action: result.action });
		} catch {
			// Adapter notification is advisory; persist already succeeded.
		}
	}
	return result;
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

function json(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(value));
}

function writeError(res: ServerResponse, error: unknown): void {
	const payload: { error: string; code?: OAuthSourceErrorCode } = { error: safeMessage(error) };
	if (isOAuthSourceError(error)) payload.code = error.code;
	json(res, oauthImportErrorStatus(error), payload);
}

export function oauthImportErrorStatus(error: unknown): number {
	if (isOAuthSourceError(error)) {
		switch (error.code) {
			case "not_found":
			case "preview_invalid":
				return 404;
			case "too_large":
				return 413;
			case "preview_expired":
				return 410;
			case "source_changed":
			case "destination_changed":
			case "confirm_required":
			case "unsafe_destination":
				return 409;
			case "unsafe_source":
			case "invalid_document":
			case "unsupported":
				return 400;
		}
	}
	return requestErrorStatus(error, 500);
}

function readExactKind(body: unknown): OAuthSourceKind | undefined {
	const record = asRecord(body);
	if (record === undefined) return undefined;
	const kind = record["kind"];
	return typeof kind === "string" && isOAuthSourceKind(kind) ? kind : undefined;
}

function readPreviewId(body: unknown): string | undefined {
	const record = asRecord(body);
	if (record === undefined) return undefined;
	const previewId = record["previewId"];
	return typeof previewId === "string" && previewId.length > 0 ? previewId : undefined;
}

function readCommitBody(
	body: unknown,
): { kind: OAuthSourceKind; previewId: string; confirmOverwrite?: boolean; error?: undefined } | { error: string } {
	const kind = readExactKind(body);
	if (kind === undefined) return { error: "kind must be grok, codex, kimi, or claude" };
	const previewId = readPreviewId(body);
	if (previewId === undefined) return { error: "previewId must be a non-empty string" };
	const record = asRecord(body);
	if (record === undefined) return { error: "request body must be a JSON object" };
	if (!("confirmOverwrite" in record) || record["confirmOverwrite"] === undefined) {
		return { kind, previewId };
	}
	if (typeof record["confirmOverwrite"] !== "boolean") {
		return { error: "confirmOverwrite must be a boolean" };
	}
	return { kind, previewId, confirmOverwrite: record["confirmOverwrite"] };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

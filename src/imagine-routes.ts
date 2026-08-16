/**
 * Same-origin GET routes for generated Imagine images and video artifacts.
 * The Host webServer only accepts exact paths, so this registrar keeps a
 * bounded table of opaque ids and registers one exact disposer per remembered
 * image ref or media artifact.
 * @module dsh-coding-subscription-oauth/imagine-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import {
	DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES,
	type ImagineImageAttachmentRef,
	type ImagineImageMediaType,
	imagineImageDownloadHeaders,
	imagineImagePath,
	isSafeImagineAttachmentId,
	parseImagineImagePath,
} from "./grok-imagine.ts";
import {
	createTrustedImagineAuthz,
	imagineMediaPath,
	isSafeMediaArtifactId,
	MEDIA_STORE_MAX_BYTES,
	type MediaArtifactMeta,
	type MediaDownloadView,
	MediaStoreError,
	type MediaStoreVideoType,
	mediaDownloadHeaders,
	parseImagineMediaPath,
	type TrustedImagineAuthz,
} from "./media-store.ts";
import { isTrustedLoopbackWebRequest } from "./web-origin.ts";

/** Hard ceiling for live exact download routes. Callers cannot raise this. */
export const IMAGINE_ROUTE_MAX_ENTRIES = 64;

/** Hard ceiling for remembered image routes. Callers cannot raise this. */
export const IMAGINE_IMAGE_ROUTE_TTL_MS = 60 * 60 * 1000;

const IMAGE_MEDIA_TYPES = new Set<string>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_MEDIA_TYPES = new Set<string>(["video/mp4", "video/webm"]);

/** Structural `ctx.webServer` + optional `ctx.effect` surface used by the registrar. */
export interface ImagineRouteContext {
	readonly webServer: {
		register(route: {
			kind: "exact";
			path: string;
			handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
		}): () => void;
	};
	effect?(setup: () => () => void | Promise<void>, label?: string): unknown;
}

/** Attachment seam used at GET time. Only metadata is retained in the registry. */
export interface ImagineRouteAttachmentStore {
	readonly imageLimits?: { readonly maxImageBytes?: number };
	readImage(
		ref: ImagineImageAttachmentRef,
		signal?: AbortSignal,
	): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }>;
}

/** Structural media download seam. Production adapts `MediaStore.openDownload`. */
export interface ImagineMediaDownloadStore {
	readForDownload(artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView>;
}

export interface ImagineRouteOptions {
	readonly attachments: ImagineRouteAttachmentStore;
	readonly media: ImagineMediaDownloadStore;
	readonly now?: () => number;
	/** Capped at {@link IMAGINE_ROUTE_MAX_ENTRIES}. */
	readonly maxEntries?: number;
	/** Capped at {@link IMAGINE_IMAGE_ROUTE_TTL_MS}. */
	readonly imageTtlMs?: number;
}

export interface ImagineRouteRegistry {
	rememberImages(refs: readonly ImageAttachmentRef[] | readonly ImagineImageAttachmentRef[]): void;
	rememberArtifact(meta: MediaArtifactMeta): void;
	revokeImages(): void;
	revokeArtifacts(): void;
	dispose(): void;
}

interface ImageRouteEntry {
	readonly kind: "image";
	readonly id: string;
	readonly path: string;
	readonly routeToken: symbol;
	ref: ImagineImageAttachmentRef;
	expiresAt: number;
	readonly disposeRoute: () => void;
}

interface MediaRouteEntry {
	readonly kind: "media";
	readonly id: string;
	readonly path: string;
	readonly routeToken: symbol;
	meta: MediaArtifactMeta;
	expiresAt: number;
	readonly disposeRoute: () => void;
}

type RouteEntry = ImageRouteEntry | MediaRouteEntry;

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** Register the bounded exact-path Imagine download registry. */
export function registerImagineRoutes(ctx: ImagineRouteContext, options: ImagineRouteOptions): ImagineRouteRegistry {
	const now = options.now ?? Date.now;
	const maxEntries = clampPositive(options.maxEntries, IMAGINE_ROUTE_MAX_ENTRIES);
	const imageTtlMs = clampPositive(options.imageTtlMs, IMAGINE_IMAGE_ROUTE_TTL_MS);
	const entries = new Map<string, RouteEntry>();
	let disposed = false;

	const wrapDisposer = (release: () => void): (() => void) => {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			try {
				release();
			} catch {
				// One route disposer must not strand the rest of the table.
			}
		};
	};

	const evict = (key: string): void => {
		const entry = entries.get(key);
		if (entry === undefined) return;
		entries.delete(key);
		entry.disposeRoute();
	};

	const evictExpired = (at: number): void => {
		for (const [key, entry] of [...entries]) {
			if (entry.expiresAt <= at) evict(key);
		}
	};

	const evictOldest = (): void => {
		const oldest = entries.keys().next().value;
		if (oldest !== undefined) evict(oldest);
	};

	const lookupKey = (kind: RouteEntry["kind"], id: string): string => `${kind}:${id}`;

	const registerExact = (path: string, handler: RouteHandler): (() => void) =>
		wrapDisposer(
			ctx.webServer.register({
				kind: "exact",
				path,
				handler,
			}),
		);

	const isCurrent = (kind: RouteEntry["kind"], id: string, routeToken: symbol): boolean => {
		if (disposed) return false;
		const entry = entries.get(lookupKey(kind, id));
		return entry !== undefined && entry.kind === kind && entry.routeToken === routeToken && entry.expiresAt > now();
	};

	const handleGet = async (
		kind: RouteEntry["kind"],
		id: string,
		routeToken: symbol,
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		if ((req.method ?? "") !== "GET") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!isTrustedLoopbackWebRequest(req)) {
			json(res, 403, { error: "forbidden" });
			return;
		}
		if (!isCurrent(kind, id, routeToken)) {
			const key = lookupKey(kind, id);
			const current = entries.get(key);
			if (current?.routeToken === routeToken && current.expiresAt <= now()) evict(key);
			json(res, 404, { error: "not found" });
			return;
		}
		const key = lookupKey(kind, id);
		const entry = entries.get(key);
		if (entry === undefined || entry.kind !== kind) {
			json(res, 404, { error: "not found" });
			return;
		}
		try {
			if (entry.kind === "image") {
				await serveImage(options.attachments, entry, req, res, () => isCurrent(kind, id, routeToken));
			} else {
				await serveMedia(options.media, entry, res, () => isCurrent(kind, id, routeToken));
			}
		} catch (error: unknown) {
			if (res.headersSent) return;
			if (!isCurrent(kind, id, routeToken)) {
				json(res, 404, { error: "not found" });
				return;
			}
			json(res, statusFor(error), { error: publicErrorMessage(error) });
		}
	};

	const rememberImage = (input: ImageAttachmentRef | ImagineImageAttachmentRef): void => {
		if (disposed) return;
		const at = now();
		evictExpired(at);
		const ref = cloneImageRef(input);
		if (ref === undefined) return;
		if (ref.bytes > maxImageBytes(options.attachments)) return;
		let path: string;
		try {
			path = imagineImagePath(ref.attachmentId);
		} catch {
			return;
		}
		if (parseImagineImagePath(path) !== ref.attachmentId) return;
		const key = lookupKey("image", ref.attachmentId);
		const existing = entries.get(key);
		if (existing?.kind === "image") {
			entries.delete(key);
			existing.ref = ref;
			existing.expiresAt = at + imageTtlMs;
			entries.set(key, existing);
			return;
		}
		while (entries.size >= maxEntries) evictOldest();
		const routeToken = Symbol(ref.attachmentId);
		const release = registerExact(path, (req, res) => handleGet("image", ref.attachmentId, routeToken, req, res));
		entries.set(key, {
			kind: "image",
			id: ref.attachmentId,
			path,
			routeToken,
			ref,
			expiresAt: at + imageTtlMs,
			disposeRoute: release,
		});
	};

	const rememberArtifact = (input: MediaArtifactMeta): void => {
		if (disposed) return;
		const at = now();
		evictExpired(at);
		const meta = cloneArtifactMeta(input);
		if (meta === undefined || meta.expiresAt <= at) return;
		let path: string;
		try {
			path = imagineMediaPath(meta.artifactId);
		} catch {
			return;
		}
		if (parseImagineMediaPath(path) !== meta.artifactId) return;
		const key = lookupKey("media", meta.artifactId);
		const existing = entries.get(key);
		if (existing?.kind === "media") {
			entries.delete(key);
			existing.meta = meta;
			existing.expiresAt = meta.expiresAt;
			entries.set(key, existing);
			return;
		}
		while (entries.size >= maxEntries) evictOldest();
		const routeToken = Symbol(meta.artifactId);
		const release = registerExact(path, (req, res) => handleGet("media", meta.artifactId, routeToken, req, res));
		entries.set(key, {
			kind: "media",
			id: meta.artifactId,
			path,
			routeToken,
			meta,
			expiresAt: meta.expiresAt,
			disposeRoute: release,
		});
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		for (const key of [...entries.keys()]) evict(key);
	};

	if (typeof ctx.effect === "function") {
		ctx.effect(() => dispose, "dsh-coding-subscription-oauth: imagine download routes");
	}

	return {
		rememberImages(refs) {
			for (const ref of refs) rememberImage(ref);
		},
		rememberArtifact,
		revokeImages() {
			for (const [key, entry] of [...entries]) {
				if (entry.kind === "image") evict(key);
			}
		},
		revokeArtifacts() {
			for (const [key, entry] of [...entries]) {
				if (entry.kind === "media") evict(key);
			}
		},
		dispose,
	};
}

async function serveImage(
	attachments: ImagineRouteAttachmentStore,
	entry: ImageRouteEntry,
	req: IncomingMessage,
	res: ServerResponse,
	alive: () => boolean,
): Promise<void> {
	const limit = maxImageBytes(attachments);
	if (entry.ref.bytes > limit) {
		json(res, 404, { error: "not found" });
		return;
	}
	const stored = await attachments.readImage(cloneImageRef(entry.ref) ?? entry.ref, requestSignal(req));
	if (res.headersSent) return;
	if (!alive()) {
		json(res, 404, { error: "not found" });
		return;
	}
	if (!sameImageIdentity(entry.ref, stored.ref) || stored.data.byteLength > limit) {
		json(res, 404, { error: "not found" });
		return;
	}
	const headers = imagineImageDownloadHeaders({
		...stored.ref,
		bytes: stored.data.byteLength,
	});
	res.writeHead(200, {
		"Content-Type": headers["Content-Type"],
		"Content-Length": String(stored.data.byteLength),
		"Cache-Control": headers["Cache-Control"],
		"X-Content-Type-Options": headers["X-Content-Type-Options"],
	});
	res.end(Buffer.from(stored.data));
}

async function serveMedia(
	media: ImagineMediaDownloadStore,
	entry: MediaRouteEntry,
	res: ServerResponse,
	alive: () => boolean,
): Promise<void> {
	const authz = createTrustedImagineAuthz({ authorized: true });
	const view = await media.readForDownload(entry.id, authz);
	if (res.headersSent) return;
	if (!alive()) {
		json(res, 404, { error: "not found" });
		return;
	}
	if (
		view.meta.artifactId !== entry.id ||
		view.meta.mediaType !== entry.meta.mediaType ||
		view.meta.bytes !== view.body.byteLength ||
		view.body.byteLength > MEDIA_STORE_MAX_BYTES
	) {
		json(res, 404, { error: "not found" });
		return;
	}
	const headers = mediaDownloadHeaders({ ...entry.meta, bytes: view.body.byteLength });
	res.writeHead(200, {
		"Content-Type": headers["Content-Type"],
		"Content-Length": headers["Content-Length"],
		"Content-Disposition": headers["Content-Disposition"],
		"Cache-Control": headers["Cache-Control"],
		"X-Content-Type-Options": headers["X-Content-Type-Options"],
	});
	res.end(Buffer.from(view.body));
}

function requestSignal(req: IncomingMessage): AbortSignal | undefined {
	const candidate = req as IncomingMessage & { signal?: unknown };
	return candidate.signal instanceof AbortSignal ? candidate.signal : undefined;
}

function maxImageBytes(attachments: ImagineRouteAttachmentStore): number {
	const configured = attachments.imageLimits?.maxImageBytes;
	if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
		return DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES;
	}
	return Math.min(Math.floor(configured), DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES);
}

function cloneImageRef(input: ImageAttachmentRef | ImagineImageAttachmentRef): ImagineImageAttachmentRef | undefined {
	if (typeof input.attachmentId !== "string" || !isSafeImagineAttachmentId(input.attachmentId)) return undefined;
	if (!IMAGE_MEDIA_TYPES.has(input.mediaType)) return undefined;
	if (!Number.isFinite(input.bytes) || input.bytes < 0) return undefined;
	if (!Number.isFinite(input.width) || !Number.isFinite(input.height)) return undefined;
	const cloned: ImagineImageAttachmentRef = {
		attachmentId: input.attachmentId,
		mediaType: input.mediaType as ImagineImageMediaType,
		bytes: Math.trunc(input.bytes),
		width: Math.trunc(input.width),
		height: Math.trunc(input.height),
	};
	if (typeof input.name === "string") cloned.name = input.name;
	return cloned;
}

function cloneArtifactMeta(input: MediaArtifactMeta): MediaArtifactMeta | undefined {
	if (typeof input.artifactId !== "string" || !isSafeMediaArtifactId(input.artifactId)) return undefined;
	if (!VIDEO_MEDIA_TYPES.has(input.mediaType)) return undefined;
	if (!Number.isFinite(input.bytes) || input.bytes <= 0) return undefined;
	if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) return undefined;
	if (!Number.isFinite(input.expiresAt) || input.expiresAt <= input.createdAt) return undefined;
	const cloned: MediaArtifactMeta = {
		artifactId: input.artifactId,
		mediaType: input.mediaType as MediaStoreVideoType,
		bytes: Math.trunc(input.bytes),
		createdAt: input.createdAt,
		expiresAt: input.expiresAt,
	};
	if (typeof input.name === "string") cloned.name = input.name;
	return cloned;
}

function sameImageIdentity(expected: ImagineImageAttachmentRef, actual: ImagineImageAttachmentRef): boolean {
	return actual.attachmentId === expected.attachmentId && IMAGE_MEDIA_TYPES.has(actual.mediaType);
}

function statusFor(error: unknown): number {
	if (error instanceof MediaStoreError) {
		if (error.code === "NOT_FOUND" || error.code === "EXPIRED" || error.code === "INVALID_ID") return 404;
		if (error.code === "FORBIDDEN") return 403;
	}
	return 500;
}

function publicErrorMessage(error: unknown): string {
	if (error instanceof MediaStoreError) {
		if (error.code === "NOT_FOUND" || error.code === "EXPIRED" || error.code === "INVALID_ID") return "not found";
		if (error.code === "FORBIDDEN") return "forbidden";
	}
	return "download failed";
}

function clampPositive(value: number | undefined, ceiling: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ceiling;
	return Math.min(Math.floor(value), ceiling);
}

function json(res: ServerResponse, status: number, value: unknown): void {
	if (res.headersSent) return;
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(value));
}

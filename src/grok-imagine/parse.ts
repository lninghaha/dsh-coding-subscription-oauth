/**
 * Grok Imagine pure parse / path / media-type helpers.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */

import type { MediaStoreVideoType } from "../media-store.ts";
import { safeMessage } from "../redact.ts";
import {
	GrokImagineError,
	IMAGINE_IMAGE_IDS_MAX,
	IMAGINE_IMAGE_IDS_MIN,
	IMAGINE_IMAGE_ROUTE_PREFIX,
	type ImagineImageAttachmentRef,
	type ImagineImageDownloadHeaders,
	type ImagineImageMediaType,
	VIDEO_REQUEST_ID_PATTERN,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { isRecord };

export function redactImagineMessage(error: unknown): string {
	const withoutRemoteUrls = (error instanceof Error ? error.message : String(error)).replace(
		/https?:\/\/[^\s"'<>\\]+/giu,
		"[redacted-url]",
	);
	return safeMessage(withoutRemoteUrls);
}

export function grokImagineVideoStatusPath(requestId: string): string {
	if (!VIDEO_REQUEST_ID_PATTERN.test(requestId)) {
		throw new GrokImagineError("INVALID_INPUT", "video request id is not a safe identifier");
	}
	return `/v1/videos/${encodeURIComponent(requestId)}`;
}

export function isSafeImagineAttachmentId(attachmentId: string): boolean {
	if (attachmentId.length === 0 || attachmentId.length > 128) return false;
	if (
		attachmentId.includes("/") ||
		attachmentId.includes("\\") ||
		attachmentId.includes("..") ||
		attachmentId.includes("\0")
	) {
		return false;
	}
	// DSH's local attachment backend currently emits `sha256:<hex>`; keep the
	// host's opaque colon/dot-compatible contract while excluding separators.
	return /^[A-Za-z0-9:._-]+$/u.test(attachmentId);
}

export function imagineImagePath(attachmentId: string): string {
	if (!isSafeImagineAttachmentId(attachmentId)) {
		throw new GrokImagineError("INVALID_INPUT", "attachment id is not safe for a same-origin image route");
	}
	return `${IMAGINE_IMAGE_ROUTE_PREFIX}${encodeURIComponent(attachmentId)}`;
}

export function parseImagineImagePath(pathname: string): string | undefined {
	if (!pathname.startsWith(IMAGINE_IMAGE_ROUTE_PREFIX)) return undefined;
	const rest = pathname.slice(IMAGINE_IMAGE_ROUTE_PREFIX.length);
	if (rest.length === 0) return undefined;
	if (rest.includes("/") || rest.includes("\\") || rest.includes("..")) return undefined;
	if (rest.includes("\0")) return undefined;
	let decoded: string;
	try {
		decoded = decodeURIComponent(rest);
	} catch {
		return undefined;
	}
	if (decoded.length === 0 || decoded.length > 128) return undefined;
	return isSafeImagineAttachmentId(decoded) ? decoded : undefined;
}

const IMAGE_SUFFIX = new Set<string>(["png", "jpg", "jpeg", "webp", "gif"]);
const IMAGE_SUFFIX_RE = /\.([a-z0-9]{2,5})$/iu;

/**
 * Build a `Content-Disposition` token for an Imagine image. Falls back to a
 * percent-encoded `filename*=UTF-8''…` parameter when the legacy token would
 * carry characters that would break RFC 6266 quoting.
 */
function imageContentDisposition(filename: string): string {
	let safe = "";
	let needsEncoding = false;
	for (const character of filename) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (
			character === '"' ||
			character === ";" ||
			character === "\\" ||
			character === "/" ||
			codePoint < 0x20 ||
			codePoint === 0x7f ||
			codePoint >= 0x80
		) {
			needsEncoding = true;
			continue;
		}
		safe = `${safe}${character}`;
	}
	safe = safe.trim().slice(0, 120);
	if (!needsEncoding) return `inline; filename="${filename}"`;
	const encoded = encodeURIComponent(filename).replace(
		/[!'()*]/gu,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
	return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

export function imagineImageDownloadHeaders(ref: ImagineImageAttachmentRef): ImagineImageDownloadHeaders {
	const subtype = ref.mediaType.slice("image/".length);
	if (!IMAGE_SUFFIX.has(subtype)) {
		throw new GrokImagineError("INVALID_INPUT", "imagine image subtype is not recognized for downloads");
	}
	const filename = `imagine-${ref.attachmentId}.${subtype}`;
	if (!IMAGE_SUFFIX_RE.test(filename) || filename.length > 200) {
		throw new GrokImagineError("INVALID_INPUT", "imagine image filename is not safe for downloads");
	}
	return {
		"Content-Type": ref.mediaType,
		"Content-Length": String(ref.bytes),
		"Content-Disposition": imageContentDisposition(filename),
		"Cache-Control": "private, max-age=0, no-store",
		"X-Content-Type-Options": "nosniff",
	};
}

export function detectImageMediaType(data: Uint8Array): ImagineImageMediaType | undefined {
	if (data.byteLength >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
		return "image/png";
	}
	if (data.byteLength >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
	if (
		data.byteLength >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return "image/webp";
	}
	if (
		data.byteLength >= 6 &&
		data[0] === 0x47 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x38 &&
		(data[4] === 0x37 || data[4] === 0x39) &&
		data[5] === 0x61
	) {
		return "image/gif";
	}
	return undefined;
}

export function detectVideoMediaType(data: Uint8Array): MediaStoreVideoType | undefined {
	if (data.byteLength >= 12 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
		return "video/mp4";
	}
	if (data.byteLength >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
		return "video/webm";
	}
	return undefined;
}

export function parseVideoRequestId(value: unknown): string {
	if (typeof value !== "string") {
		throw new GrokImagineError("INVALID_INPUT", "video request id must be a string");
	}
	if (!VIDEO_REQUEST_ID_PATTERN.test(value)) {
		throw new GrokImagineError(
			"INVALID_INPUT",
			"video request id must match ^[A-Za-z0-9_-]{1,256}$ and be a safe ASCII identifier",
		);
	}
	return value;
}

/** Enforce min/max bounds on a candidate image-id array. */
export function clampImagineImageIds(ids: readonly unknown[]): readonly string[] {
	if (!Array.isArray(ids)) {
		throw new GrokImagineError("INVALID_INPUT", "imageIds must be an array");
	}
	if (ids.length < IMAGINE_IMAGE_IDS_MIN || ids.length > IMAGINE_IMAGE_IDS_MAX) {
		throw new GrokImagineError(
			"INVALID_INPUT",
			`imageIds must contain between ${String(IMAGINE_IMAGE_IDS_MIN)} and ${String(IMAGINE_IMAGE_IDS_MAX)} ids (got ${String(ids.length)})`,
		);
	}
	return ids.map((entry, index) => {
		if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) {
			throw new GrokImagineError("INVALID_INPUT", `imageIds[${String(index)}] must be a non-empty ASCII id`);
		}
		return entry;
	});
}

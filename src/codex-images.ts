/**
 * Optional Codex image generation/edits against the private ChatGPT backend.
 * Fixed model `gpt-image-2` with `auto` size/quality/background defaults.
 * Always requests `response_format: b64_json`. Only `b64_json` items are
 * accepted after an encoded-size precheck and strict base64/base64url decode.
 * Edit IDs resolve solely from canonical image attachment refs that are
 * visibly present in the current session's top-level message content (max 5).
 *
 * @module dsh-coding-subscription-oauth/codex-images
 */

import type {
	ImageAttachmentRef,
	ImageMediaType,
	SaveImageAttachment,
	StoredImageAttachment,
} from "@deepseek-ai/dsh-attachment";
import { LlmError } from "@deepseek-ai/dsh-llm";
import {
	type CodexAuthSession,
	type CodexFetch,
	type CodexHttpClient,
	createCodexHttpClient,
	isRecord,
} from "./codex-http.ts";

export const CODEX_IMAGE_GENERATION_URL = "https://chatgpt.com/backend-api/codex/images/generations";
export const CODEX_IMAGE_EDIT_URL = "https://chatgpt.com/backend-api/codex/images/edits";
export const CODEX_IMAGE_MODEL = "gpt-image-2";
export const CODEX_IMAGE_AUTO = "auto";
export const CODEX_IMAGE_RESPONSE_FORMAT = "b64_json";
export const CODEX_IMAGE_MAX_REFERENCES = 5;

export const CODEX_IMAGE_CAPABLE_PROVIDERS = ["codex-oauth", "openai-codex", "codex-oauth-fast"] as const;
export type CodexImageCapableProvider = (typeof CODEX_IMAGE_CAPABLE_PROVIDERS)[number];

export const CODEX_IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
export type CodexImageSize = (typeof CODEX_IMAGE_SIZES)[number];

export const CODEX_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type CodexImageQuality = (typeof CODEX_IMAGE_QUALITIES)[number];

export const CODEX_IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export type CodexImageBackground = (typeof CODEX_IMAGE_BACKGROUNDS)[number];

export interface CodexImageAttachmentStore {
	readonly imageLimits: {
		readonly maxImageBytes: number;
		readonly maxImagesPerMessage: number;
		readonly maxMessageImageBytes: number;
		readonly mediaTypes: readonly ImageMediaType[];
	};
	validateImage(input: SaveImageAttachment): Promise<void>;
	saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
	readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>;
}

export interface CodexDerivedMessage {
	readonly content?: readonly unknown[];
}

export interface CodexImageRoute {
	readonly provider?: string;
	readonly model?: string;
	readonly inputModalities?: readonly string[];
}

export interface CodexImageSessionContext {
	deriveMessages(): readonly CodexDerivedMessage[];
	route?: CodexImageRoute;
}

export interface CodexImageGenerateInput {
	readonly prompt: string;
	readonly n?: number;
	readonly size?: CodexImageSize;
	readonly quality?: CodexImageQuality;
	readonly background?: CodexImageBackground;
}

export interface CodexImageEditInput extends CodexImageGenerateInput {
	readonly imageIds: readonly string[];
}

export interface CodexImageWarning {
	readonly index: number;
	readonly code: string;
	readonly message: string;
}

export interface CodexImageResult {
	readonly operation: "generate" | "edit";
	readonly model: typeof CODEX_IMAGE_MODEL;
	readonly images: readonly ImageAttachmentRef[];
	readonly references: readonly ImageAttachmentRef[];
	readonly warnings: readonly CodexImageWarning[];
}

export interface CodexImageControllerOptions {
	readonly auth: CodexAuthSession;
	readonly attachments: CodexImageAttachmentStore;
	readonly session: CodexImageSessionContext;
	readonly http?: CodexHttpClient;
	readonly fetchImpl?: CodexFetch;
	readonly originator?: string;
	readonly userAgent?: string;
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	readonly now?: () => number;
}

export interface CodexImageController {
	generate(input: CodexImageGenerateInput, signal?: AbortSignal): Promise<CodexImageResult>;
	edit(input: CodexImageEditInput, signal?: AbortSignal): Promise<CodexImageResult>;
}

const MAX_GENERATED = 4;

/** True only for a Codex OAuth route that explicitly declares image input. */
export function isCodexImageCapableRoute(route: CodexImageRoute | undefined): boolean {
	if (route === undefined) return false;
	const provider = route.provider;
	if (provider === undefined || !(CODEX_IMAGE_CAPABLE_PROVIDERS as readonly string[]).includes(provider)) {
		return false;
	}
	return route.inputModalities?.includes("image") === true;
}

export function assertCodexImageCapableRoute(route: CodexImageRoute | undefined): void {
	if (!isCodexImageCapableRoute(route)) {
		throw new LlmError("Codex image tools require an image-capable Codex OAuth route", "UNSUPPORTED_CONTENT");
	}
}

function isImageAttachmentRef(value: unknown): value is ImageAttachmentRef {
	return (
		isRecord(value) &&
		typeof value["attachmentId"] === "string" &&
		typeof value["mediaType"] === "string" &&
		typeof value["bytes"] === "number" &&
		typeof value["width"] === "number" &&
		typeof value["height"] === "number"
	);
}

/**
 * Collect canonical image attachment refs visibly present in current session
 * message content. Nested tool-results and arbitrary objects are ignored.
 */
export function collectCanonicalImageRefs(messages: readonly CodexDerivedMessage[]): Map<string, ImageAttachmentRef> {
	const refs = new Map<string, ImageAttachmentRef>();
	for (const message of messages) {
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!isRecord(block) || block["type"] !== "image" || !isImageAttachmentRef(block["attachment"])) continue;
			const ref = block["attachment"];
			const id = String(ref.attachmentId);
			if (!refs.has(id)) refs.set(id, ref);
		}
	}
	return refs;
}

function normalizeImageId(value: string): string {
	return value.startsWith("image:") ? value.slice("image:".length) : value;
}

/**
 * Resolve edit IDs only against canonical refs visibly present in `deriveMessages()`.
 * Unknown IDs, HTTP URLs, nested-only objects, and more than
 * {@link CODEX_IMAGE_MAX_REFERENCES} are rejected (fail closed).
 */
export function resolveSessionImageRefs(
	deriveMessages: () => readonly CodexDerivedMessage[],
	imageIds: readonly string[],
): ImageAttachmentRef[] {
	if (imageIds.length === 0) {
		throw new LlmError("Codex image edit requires at least one session image id", "INVALID_ARGS");
	}
	if (imageIds.length > CODEX_IMAGE_MAX_REFERENCES) {
		throw new LlmError(
			`Codex image edit accepts at most ${String(CODEX_IMAGE_MAX_REFERENCES)} session images`,
			"INVALID_ARGS",
		);
	}
	const authorized = collectCanonicalImageRefs(deriveMessages());
	const resolved: ImageAttachmentRef[] = [];
	const seen = new Set<string>();
	for (const raw of imageIds) {
		if (/^https?:\/\//iu.test(raw)) {
			throw new LlmError("Codex image edit does not accept HTTP(S) image URLs", "INVALID_ARGS");
		}
		const id = normalizeImageId(raw.trim());
		if (id.length === 0) {
			throw new LlmError("Codex image edit received an empty image id", "INVALID_ARGS");
		}
		const ref = authorized.get(id);
		if (ref === undefined) {
			throw new LlmError(
				`Image ${JSON.stringify(raw)} is not a canonical attachment in the current session`,
				"INVALID_ARGS",
			);
		}
		if (seen.has(id)) continue;
		seen.add(id);
		resolved.push(ref);
	}
	return resolved;
}

function ascii(data: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...data.slice(start, end));
}

export function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined {
	if (
		data.length >= 8 &&
		data[0] === 0x89 &&
		data[1] === 0x50 &&
		data[2] === 0x4e &&
		data[3] === 0x47 &&
		data[4] === 0x0d &&
		data[5] === 0x0a &&
		data[6] === 0x1a &&
		data[7] === 0x0a
	) {
		return "image/png";
	}
	if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
	if (data.length >= 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "image/webp";
	if (data.length >= 6 && (ascii(data, 0, 6) === "GIF87a" || ascii(data, 0, 6) === "GIF89a")) return "image/gif";
	return undefined;
}

function normalizeBase64Payload(value: string): string | undefined {
	const stripped = value.replace(/\s+/gu, "");
	const payload = stripped.startsWith("data:") ? (stripped.split(",", 2)[1] ?? "") : stripped;
	if (payload.length === 0) return undefined;
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(payload)) return undefined;
	return payload;
}

/** Encoded-size precheck. `undefined` means the payload is not valid base64/base64url. */
export function estimateDecodedBase64Bytes(value: string): number | undefined {
	const payload = normalizeBase64Payload(value);
	if (payload === undefined) return undefined;
	const unpadded = payload.replace(/=+$/u, "");
	if (unpadded.length % 4 === 1) return undefined;
	return Math.floor((unpadded.length * 3) / 4);
}

/** Decode standard base64 or base64url. Rejects invalid alphabets and length mismatches. */
export function decodeImageBase64(value: string): Uint8Array | undefined {
	const payload = normalizeBase64Payload(value);
	if (payload === undefined) return undefined;
	const estimated = estimateDecodedBase64Bytes(payload);
	if (estimated === undefined || estimated === 0) return undefined;
	const normalized = payload.replace(/-/gu, "+").replace(/_/gu, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	try {
		const decoded = Buffer.from(padded, "base64");
		if (decoded.byteLength !== estimated) return undefined;
		return new Uint8Array(decoded);
	} catch {
		return undefined;
	}
}

function dataUrl(stored: StoredImageAttachment): string {
	return `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString("base64")}`;
}

function extensionFor(mediaType: ImageMediaType): string {
	return mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length);
}

function enumValue<const T extends string>(value: T | undefined, allowed: readonly T[], fallback: T, field: string): T {
	if (value === undefined) return fallback;
	if (!allowed.includes(value)) {
		throw new LlmError(`${field} must be one of ${allowed.join(", ")}`, "INVALID_ARGS");
	}
	return value;
}

function imageEnvelopeLimit(maxImageBytes: number, n: number): number {
	return Math.ceil(maxImageBytes / 3) * 4 * Math.max(1, n) + 128 * 1024;
}

interface PreparedImageRequest {
	readonly operation: "generate" | "edit";
	readonly n: number;
	readonly body: Record<string, unknown>;
	readonly references: readonly ImageAttachmentRef[];
	readonly storedReferences: readonly StoredImageAttachment[];
}

async function prepareRequest(
	options: CodexImageControllerOptions,
	input: CodexImageGenerateInput,
	imageIds: readonly string[] | undefined,
	signal?: AbortSignal,
): Promise<PreparedImageRequest> {
	assertCodexImageCapableRoute(options.session.route);
	const prompt = input.prompt.trim();
	if (prompt.length === 0) {
		throw new LlmError("Codex image generation requires a non-empty prompt", "INVALID_ARGS");
	}
	const n = input.n === undefined ? 1 : input.n;
	if (!Number.isSafeInteger(n) || n < 1 || n > MAX_GENERATED) {
		throw new LlmError(`Codex image n must be an integer from 1 through ${String(MAX_GENERATED)}`, "INVALID_ARGS");
	}
	const size = enumValue(input.size, CODEX_IMAGE_SIZES, CODEX_IMAGE_AUTO, "size");
	const quality = enumValue(input.quality, CODEX_IMAGE_QUALITIES, CODEX_IMAGE_AUTO, "quality");
	const background = enumValue(input.background, CODEX_IMAGE_BACKGROUNDS, CODEX_IMAGE_AUTO, "background");
	const references =
		imageIds === undefined ? [] : resolveSessionImageRefs(() => options.session.deriveMessages(), imageIds);
	if (references.length > options.attachments.imageLimits.maxImagesPerMessage) {
		throw new LlmError("Codex image edit exceeds the deployment image-count limit", "INVALID_ARGS");
	}
	const storedReferences: StoredImageAttachment[] = [];
	let totalBytes = 0;
	for (const ref of references) {
		const stored = await options.attachments.readImage(ref, signal);
		if (totalBytes + stored.data.byteLength > options.attachments.imageLimits.maxMessageImageBytes) {
			throw new LlmError("Codex image edit exceeds the deployment total image-byte limit", "INVALID_ARGS");
		}
		totalBytes += stored.data.byteLength;
		storedReferences.push(stored);
	}
	const body: Record<string, unknown> = {
		prompt,
		model: CODEX_IMAGE_MODEL,
		n,
		size,
		quality,
		background,
		response_format: CODEX_IMAGE_RESPONSE_FORMAT,
	};
	if (storedReferences.length > 0) {
		body["images"] = storedReferences.map((stored) => ({ image_url: dataUrl(stored) }));
	}
	return {
		operation: storedReferences.length === 0 ? "generate" : "edit",
		n,
		body,
		references,
		storedReferences,
	};
}

async function persistEnvelope(
	options: CodexImageControllerOptions,
	prepared: PreparedImageRequest,
	payload: unknown,
	createdAt: number,
): Promise<CodexImageResult> {
	if (!isRecord(payload) || !Array.isArray(payload["data"])) {
		throw new LlmError("Codex image response was missing a data array", "SERVER");
	}
	const warnings: CodexImageWarning[] = [];
	const images: ImageAttachmentRef[] = [];
	const limits = options.attachments.imageLimits;
	const referenceBytes = prepared.storedReferences.reduce((sum, item) => sum + item.data.byteLength, 0);
	let acceptedBytes = referenceBytes;
	const maxGenerated = Math.max(0, limits.maxImagesPerMessage - prepared.references.length);
	for (const [index, item] of payload["data"].entries()) {
		if (images.length >= maxGenerated) {
			warnings.push({
				index,
				code: "IMAGE_POLICY_REJECTED",
				message: "The item exceeded the deployment image-count limit.",
			});
			continue;
		}
		if (!isRecord(item) || typeof item["b64_json"] !== "string" || item["b64_json"].length === 0) {
			warnings.push({ index, code: "IMAGE_DATA_MISSING", message: "Only b64_json image items are accepted." });
			continue;
		}
		const encoded = item["b64_json"];
		const estimated = estimateDecodedBase64Bytes(encoded);
		if (estimated === undefined || estimated > limits.maxImageBytes) {
			warnings.push({
				index,
				code: "IMAGE_DATA_INVALID",
				message: "The response item was not valid bounded base64 image data.",
			});
			continue;
		}
		const data = decodeImageBase64(encoded);
		if (data === undefined || data.byteLength > limits.maxImageBytes) {
			warnings.push({
				index,
				code: "IMAGE_DATA_INVALID",
				message: "The response item was not valid bounded base64 image data.",
			});
			continue;
		}
		if (acceptedBytes + data.byteLength > limits.maxMessageImageBytes) {
			warnings.push({
				index,
				code: "IMAGE_POLICY_REJECTED",
				message: "The item exceeded the deployment total image-byte limit.",
			});
			continue;
		}
		const mediaType = detectImageMediaType(data);
		if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) {
			warnings.push({
				index,
				code: "IMAGE_MEDIA_INVALID",
				message: "The decoded item was not a supported raster image.",
			});
			continue;
		}
		const input: SaveImageAttachment = {
			data,
			mediaType,
			name: `codex-image-${String(createdAt)}-${String(index + 1)}.${extensionFor(mediaType)}`,
		};
		try {
			await options.attachments.validateImage(input);
			images.push(await options.attachments.saveImage(input));
			acceptedBytes += data.byteLength;
		} catch {
			warnings.push({
				index,
				code: "IMAGE_POLICY_REJECTED",
				message: "The decoded image failed the deployment media policy.",
			});
		}
	}
	if (images.length === 0) {
		throw new LlmError("Codex image response contained no usable b64_json image", "EMPTY_RESPONSE");
	}
	return {
		operation: prepared.operation,
		model: CODEX_IMAGE_MODEL,
		images,
		references: prepared.references,
		warnings,
	};
}

/** Factory for generate/edit controllers. Parent registers tools only when the feature is enabled. */
export function createCodexImageController(options: CodexImageControllerOptions): CodexImageController {
	const http =
		options.http ??
		createCodexHttpClient({
			auth: options.auth,
			...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
			...(options.originator === undefined ? {} : { originator: options.originator }),
			...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
			...(options.sleep === undefined ? {} : { sleep: options.sleep }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
	const now = options.now ?? Date.now;

	const dispatch = async (
		input: CodexImageGenerateInput,
		imageIds: readonly string[] | undefined,
		signal?: AbortSignal,
	): Promise<CodexImageResult> => {
		const prepared = await prepareRequest(options, input, imageIds, signal);
		const payload = await http.requestJson({
			url: prepared.operation === "generate" ? CODEX_IMAGE_GENERATION_URL : CODEX_IMAGE_EDIT_URL,
			method: "POST",
			body: prepared.body,
			maxBytes: imageEnvelopeLimit(options.attachments.imageLimits.maxImageBytes, prepared.n),
			...(signal === undefined ? {} : { signal }),
		});
		return persistEnvelope(options, prepared, payload, now());
	};

	return {
		generate: (input, signal) => dispatch(input, undefined, signal),
		edit: (input, signal) => dispatch(input, input.imageIds, signal),
	};
}

/**
 * Official xAI Imagine client. Talks only to https://api.x.ai with a
 * per-operation API-key resolver. Generated remote media is fetched under a
 * pinned HTTPS/host/DNS allowlist and persisted locally; results never include
 * a signed upstream URL.
 * @module dsh-coding-subscription-oauth/grok-imagine
 */

import { Buffer } from "node:buffer";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import {
	assertTrustedImagineAuthz,
	IMAGINE_MEDIA_ROUTE_PREFIX,
	imagineMediaPath,
	isTrustedImaginePeer,
	type MediaArtifactMeta,
	type MediaStore,
	type MediaStoreVideoType,
	type TrustedImagineAuthz,
} from "./media-store.ts";
import { safeMessage } from "./redact.ts";

export const XAI_API_ORIGIN = "https://api.x.ai";
export const GROK_IMAGINE_IMAGE_PATH = "/v1/images/generations";
export const GROK_IMAGINE_VIDEO_START_PATH = "/v1/videos/generations";
export const GROK_IMAGINE_IMAGE_MODEL = "grok-imagine-image-2.0";
export const GROK_IMAGINE_VIDEO_MODEL = "grok-imagine-video-1.5";

export const GROK_IMAGINE_IMAGE_TOOL = "grok_imagine_image";
export const GROK_IMAGINE_VIDEO_TOOL = "grok_imagine_video";
export const GROK_IMAGINE_VIDEO_STATUS_TOOL = "grok_imagine_video_status";

export const IMAGINE_IMAGE_ROUTE_PREFIX = "/plugins/dsh-coding-subscription-oauth/imagine/images/";

/** Frozen xAI output hosts. Callers cannot widen this list. */
export const XAI_OUTPUT_HOSTS = ["imgen.x.ai", "videogen.x.ai", "vidgen.x.ai"] as const;

export const IMAGINE_IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
export const IMAGINE_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const IMAGINE_IMAGE_ASPECT_RATIOS = [
	"1:1",
	"3:4",
	"4:3",
	"9:16",
	"16:9",
	"2:3",
	"3:2",
	"9:19.5",
	"19.5:9",
	"9:20",
	"20:9",
	"1:2",
	"2:1",
	"auto",
] as const;
export const IMAGINE_VIDEO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const IMAGINE_VIDEO_MIN_DURATION_SECONDS = 1;
export const IMAGINE_VIDEO_MAX_DURATION_SECONDS = 15;
export const IMAGINE_IMAGE_MAX_N = 10;

/**
 * Hard ceilings enforced both at the tool boundary (consumer guard) and inside
 * the Imagine client (defence-in-depth). The prompt ceiling uses UTF-16 code
 * units because that is what the JSON wire format bounds; the image-id arrays
 * are bounded so a runaway caller cannot exhaust the bounded body reader.
 */
export const IMAGINE_PROMPT_MAX_LENGTH = 4000;
export const IMAGINE_IMAGE_IDS_MIN = 1;
export const IMAGINE_IMAGE_IDS_MAX = 5;

export const DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_API_TIMEOUT_MS = 30_000;
export const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
export const DEFAULT_VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_API_JSON_MAX_BYTES = 1024 * 1024;
export const MAX_CACHED_VIDEO_JOBS = 256;

export type ImagineOperation = "image.generate" | "video.start" | "video.status";
export type ImagineImageResolution = (typeof IMAGINE_IMAGE_RESOLUTIONS)[number];
export type ImagineVideoResolution = (typeof IMAGINE_VIDEO_RESOLUTIONS)[number];
export type ImagineImageAspectRatio = (typeof IMAGINE_IMAGE_ASPECT_RATIOS)[number];
export type ImagineVideoAspectRatio = (typeof IMAGINE_VIDEO_ASPECT_RATIOS)[number];

export type ImagineApiKeyResolver = (operation: ImagineOperation) => Promise<string>;

export type ImagineFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ImagineDnsLookup = (hostname: string) => Promise<readonly string[]>;

export type ImagineImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface ImagineMediaHopRequest {
	timeoutMs: number;
	maxBytes: number;
	accept: string;
	signal?: AbortSignal;
}

export interface ImagineMediaHop {
	status: number;
	location?: string;
	contentType?: string;
	data?: Uint8Array;
}

/** Single-hop GET. Must not follow redirects or attach credentials. */
export interface ImagineMediaTransport {
	get(url: URL, request: ImagineMediaHopRequest): Promise<ImagineMediaHop>;
}

export interface ImagineDownloadRequest {
	url: string;
	timeoutMs: number;
	maxBytes: number;
	accept: string;
	signal?: AbortSignal;
}

export interface ImagineDownloadResult {
	data: Uint8Array;
	contentType?: string;
}

/** Full download including redirect revalidation. Production default is pinned. */
export interface ImagineDownloader {
	download(request: ImagineDownloadRequest): Promise<ImagineDownloadResult>;
}

export type GrokImagineErrorCode =
	| "MISSING_CREDENTIAL"
	| "AUTH"
	| "QUOTA"
	| "RATE_LIMIT"
	| "SSRF"
	| "INVALID_INPUT"
	| "UPSTREAM"
	| "TIMEOUT"
	| "MEDIA";

export class GrokImagineError extends Error {
	readonly code: GrokImagineErrorCode;
	readonly status?: number;

	constructor(code: GrokImagineErrorCode, message: string, options?: { cause?: unknown; status?: number }) {
		super(message, options);
		this.name = "GrokImagineError";
		this.code = code;
		if (options?.status !== undefined) this.status = options.status;
	}
}

export interface ImagineImageAttachmentRef {
	attachmentId: string;
	mediaType: ImagineImageMediaType;
	bytes: number;
	width: number;
	height: number;
	name?: string;
}

export interface ImagineImageLimits {
	maxImageBytes?: number;
	mediaTypes?: readonly string[];
}

/** Structural AttachmentStore surface used by Imagine. */
export interface ImagineAttachmentStore {
	imageLimits?: ImagineImageLimits;
	saveImage(input: {
		data: Uint8Array;
		mediaType: ImagineImageMediaType;
		name?: string;
	}): Promise<ImagineImageAttachmentRef>;
	readImage?(
		ref: ImagineImageAttachmentRef,
		signal?: AbortSignal,
	): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }>;
}

export interface GenerateImagineImageInput {
	prompt: string;
	model?: string;
	n?: number;
	aspectRatio?: string;
	resolution?: string;
	name?: string;
}

export interface ImagineImageResult {
	model: string;
	images: readonly ImaginePersistedImage[];
	attachment: ImagineImageAttachmentRef;
	path: string;
}

export interface ImaginePersistedImage {
	attachment: ImagineImageAttachmentRef;
	path: string;
}

export interface StartImagineVideoInput {
	prompt: string;
	model?: string;
	duration?: number;
	aspectRatio?: string;
	resolution?: string;
	name?: string;
}

export interface ImagineVideoStartResult {
	model: string;
	requestId: string;
	status: "pending";
}

export type ImagineVideoJobStatus = "pending" | "completed" | "failed";

export interface ImagineVideoStatusResult {
	requestId: string;
	status: ImagineVideoJobStatus;
	artifact?: MediaArtifactMeta;
	path?: string;
	error?: string;
}

export interface GrokImagineClientOptions {
	resolveApiKey: ImagineApiKeyResolver;
	attachments: ImagineAttachmentStore;
	media: MediaStore;
	/** API-only test seam. Never used for media and never a production default. */
	fetch?: ImagineFetch;
	/** Media downloads. Production default pins DNS at connect time via undici. */
	downloader?: ImagineDownloader;
	now?: () => number;
	imageDownloadTimeoutMs?: number;
	videoDownloadTimeoutMs?: number;
	apiTimeoutMs?: number;
	maxRedirects?: number;
	imageMaxBytes?: number;
	apiJsonMaxBytes?: number;
}

export interface ImagineImageDownloadHeaders {
	"Content-Type": string;
	"Content-Length": string;
	"Content-Disposition": string;
	"Cache-Control": string;
	"X-Content-Type-Options": "nosniff";
}

export interface ImagineImageDownloadView {
	ref: ImagineImageAttachmentRef;
	body: Uint8Array;
	headers: ImagineImageDownloadHeaders;
}

/**
 * Safe official-xAI request-id pattern: ASCII letters, digits, dashes, and
 * underscores. Limited to 256 characters. Public boundary validator.
 */
const VIDEO_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const FROZEN_OUTPUT_HOSTS = new Set<string>(XAI_OUTPUT_HOSTS);
const IMAGE_RESOLUTION_SET = new Set<string>(IMAGINE_IMAGE_RESOLUTIONS);
const VIDEO_RESOLUTION_SET = new Set<string>(IMAGINE_VIDEO_RESOLUTIONS);
const IMAGE_ASPECT_SET = new Set<string>(IMAGINE_IMAGE_ASPECT_RATIOS);
const VIDEO_ASPECT_SET = new Set<string>(IMAGINE_VIDEO_ASPECT_RATIOS);

const blockedNetworks = new BlockList();
blockedNetworks.addSubnet("0.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("10.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("100.64.0.0", 10, "ipv4");
blockedNetworks.addSubnet("127.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("169.254.0.0", 16, "ipv4");
blockedNetworks.addSubnet("172.16.0.0", 12, "ipv4");
blockedNetworks.addSubnet("192.0.0.0", 24, "ipv4");
blockedNetworks.addSubnet("192.0.2.0", 24, "ipv4");
blockedNetworks.addSubnet("192.88.99.0", 24, "ipv4");
blockedNetworks.addSubnet("192.168.0.0", 16, "ipv4");
blockedNetworks.addSubnet("198.18.0.0", 15, "ipv4");
blockedNetworks.addSubnet("198.51.100.0", 24, "ipv4");
blockedNetworks.addSubnet("203.0.113.0", 24, "ipv4");
blockedNetworks.addSubnet("224.0.0.0", 4, "ipv4");
blockedNetworks.addSubnet("240.0.0.0", 4, "ipv4");
blockedNetworks.addSubnet("::", 128, "ipv6");
blockedNetworks.addSubnet("::1", 128, "ipv6");
blockedNetworks.addSubnet("::", 96, "ipv6");
blockedNetworks.addSubnet("64:ff9b::", 96, "ipv6");
blockedNetworks.addSubnet("64:ff9b:1::", 48, "ipv6");
blockedNetworks.addSubnet("100::", 64, "ipv6");
blockedNetworks.addSubnet("2001::", 32, "ipv6");
blockedNetworks.addSubnet("2001:2::", 48, "ipv6");
blockedNetworks.addSubnet("2001:db8::", 32, "ipv6");
blockedNetworks.addSubnet("2002::", 16, "ipv6");
blockedNetworks.addSubnet("3fff::", 20, "ipv6");
blockedNetworks.addSubnet("5f00::", 16, "ipv6");
blockedNetworks.addSubnet("fc00::", 7, "ipv6");
blockedNetworks.addSubnet("fe80::", 10, "ipv6");
blockedNetworks.addSubnet("ff00::", 8, "ipv6");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactImagineMessage(error: unknown): string {
	const withoutRemoteUrls = (error instanceof Error ? error.message : String(error)).replace(
		/https?:\/\/[^\s"'<>\\]+/giu,
		"[redacted-url]",
	);
	return safeMessage(withoutRemoteUrls);
}

function dottedFromWords(high: number, low: number): string {
	return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function parseIPv6Groups(address: string): number[] | undefined {
	const bare = address.toLowerCase().split("%", 1)[0] ?? "";
	let normalized = bare;
	const v4tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bare);
	if (v4tail) {
		const ipv4 = v4tail[1] ?? "";
		if (isIP(ipv4) !== 4) return undefined;
		const octets = ipv4.split(".").map((part) => Number(part));
		if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
			return undefined;
		}
		const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
		const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
		normalized = `${bare.slice(0, v4tail.index + 1)}${high}:${low}`;
	}
	const sides = normalized.split("::");
	if (sides.length > 2) return undefined;
	const parseSide = (side: string | undefined): number[] | undefined => {
		if (side === undefined || side === "") return [];
		const groups = side.split(":").map((group) => Number.parseInt(group, 16));
		if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined;
		return groups;
	};
	if (sides.length === 1) {
		const groups = parseSide(sides[0]);
		return groups?.length === 8 ? groups : undefined;
	}
	const head = parseSide(sides[0]);
	const tail = parseSide(sides[1]);
	if (head === undefined || tail === undefined || head.length + tail.length > 8) return undefined;
	return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function embeddedIPv4s(address: string): string[] {
	const groups = parseIPv6Groups(address);
	if (groups === undefined) return [];
	const found = new Set<string>();
	const last32 = dottedFromWords(groups[6] ?? 0, groups[7] ?? 0);
	const headZero = groups.slice(0, 5).every((group) => group === 0);
	if (headZero && ((groups[5] ?? 0) === 0xffff || (groups[5] ?? 0) === 0)) {
		found.add(last32);
	}
	if ((groups[0] ?? 0) === 0x2002) {
		found.add(dottedFromWords(groups[1] ?? 0, groups[2] ?? 0));
	}
	if ((groups[0] ?? 0) === 0x2001 && (groups[1] ?? 0) === 0) {
		found.add(dottedFromWords(groups[2] ?? 0, groups[3] ?? 0));
		found.add(dottedFromWords((groups[6] ?? 0) ^ 0xffff, (groups[7] ?? 0) ^ 0xffff));
	}
	if ((groups[0] ?? 0) === 0x64 && (groups[1] ?? 0) === 0xff9b) {
		found.add(last32);
	}
	return [...found];
}

function ipv4Mapped(address: string): string | undefined {
	const lower = address.toLowerCase();
	if (!lower.startsWith("::ffff:")) return undefined;
	const rest = lower.slice("::ffff:".length);
	if (isIP(rest) === 4) return rest;
	const parts = rest.split(":");
	if (parts.length !== 2) return undefined;
	const high = Number.parseInt(parts[0] ?? "", 16);
	const low = Number.parseInt(parts[1] ?? "", 16);
	if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low < 0 || high > 0xffff || low > 0xffff) {
		return undefined;
	}
	return dottedFromWords(high, low);
}

/** True when an address is loopback, private, reserved, documentation, or an embedded special form. */
export function isBlockedIp(address: string): boolean {
	if (isIP(address) === 0) return true;
	if (isIP(address) === 4) return blockedNetworks.check(address, "ipv4");
	if (blockedNetworks.check(address, "ipv6")) return true;
	if (parseIPv6Groups(address) === undefined) return true;
	const mapped = ipv4Mapped(address);
	if (mapped !== undefined && isBlockedIp(mapped)) return true;
	for (const embedded of embeddedIPv4s(address)) {
		if (isIP(embedded) === 4 && blockedNetworks.check(embedded, "ipv4")) return true;
	}
	return false;
}

function normalizeHostname(hostname: string): string {
	return hostname.trim().toLowerCase().replace(/\.$/u, "");
}

function isBlockedHostname(hostname: string): boolean {
	const host = normalizeHostname(hostname);
	return (
		host === "localhost" ||
		host === "localhost.localdomain" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".intranet")
	);
}

export function isAllowlistedImagineHost(hostname: string): boolean {
	return FROZEN_OUTPUT_HOSTS.has(normalizeHostname(hostname));
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

export { IMAGINE_MEDIA_ROUTE_PREFIX, imagineMediaPath, isTrustedImaginePeer };

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

function parseContentType(value: string | null | undefined): string | undefined {
	if (value === null || value === undefined || value.trim() === "") return undefined;
	return value.split(";", 1)[0]?.trim().toLowerCase();
}

export async function defaultImagineLookup(hostname: string): Promise<readonly string[]> {
	const records = await dnsLookup(hostname, { all: true, verbatim: true });
	return records.map((record) => record.address);
}

export async function assertSafeRemoteMediaUrl(raw: string, lookup: ImagineDnsLookup): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new GrokImagineError("SSRF", "generated media URL is not a valid absolute URL");
	}
	if (url.protocol !== "https:") {
		throw new GrokImagineError("SSRF", "generated media URL must be HTTPS");
	}
	if (url.username !== "" || url.password !== "") {
		throw new GrokImagineError("SSRF", "generated media URL must not include credentials");
	}
	if (url.port !== "" && url.port !== "443") {
		throw new GrokImagineError("SSRF", "generated media URL must use port 443");
	}
	const host = normalizeHostname(url.hostname);
	if (host === "" || isBlockedHostname(host) || isIP(host) !== 0) {
		throw new GrokImagineError("SSRF", "generated media host is not allowed");
	}
	if (!isAllowlistedImagineHost(host)) {
		throw new GrokImagineError("SSRF", "generated media host is not an allowlisted xAI output host");
	}
	const addresses = [...(await lookup(host))];
	if (addresses.length === 0) {
		throw new GrokImagineError("SSRF", "generated media host did not resolve");
	}
	for (const address of addresses) {
		if (isBlockedIp(address)) {
			throw new GrokImagineError("SSRF", "generated media host resolved to a blocked address");
		}
	}
	return url;
}

async function resolvePublicAddresses(hostname: string, lookup: ImagineDnsLookup): Promise<readonly string[]> {
	const host = normalizeHostname(hostname);
	if (host === "" || isBlockedHostname(host) || isIP(host) !== 0) {
		throw new GrokImagineError("SSRF", "host is not allowed");
	}
	const addresses = [...(await lookup(host))];
	if (addresses.length === 0) throw new GrokImagineError("SSRF", "host did not resolve");
	for (const address of addresses) {
		if (isBlockedIp(address)) throw new GrokImagineError("SSRF", "host resolved to a blocked address");
	}
	return addresses;
}

function createPinnedAgent(hostname: string, addresses: readonly string[]): Agent {
	const expected = normalizeHostname(hostname);
	const records = addresses.map((address) => {
		const family = isIP(address);
		if (family !== 4 && family !== 6) {
			throw new GrokImagineError("SSRF", "pinned address is not a valid IP");
		}
		return { address, family };
	});
	const lookup = (
		host: string,
		options: { all?: boolean },
		callback: (error: Error | null, address?: unknown, family?: number) => void,
	): void => {
		if (normalizeHostname(host) !== expected) {
			callback(new GrokImagineError("SSRF", "refusing DNS lookup for an unpinned host"));
			return;
		}
		if (options.all === true) {
			callback(
				null,
				records.map((record) => ({ address: record.address, family: record.family })),
			);
			return;
		}
		const first = records[0];
		if (first === undefined) {
			callback(new GrokImagineError("SSRF", "no pinned addresses"));
			return;
		}
		callback(null, first.address, first.family);
	};
	return new Agent({
		connect: {
			autoSelectFamily: false,
			// undici's lookup typing is the single-address Node overload; we also
			// handle { all: true } at runtime so Happy Eyeballs cannot re-query DNS.
			lookup: lookup as never,
		},
	});
}

interface LimitedBodyReader {
	read(): Promise<{ done: boolean; value?: Uint8Array }>;
	cancel(): Promise<unknown>;
}

interface LimitedBodyResponse {
	readonly status: number;
	readonly headers: { get(name: string): string | null };
	readonly body: unknown | null;
	arrayBuffer(): Promise<ArrayBuffer>;
}

async function readLimitedBody(
	response: LimitedBodyResponse,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const throwIfAborted = (): void => {
		if (signal?.aborted === true) {
			throw new GrokImagineError("TIMEOUT", "Imagine response body read was aborted", { cause: signal.reason });
		}
	};
	throwIfAborted();
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new GrokImagineError("MEDIA", `remote body exceeds the ${maxBytes} byte ceiling`);
	}
	if (response.body === null) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		throwIfAborted();
		if (buffer.byteLength > maxBytes) {
			throw new GrokImagineError("MEDIA", `remote body exceeds the ${maxBytes} byte ceiling`);
		}
		return buffer;
	}
	if (
		typeof response.body !== "object" ||
		response.body === null ||
		!("getReader" in response.body) ||
		typeof response.body.getReader !== "function"
	) {
		throw new GrokImagineError("MEDIA", "remote body is not a readable byte stream");
	}
	const reader = response.body.getReader() as LimitedBodyReader;
	const chunks: Uint8Array[] = [];
	let size = 0;
	const onAbort = (): void => {
		void reader.cancel().catch(() => undefined);
	};
	if (signal?.aborted === true) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	try {
		while (true) {
			throwIfAborted();
			const { done, value } = await reader.read();
			throwIfAborted();
			if (done) break;
			if (value === undefined) continue;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new GrokImagineError("MEDIA", `remote body exceeds the ${maxBytes} byte ceiling`);
			}
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function mapUpstreamStatus(status: number, bodyText: string): GrokImagineError {
	const detail = redactImagineMessage(bodyText.trim().slice(0, 300));
	if (status === 401) {
		return new GrokImagineError("AUTH", `xAI rejected the Imagine API key${detail === "" ? "" : `: ${detail}`}`, {
			status,
		});
	}
	if (status === 403) {
		const message = `current xAI credentials cannot use Imagine${detail === "" ? "" : `: ${detail}`}`;
		return new GrokImagineError("QUOTA", message, { status });
	}
	if (status === 429) {
		const message = `xAI Imagine rate-limited the request${detail === "" ? "" : `: ${detail}`}`;
		return new GrokImagineError("RATE_LIMIT", message, { status });
	}
	const message = `xAI Imagine request failed (${status})${detail === "" ? "" : `: ${detail}`}`;
	return new GrokImagineError("UPSTREAM", message, { status });
}

export function createPinnedMediaTransport(lookup: ImagineDnsLookup = defaultImagineLookup): ImagineMediaTransport {
	return {
		async get(url, request) {
			const validated = await assertSafeRemoteMediaUrl(url.href, lookup);
			const addresses = await resolvePublicAddresses(validated.hostname, lookup);
			const agent = createPinnedAgent(validated.hostname, addresses);
			const signal = requestSignal(request.signal, request.timeoutMs);
			try {
				const response = await undiciFetch(validated, {
					method: "GET",
					redirect: "manual",
					dispatcher: agent,
					signal,
					headers: { accept: request.accept },
				});
				if (response.status >= 300 && response.status < 400) {
					const location = response.headers.get("location");
					return location === null || location.trim() === ""
						? { status: response.status }
						: { status: response.status, location };
				}
				if (!response.ok) {
					const text = new TextDecoder().decode(await readLimitedBody(response, 4096, signal));
					throw mapUpstreamStatus(response.status, text);
				}
				const data = await readLimitedBody(response, request.maxBytes, signal);
				const contentType = parseContentType(response.headers.get("content-type"));
				if (contentType === undefined) return { status: response.status, data };
				return { status: response.status, contentType, data };
			} catch (error) {
				if (error instanceof GrokImagineError) throw error;
				const name = error instanceof Error ? error.name : "";
				if (name === "TimeoutError" || name === "AbortError") {
					throw new GrokImagineError("TIMEOUT", "Imagine media download timed out", { cause: error });
				}
				throw new GrokImagineError("MEDIA", `Imagine media download failed (${redactImagineMessage(error)})`, {
					cause: error,
				});
			} finally {
				await agent.close().catch(() => undefined);
			}
		},
	};
}

export function createPinnedApiFetch(
	lookup: ImagineDnsLookup = defaultImagineLookup,
	maxBytes = DEFAULT_API_JSON_MAX_BYTES,
): ImagineFetch {
	return async (input, init) => {
		const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : String(input));
		if (url.origin !== XAI_API_ORIGIN || url.protocol !== "https:") {
			throw new GrokImagineError("SSRF", "Imagine API URL escaped https://api.x.ai");
		}
		if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") {
			throw new GrokImagineError("INVALID_INPUT", "Imagine API transport accepts only a JSON string body");
		}
		const addresses = await resolvePublicAddresses(url.hostname, lookup);
		const agent = createPinnedAgent(url.hostname, addresses);
		const signal = init?.signal ?? undefined;
		try {
			const requestHeaders = init?.headers === undefined ? undefined : Object.fromEntries(new Headers(init.headers));
			const response = await undiciFetch(url, {
				...(init?.method === undefined ? {} : { method: init.method }),
				...(init?.body === undefined || init.body === null ? {} : { body: init.body }),
				...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
				...(signal === undefined ? {} : { signal }),
				dispatcher: agent,
				redirect: "error",
			});
			const data = await readLimitedBody(response, maxBytes, signal);
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});
			return new Response(Uint8Array.from(data).buffer, {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders,
			});
		} catch (error) {
			if (error instanceof GrokImagineError) throw error;
			const name = error instanceof Error ? error.name : "";
			if (name === "TimeoutError" || name === "AbortError") {
				throw new GrokImagineError("TIMEOUT", "Imagine API request timed out", { cause: error });
			}
			throw new GrokImagineError("UPSTREAM", `Imagine API request failed (${redactImagineMessage(error)})`, {
				cause: error,
			});
		} finally {
			await agent.close().catch(() => undefined);
		}
	};
}

export async function downloadRemoteImagineMedia(
	initialUrl: string,
	transport: ImagineMediaTransport,
	options: {
		lookup: ImagineDnsLookup;
		timeoutMs: number;
		maxBytes: number;
		accept: string;
		maxRedirects: number;
		signal?: AbortSignal;
	},
): Promise<ImagineDownloadResult> {
	let current = initialUrl;
	for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
		const url = await assertSafeRemoteMediaUrl(current, options.lookup);
		const result = await transport.get(url, {
			timeoutMs: options.timeoutMs,
			maxBytes: options.maxBytes,
			accept: options.accept,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		if (result.status >= 300 && result.status < 400) {
			if (result.location === undefined || result.location.trim() === "") {
				throw new GrokImagineError("SSRF", "Imagine media redirect was missing a Location header");
			}
			try {
				current = new URL(result.location, url).href;
			} catch {
				throw new GrokImagineError("SSRF", "Imagine media redirect Location is not a valid URL");
			}
			continue;
		}
		if (result.data === undefined) {
			throw new GrokImagineError("MEDIA", "Imagine media download returned no body");
		}
		if (result.contentType === undefined) return { data: result.data };
		return { data: result.data, contentType: result.contentType };
	}
	throw new GrokImagineError("SSRF", "Imagine media download exceeded the redirect limit");
}

export function createPinnedImagineDownloader(
	options: { lookup?: ImagineDnsLookup; maxRedirects?: number } = {},
): ImagineDownloader {
	const lookup = options.lookup ?? defaultImagineLookup;
	const transport = createPinnedMediaTransport(lookup);
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	return {
		download: (request) =>
			downloadRemoteImagineMedia(request.url, transport, {
				lookup,
				timeoutMs: request.timeoutMs,
				maxBytes: request.maxBytes,
				accept: request.accept,
				maxRedirects,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			}),
	};
}

/**
 * Test-only adapter around an injected fetch. Ordinary mock fetch is not
 * production-safe: it cannot pin DNS at connect time.
 */
export function createImagineDownloaderFromFetch(
	fetchImpl: ImagineFetch,
	options: { trustedTestTransport: true; lookup?: ImagineDnsLookup; maxRedirects?: number },
): ImagineDownloader {
	if (options.trustedTestTransport !== true) {
		throw new GrokImagineError("SSRF", "fetch-based media transport is not production-safe");
	}
	const lookup = options.lookup ?? defaultImagineLookup;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const transport: ImagineMediaTransport = {
		async get(url, request) {
			const signal = requestSignal(request.signal, request.timeoutMs);
			try {
				const response = await fetchImpl(url, {
					method: "GET",
					redirect: "manual",
					signal,
					headers: { accept: request.accept },
				});
				if (response.status >= 300 && response.status < 400) {
					const location = response.headers.get("location");
					return location === null || location.trim() === ""
						? { status: response.status }
						: { status: response.status, location };
				}
				if (!response.ok) {
					const text = new TextDecoder().decode(await readLimitedBody(response, 4096, signal));
					throw mapUpstreamStatus(response.status, text);
				}
				const data = await readLimitedBody(response, request.maxBytes, signal);
				const contentType = parseContentType(response.headers.get("content-type"));
				if (contentType === undefined) return { status: response.status, data };
				return { status: response.status, contentType, data };
			} catch (error) {
				if (error instanceof GrokImagineError) throw error;
				const name = error instanceof Error ? error.name : "";
				if (name === "TimeoutError" || name === "AbortError") {
					throw new GrokImagineError("TIMEOUT", "Imagine media download timed out", { cause: error });
				}
				throw new GrokImagineError("MEDIA", `Imagine media download failed (${redactImagineMessage(error)})`, {
					cause: error,
				});
			}
		},
	};
	return {
		download: (request) =>
			downloadRemoteImagineMedia(request.url, transport, {
				lookup,
				timeoutMs: request.timeoutMs,
				maxBytes: request.maxBytes,
				accept: request.accept,
				maxRedirects,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			}),
	};
}

function requirePrompt(prompt: string | undefined): string {
	if (typeof prompt !== "string" || prompt.trim() === "") {
		throw new GrokImagineError("INVALID_INPUT", "prompt must be a non-empty string");
	}
	if (prompt.length > IMAGINE_PROMPT_MAX_LENGTH) {
		throw new GrokImagineError(
			"INVALID_INPUT",
			`prompt must be ${String(IMAGINE_PROMPT_MAX_LENGTH)} characters or fewer (got ${String(prompt.length)})`,
		);
	}
	return prompt;
}

/**
 * Validate a tool-supplied Imagine video `requestId`. Returns the id unchanged
 * on success or throws an `INVALID_INPUT` error. Exposed so capability tools
 * fail closed at the boundary instead of dispatching a malformed id to the
 * internal client.
 */
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

class ImagineAbortError extends Error {
	readonly name = "ImagineAbortError";
	constructor(reason?: unknown) {
		super("Imagine operation aborted");
		this.cause = reason;
	}
}

function isImagineAbortError(error: unknown): error is ImagineAbortError {
	return error instanceof ImagineAbortError;
}

/**
 * Combine a caller-supplied external `AbortSignal` with the client's internal
 * `AbortController` so a `dispose()` cancels in-flight API, download, and
 * persistence work without leaving the operation running in the background.
 */
function composeSignals(
	external: AbortSignal | undefined,
	internal: AbortSignal,
): { signal: AbortSignal; observe: () => void } {
	return {
		signal: external === undefined ? internal : AbortSignal.any([external, internal]),
		// AbortSignal.any owns and releases its internal listeners; callers retain
		// a uniform cleanup shape for runtimes that optimize this helper later.
		observe: () => undefined,
	};
}

function assertImagineSignalActive(signal: AbortSignal, operation: ImagineOperation): void {
	if (signal.aborted) {
		throw new GrokImagineError("TIMEOUT", `Imagine ${operation} was aborted before work started`, {
			cause: signal.reason,
		});
	}
}

function requireApiKey(value: string | undefined, operation: ImagineOperation): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new GrokImagineError(
			"MISSING_CREDENTIAL",
			`xAI API key is missing for ${operation}. Grok Imagine does not fall back to OAuth.`,
		);
	}
	return value;
}

function requireImageModel(model: string | undefined): string {
	const value = model ?? GROK_IMAGINE_IMAGE_MODEL;
	if (value !== GROK_IMAGINE_IMAGE_MODEL) {
		throw new GrokImagineError("INVALID_INPUT", "image model is not an accepted Imagine model");
	}
	return value;
}

function requireVideoModel(model: string | undefined): string {
	const value = model ?? GROK_IMAGINE_VIDEO_MODEL;
	if (value !== GROK_IMAGINE_VIDEO_MODEL) {
		throw new GrokImagineError("INVALID_INPUT", "video model is not an accepted Imagine model");
	}
	return value;
}

function optionalEnum(value: string | undefined, allowed: ReadonlySet<string>, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (!allowed.has(value)) {
		throw new GrokImagineError("INVALID_INPUT", `${label} is not an accepted Imagine value`);
	}
	return value;
}

function optionalDuration(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	const min = IMAGINE_VIDEO_MIN_DURATION_SECONDS;
	const max = IMAGINE_VIDEO_MAX_DURATION_SECONDS;
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		throw new GrokImagineError("INVALID_INPUT", `duration must be an integer between ${min} and ${max}`);
	}
	return value;
}

function classifyOfficialVideoStatus(raw: unknown): ImagineVideoJobStatus {
	if (raw === "pending") return "pending";
	if (raw === "done") return "completed";
	if (raw === "failed") return "failed";
	throw new GrokImagineError("UPSTREAM", "Imagine video status is not an official value");
}

function officialVideoUrl(payload: Record<string, unknown>): string | undefined {
	const video = isRecord(payload["video"]) ? payload["video"] : undefined;
	const url = video?.["url"];
	return typeof url === "string" && url.length > 0 ? url : undefined;
}

function officialVideoError(payload: Record<string, unknown>): string | undefined {
	const error = isRecord(payload["error"]) ? payload["error"] : undefined;
	const message = error?.["message"];
	return typeof message === "string" && message.length > 0 ? redactImagineMessage(message) : undefined;
}

/**
 * Strict base64 decoder. Node's decoder ignores some malformed characters and
 * padding, so validate the alphabet and compare a canonical re-encoding. Both
 * canonical padded input and canonical unpadded input are accepted.
 */
const BASE64_STRICT_RE = /^[A-Za-z0-9+/]+={0,2}$/u;
function decodeBase64(value: string, maxBytes: number): Uint8Array {
	if (typeof value !== "string" || value.length === 0) {
		throw new GrokImagineError("UPSTREAM", "Imagine image b64_json must be a non-empty string");
	}
	if (!BASE64_STRICT_RE.test(value)) {
		throw new GrokImagineError("UPSTREAM", "Imagine image b64_json contains non-base64 characters");
	}
	const remainder = value.length % 4;
	if (remainder === 1 || (value.includes("=") && remainder !== 0)) {
		throw new GrokImagineError("UPSTREAM", "Imagine image b64_json has invalid padding");
	}
	const maxChars = Math.ceil(maxBytes / 3) * 4 + 4;
	if (value.length > maxChars) {
		throw new GrokImagineError("MEDIA", `Imagine image b64_json exceeds the ${maxBytes} byte ceiling`);
	}
	const decoded = Buffer.from(value, "base64");
	if (decoded.byteLength === 0) {
		throw new GrokImagineError("UPSTREAM", "Imagine image b64_json decoded to an empty buffer");
	}
	const canonical = decoded.toString("base64");
	const inputWithoutPadding = value.replace(/=+$/u, "");
	if (canonical.replace(/=+$/u, "") !== inputWithoutPadding || (value.includes("=") && canonical !== value)) {
		throw new GrokImagineError("UPSTREAM", "Imagine image b64_json is not canonical base64");
	}
	if (decoded.byteLength > maxBytes) {
		throw new GrokImagineError("MEDIA", `Imagine image exceeds the ${maxBytes} byte ceiling`);
	}
	return Uint8Array.from(decoded);
}

function resolveImageMediaType(data: Uint8Array, declared: string | undefined): ImagineImageMediaType {
	const detected = detectImageMediaType(data);
	if (detected === undefined) {
		throw new GrokImagineError("MEDIA", "downloaded Imagine image is not a supported raster");
	}
	if (
		declared !== undefined &&
		declared !== "application/octet-stream" &&
		declared !== "binary/octet-stream" &&
		declared !== detected
	) {
		throw new GrokImagineError("MEDIA", `Imagine image Content-Type ${declared} does not match its bytes`);
	}
	return detected;
}

function resolveVideoMediaType(data: Uint8Array, declared: string | undefined): MediaStoreVideoType {
	const detected = detectVideoMediaType(data);
	if (detected === undefined) {
		throw new GrokImagineError("MEDIA", "downloaded Imagine video is not MP4 or WebM");
	}
	if (
		declared !== undefined &&
		declared !== "application/octet-stream" &&
		declared !== "binary/octet-stream" &&
		declared !== detected
	) {
		throw new GrokImagineError("MEDIA", `Imagine video Content-Type ${declared} does not match its bytes`);
	}
	return detected;
}

export class GrokImagineClient {
	private readonly resolveApiKey: ImagineApiKeyResolver;
	private readonly attachments: ImagineAttachmentStore;
	private readonly media: MediaStore;
	private readonly apiFetch: ImagineFetch;
	private readonly downloader: ImagineDownloader;
	private readonly imageDownloadTimeoutMs: number;
	private readonly videoDownloadTimeoutMs: number;
	private readonly apiTimeoutMs: number;
	private readonly maxRedirects: number;
	private readonly imageMaxBytes: number;
	private readonly apiJsonMaxBytes: number;
	private readonly videoResults = new Map<string, ImagineVideoStatusResult>();
	private readonly videoInflight = new Map<string, Promise<ImagineVideoStatusResult>>();
	private readonly disposeController = new AbortController();
	private disposed = false;

	constructor(options: GrokImagineClientOptions) {
		this.resolveApiKey = options.resolveApiKey;
		this.attachments = options.attachments;
		this.media = options.media;
		this.imageDownloadTimeoutMs = options.imageDownloadTimeoutMs ?? DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS;
		this.videoDownloadTimeoutMs = options.videoDownloadTimeoutMs ?? DEFAULT_VIDEO_DOWNLOAD_TIMEOUT_MS;
		this.apiTimeoutMs = options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS;
		this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
		this.imageMaxBytes =
			options.imageMaxBytes ?? options.attachments.imageLimits?.maxImageBytes ?? DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES;
		this.apiJsonMaxBytes = options.apiJsonMaxBytes ?? DEFAULT_API_JSON_MAX_BYTES;
		this.apiFetch = options.fetch ?? createPinnedApiFetch(defaultImagineLookup, this.apiJsonMaxBytes);
		this.downloader = options.downloader ?? createPinnedImagineDownloader({ maxRedirects: this.maxRedirects });
	}

	/**
	 * Permanently retire this client. In-flight API calls, downloads, and
	 * media persistence operations are aborted; subsequent operations fail
	 * closed with an `INVALID_INPUT` error until callers construct a new client.
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.disposeController.abort(new ImagineAbortError("client disposed"));
		for (const inflight of this.videoInflight.values()) {
			inflight.catch(() => undefined);
		}
		this.videoInflight.clear();
	}

	/** @returns true once {@link dispose} has been called. */
	get isDisposed(): boolean {
		return this.disposed;
	}

	private assertWritable(operation: ImagineOperation): void {
		if (this.disposed) {
			throw new GrokImagineError(
				"INVALID_INPUT",
				`Imagine client was disposed before ${operation}; refusing to start new work`,
			);
		}
	}

	async generateImage(input: GenerateImagineImageInput, signal?: AbortSignal): Promise<ImagineImageResult> {
		this.assertWritable("image.generate");
		const { signal: external, observe } = composeSignals(signal, this.disposeController.signal);
		try {
			assertImagineSignalActive(external, "image.generate");
			const prompt = requirePrompt(input.prompt);
			const model = requireImageModel(input.model);
			const n = input.n ?? 1;
			if (!Number.isSafeInteger(n) || n < 1 || n > IMAGINE_IMAGE_MAX_N) {
				throw new GrokImagineError("INVALID_INPUT", `n must be an integer between 1 and ${IMAGINE_IMAGE_MAX_N}`);
			}
			const aspectRatio = optionalEnum(input.aspectRatio, IMAGE_ASPECT_SET, "aspectRatio");
			const resolution = optionalEnum(input.resolution, IMAGE_RESOLUTION_SET, "resolution");
			const apiKey = requireApiKey(await this.resolveCredential("image.generate"), "image.generate");
			const body: Record<string, unknown> = {
				model,
				prompt,
				n,
				response_format: "url",
			};
			if (aspectRatio !== undefined) body["aspect_ratio"] = aspectRatio;
			if (resolution !== undefined) body["resolution"] = resolution;
			const payload = await this.apiJson("POST", GROK_IMAGINE_IMAGE_PATH, apiKey, body, external);
			const rows = Array.isArray(payload["data"]) ? payload["data"] : undefined;
			if (rows === undefined) {
				throw new GrokImagineError("UPSTREAM", "Imagine image response did not include data");
			}
			const images: ImaginePersistedImage[] = [];
			for (const row of rows) {
				if (!isRecord(row)) {
					throw new GrokImagineError("UPSTREAM", "Imagine image data row is not an object");
				}
				images.push(await this.persistGeneratedImage(row, input.name, external));
			}
			const first = images[0];
			if (first === undefined) {
				throw new GrokImagineError("UPSTREAM", "Imagine image response did not include any images");
			}
			return {
				model,
				images,
				attachment: first.attachment,
				path: first.path,
			};
		} finally {
			observe();
		}
	}

	async startVideo(input: StartImagineVideoInput, signal?: AbortSignal): Promise<ImagineVideoStartResult> {
		this.assertWritable("video.start");
		const { signal: external, observe } = composeSignals(signal, this.disposeController.signal);
		try {
			assertImagineSignalActive(external, "video.start");
			const prompt = requirePrompt(input.prompt);
			const model = requireVideoModel(input.model);
			const duration = optionalDuration(input.duration);
			const aspectRatio = optionalEnum(input.aspectRatio, VIDEO_ASPECT_SET, "aspectRatio");
			const resolution = optionalEnum(input.resolution, VIDEO_RESOLUTION_SET, "resolution");
			const apiKey = requireApiKey(await this.resolveCredential("video.start"), "video.start");
			const body: Record<string, unknown> = { model, prompt };
			if (duration !== undefined) body["duration"] = duration;
			if (aspectRatio !== undefined) body["aspect_ratio"] = aspectRatio;
			if (resolution !== undefined) body["resolution"] = resolution;
			const payload = await this.apiJson("POST", GROK_IMAGINE_VIDEO_START_PATH, apiKey, body, external);
			const requestId = payload["request_id"];
			if (typeof requestId !== "string" || !VIDEO_REQUEST_ID_PATTERN.test(requestId)) {
				throw new GrokImagineError("UPSTREAM", "Imagine video start did not return a safe request_id");
			}
			return { model, requestId, status: "pending" };
		} finally {
			observe();
		}
	}

	async videoStatus(
		requestId: string,
		options: { name?: string; signal?: AbortSignal } = {},
	): Promise<ImagineVideoStatusResult> {
		const validated = parseVideoRequestId(requestId);
		this.assertWritable("video.status");
		const { signal: external, observe } = composeSignals(options.signal, this.disposeController.signal);
		try {
			assertImagineSignalActive(external, "video.status");
		} catch (error) {
			observe();
			throw error;
		}
		const cached = this.videoResults.get(validated);
		if (cached !== undefined && cached.status !== "pending") {
			observe();
			return cloneVideoStatus(cached);
		}
		const poll = (): Promise<ImagineVideoStatusResult> =>
			this.pollVideo(validated, { ...options, signal: external }).catch((error: unknown) => {
				if (isImagineAbortError(error)) {
					throw new GrokImagineError("TIMEOUT", `video polling for ${validated} was aborted`, { cause: error });
				}
				throw error;
			});
		if (options.signal !== undefined) return poll().finally(observe);
		const inflight = this.videoInflight.get(validated);
		if (inflight !== undefined) {
			observe();
			return inflight;
		}
		const run = poll().finally(() => {
			observe();
			if (this.videoInflight.get(validated) === run) {
				this.videoInflight.delete(validated);
			}
		});
		this.videoInflight.set(validated, run);
		return run;
	}

	private async pollVideo(
		requestId: string,
		options: { name?: string; signal?: AbortSignal },
	): Promise<ImagineVideoStatusResult> {
		const apiKey = requireApiKey(await this.resolveCredential("video.status"), "video.status");
		const payload = await this.apiJson("GET", grokImagineVideoStatusPath(requestId), apiKey, undefined, options.signal);
		const status = classifyOfficialVideoStatus(payload["status"]);
		if (status === "pending") return { requestId, status };
		if (status === "failed") {
			const result: ImagineVideoStatusResult = { requestId, status };
			const error = officialVideoError(payload);
			if (error !== undefined) result.error = error;
			this.rememberVideo(requestId, result);
			return result;
		}
		const video = isRecord(payload["video"]) ? payload["video"] : undefined;
		if (video?.["respect_moderation"] === false) {
			const result: ImagineVideoStatusResult = {
				requestId,
				status: "failed",
				error: "video did not respect moderation rules",
			};
			this.rememberVideo(requestId, result);
			return result;
		}
		const url = officialVideoUrl(payload);
		if (url === undefined) {
			throw new GrokImagineError("UPSTREAM", "completed Imagine video did not include a downloadable URL");
		}
		if (this.disposed) {
			throw new GrokImagineError("INVALID_INPUT", "Imagine client was disposed before video artifact save");
		}
		const downloaded = await this.downloader.download({
			url,
			timeoutMs: this.videoDownloadTimeoutMs,
			maxBytes: this.media.maxBytes,
			accept: "video/mp4,video/webm",
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		if (this.disposed) {
			throw new GrokImagineError("INVALID_INPUT", "Imagine client was disposed after video download");
		}
		const mediaType = resolveVideoMediaType(downloaded.data, downloaded.contentType);
		const operationAborted = (): boolean => options.signal?.aborted === true || this.disposed;
		if (operationAborted()) {
			throw new GrokImagineError("TIMEOUT", "Imagine video persistence was aborted", {
				cause: options.signal?.reason,
			});
		}
		const artifact = await this.media.save({
			data: downloaded.data,
			mediaType,
			...(options.name === undefined ? {} : { name: options.name }),
		});
		if (operationAborted()) {
			await this.media.delete(artifact.artifactId).catch(() => undefined);
			throw new GrokImagineError("TIMEOUT", "Imagine video persistence was aborted", {
				cause: options.signal?.reason,
			});
		}
		const result: ImagineVideoStatusResult = {
			requestId,
			status: "completed",
			artifact,
			path: imagineMediaPath(artifact.artifactId),
		};
		this.rememberVideo(requestId, result);
		return result;
	}

	private rememberVideo(requestId: string, result: ImagineVideoStatusResult): void {
		this.videoResults.set(requestId, result);
		if (this.videoResults.size <= MAX_CACHED_VIDEO_JOBS) return;
		const oldest = this.videoResults.keys().next().value;
		if (oldest !== undefined) this.videoResults.delete(oldest);
	}

	private async persistGeneratedImage(
		row: Record<string, unknown>,
		name: string | undefined,
		signal: AbortSignal,
	): Promise<ImaginePersistedImage> {
		const b64 = typeof row["b64_json"] === "string" ? row["b64_json"] : undefined;
		const url = typeof row["url"] === "string" ? row["url"] : undefined;
		const declaredMime = typeof row["mime_type"] === "string" ? parseContentType(row["mime_type"]) : undefined;
		let data: Uint8Array;
		let declared = declaredMime;
		if (b64 !== undefined) {
			data = decodeBase64(b64, this.imageMaxBytes);
		} else {
			if (url === undefined) {
				throw new GrokImagineError("UPSTREAM", "Imagine image row did not include url or b64_json");
			}
			if (signal.aborted) {
				throw new GrokImagineError("TIMEOUT", "image download aborted before request", { cause: signal.reason });
			}
			const downloaded = await this.downloader.download({
				url,
				timeoutMs: this.imageDownloadTimeoutMs,
				maxBytes: this.imageMaxBytes,
				accept: "image/png,image/jpeg,image/webp,image/gif",
				signal,
			});
			data = downloaded.data;
			declared = downloaded.contentType ?? declared;
		}
		if (signal.aborted) {
			throw new GrokImagineError("TIMEOUT", "image download aborted before persistence", { cause: signal.reason });
		}
		if (data.byteLength > this.imageMaxBytes) {
			throw new GrokImagineError("MEDIA", `Imagine image exceeds the ${this.imageMaxBytes} byte ceiling`);
		}
		const mediaType = resolveImageMediaType(data, declared);
		const allowed = this.attachments.imageLimits?.mediaTypes;
		if (allowed !== undefined && !allowed.includes(mediaType)) {
			throw new GrokImagineError("MEDIA", `Imagine image type ${mediaType} is not accepted by the attachment store`);
		}
		if (this.disposed) {
			throw new GrokImagineError("INVALID_INPUT", "Imagine client was disposed before attachment persist");
		}
		const attachment = await this.attachments.saveImage({
			data,
			mediaType,
			...(name === undefined ? {} : { name }),
		});
		if (signal.aborted || this.disposed) {
			// AttachmentStore exposes no delete/cancellation seam; fail closed and do
			// not publish the now-orphaned immutable reference.
			throw new GrokImagineError("TIMEOUT", "Imagine attachment persistence was aborted", {
				cause: signal.reason,
			});
		}
		if (!isSafeImagineAttachmentId(attachment.attachmentId)) {
			throw new GrokImagineError("MEDIA", "attachment store returned an unsafe identifier");
		}
		return {
			attachment,
			path: imagineImagePath(attachment.attachmentId),
		};
	}

	private async resolveCredential(operation: ImagineOperation): Promise<string> {
		try {
			return await this.resolveApiKey(operation);
		} catch (error) {
			if (error instanceof GrokImagineError) throw error;
			const detail = redactImagineMessage(error);
			throw new GrokImagineError(
				"MISSING_CREDENTIAL",
				`xAI API key resolver failed for ${operation} (${detail}). Grok Imagine does not fall back to OAuth.`,
				{ cause: error },
			);
		}
	}

	private async apiJson(
		method: "GET" | "POST",
		path: string,
		apiKey: string,
		body: Record<string, unknown> | undefined,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const url = new URL(path, XAI_API_ORIGIN);
		if (url.origin !== XAI_API_ORIGIN) {
			throw new GrokImagineError("SSRF", "Imagine API URL escaped https://api.x.ai");
		}
		const headers: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		};
		const composed = AbortSignal.any(
			signal === undefined
				? [AbortSignal.timeout(this.apiTimeoutMs), this.disposeController.signal]
				: [signal, AbortSignal.timeout(this.apiTimeoutMs), this.disposeController.signal],
		);
		const init: RequestInit = {
			method,
			headers,
			redirect: "error",
			signal: composed,
		};
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}
		let response: Response;
		try {
			response = await this.apiFetch(url, init);
			if (composed.aborted) {
				throw new GrokImagineError("TIMEOUT", "Imagine API request was aborted", { cause: composed.reason });
			}
		} catch (error) {
			if (error instanceof GrokImagineError) throw error;
			const name = error instanceof Error ? error.name : "";
			if (name === "TimeoutError" || name === "AbortError" || signal?.aborted === true) {
				throw new GrokImagineError("TIMEOUT", "Imagine API request was aborted", { cause: error });
			}
			throw new GrokImagineError("UPSTREAM", `Imagine API request failed (${redactImagineMessage(error)})`, {
				cause: error,
			});
		}
		const bytes = await readLimitedBody(response, this.apiJsonMaxBytes, composed);
		const text = new TextDecoder().decode(bytes);
		if (!response.ok) throw mapUpstreamStatus(response.status, text);
		if (text.trim() === "") return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new GrokImagineError("UPSTREAM", "Imagine API returned non-JSON", { cause: error });
		}
		if (!isRecord(parsed)) throw new GrokImagineError("UPSTREAM", "Imagine API returned a non-object JSON body");
		return parsed;
	}
}

function cloneVideoStatus(result: ImagineVideoStatusResult): ImagineVideoStatusResult {
	const clone: ImagineVideoStatusResult = { requestId: result.requestId, status: result.status };
	if (result.artifact !== undefined) clone.artifact = { ...result.artifact };
	if (result.path !== undefined) clone.path = result.path;
	if (result.error !== undefined) clone.error = result.error;
	return clone;
}

export function createGrokImagineClient(options: GrokImagineClientOptions): GrokImagineClient {
	return new GrokImagineClient(options);
}

/** Gate a same-origin image download. Requires an explicit trusted/authz token. */
export async function openTrustedImagineImageDownload(
	attachments: ImagineAttachmentStore,
	ref: ImagineImageAttachmentRef,
	authz: TrustedImagineAuthz,
): Promise<ImagineImageDownloadView> {
	assertTrustedImagineAuthz(authz);
	if (!isSafeImagineAttachmentId(ref.attachmentId)) {
		throw new GrokImagineError("INVALID_INPUT", "attachment id is not safe for a same-origin image route");
	}
	if (attachments.readImage === undefined) {
		throw new GrokImagineError("MEDIA", "attachment store does not expose readImage");
	}
	const stored = await attachments.readImage(ref);
	return {
		ref: stored.ref,
		body: stored.data,
		headers: imagineImageDownloadHeaders(stored.ref),
	};
}

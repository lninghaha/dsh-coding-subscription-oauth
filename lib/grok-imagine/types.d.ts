/**
 * Grok Imagine shared types and constants.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */
import type { MediaArtifactMeta, MediaStore } from "../media-store.js";
export declare const XAI_API_ORIGIN = "https://api.x.ai";
export declare const GROK_IMAGINE_IMAGE_PATH = "/v1/images/generations";
export declare const GROK_IMAGINE_VIDEO_START_PATH = "/v1/videos/generations";
export declare const GROK_IMAGINE_IMAGE_MODEL = "grok-imagine-image-2.0";
export declare const GROK_IMAGINE_VIDEO_MODEL = "grok-imagine-video-1.5";
export declare const GROK_IMAGINE_IMAGE_TOOL = "grok_imagine_image";
export declare const GROK_IMAGINE_VIDEO_TOOL = "grok_imagine_video";
export declare const GROK_IMAGINE_VIDEO_STATUS_TOOL = "grok_imagine_video_status";
export declare const IMAGINE_IMAGE_ROUTE_PREFIX = "/plugins/dsh-grok-build/imagine/images/";
/** Frozen xAI output hosts. Callers cannot widen this list. */
export declare const XAI_OUTPUT_HOSTS: readonly ["imgen.x.ai", "videogen.x.ai", "vidgen.x.ai"];
export declare const IMAGINE_IMAGE_RESOLUTIONS: readonly ["1k", "2k"];
export declare const IMAGINE_VIDEO_RESOLUTIONS: readonly ["480p", "720p", "1080p"];
export declare const IMAGINE_IMAGE_ASPECT_RATIOS: readonly ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto"];
export declare const IMAGINE_VIDEO_ASPECT_RATIOS: readonly ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
export declare const IMAGINE_VIDEO_MIN_DURATION_SECONDS = 1;
export declare const IMAGINE_VIDEO_MAX_DURATION_SECONDS = 15;
export declare const IMAGINE_IMAGE_MAX_N = 10;
/**
 * Hard ceilings enforced both at the tool boundary (consumer guard) and inside
 * the Imagine client (defence-in-depth). The prompt ceiling uses UTF-16 code
 * units because that is what the JSON wire format bounds; the image-id arrays
 * are bounded so a runaway caller cannot exhaust the bounded body reader.
 */
export declare const IMAGINE_PROMPT_MAX_LENGTH = 4000;
export declare const IMAGINE_IMAGE_IDS_MIN = 1;
export declare const IMAGINE_IMAGE_IDS_MAX = 5;
export declare const DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES: number;
export declare const DEFAULT_API_TIMEOUT_MS = 30000;
export declare const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = 15000;
export declare const DEFAULT_VIDEO_DOWNLOAD_TIMEOUT_MS = 60000;
export declare const DEFAULT_MAX_REDIRECTS = 3;
export declare const DEFAULT_API_JSON_MAX_BYTES: number;
export declare const MAX_CACHED_VIDEO_JOBS = 256;
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
export type GrokImagineErrorCode = "MISSING_CREDENTIAL" | "AUTH" | "QUOTA" | "RATE_LIMIT" | "SSRF" | "INVALID_INPUT" | "UPSTREAM" | "TIMEOUT" | "MEDIA";
export declare class GrokImagineError extends Error {
    readonly code: GrokImagineErrorCode;
    readonly status?: number;
    constructor(code: GrokImagineErrorCode, message: string, options?: {
        cause?: unknown;
        status?: number;
    });
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
    readImage?(ref: ImagineImageAttachmentRef, signal?: AbortSignal): Promise<{
        ref: ImagineImageAttachmentRef;
        data: Uint8Array;
    }>;
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
export declare const VIDEO_REQUEST_ID_PATTERN: RegExp;
export declare const FROZEN_OUTPUT_HOSTS: Set<string>;
export declare const IMAGE_RESOLUTION_SET: Set<string>;
export declare const VIDEO_RESOLUTION_SET: Set<string>;
export declare const IMAGE_ASPECT_SET: Set<string>;
export declare const VIDEO_ASPECT_SET: Set<string>;
//# sourceMappingURL=types.d.ts.map
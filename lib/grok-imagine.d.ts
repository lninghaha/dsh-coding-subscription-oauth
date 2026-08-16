/**
 * Official xAI Imagine client. Talks only to https://api.x.ai with a
 * per-operation API-key resolver. Generated remote media is fetched under a
 * pinned HTTPS/host/DNS allowlist and persisted locally; results never include
 * a signed upstream URL.
 * @module dsh-coding-subscription-oauth/grok-imagine
 */
import { IMAGINE_MEDIA_ROUTE_PREFIX, imagineMediaPath, isTrustedImaginePeer, type MediaArtifactMeta, type MediaStore, type MediaStoreVideoType, type TrustedImagineAuthz } from "./media-store.ts";
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
export declare function redactImagineMessage(error: unknown): string;
/** True when an address is loopback, private, reserved, documentation, or an embedded special form. */
export declare function isBlockedIp(address: string): boolean;
export declare function isAllowlistedImagineHost(hostname: string): boolean;
export declare function grokImagineVideoStatusPath(requestId: string): string;
export declare function isSafeImagineAttachmentId(attachmentId: string): boolean;
export declare function imagineImagePath(attachmentId: string): string;
export declare function parseImagineImagePath(pathname: string): string | undefined;
export declare function imagineImageDownloadHeaders(ref: ImagineImageAttachmentRef): ImagineImageDownloadHeaders;
export { IMAGINE_MEDIA_ROUTE_PREFIX, imagineMediaPath, isTrustedImaginePeer };
export declare function detectImageMediaType(data: Uint8Array): ImagineImageMediaType | undefined;
export declare function detectVideoMediaType(data: Uint8Array): MediaStoreVideoType | undefined;
export declare function defaultImagineLookup(hostname: string): Promise<readonly string[]>;
export declare function assertSafeRemoteMediaUrl(raw: string, lookup: ImagineDnsLookup): Promise<URL>;
export declare function createPinnedMediaTransport(lookup?: ImagineDnsLookup): ImagineMediaTransport;
export declare function createPinnedApiFetch(lookup?: ImagineDnsLookup, maxBytes?: number): ImagineFetch;
export declare function downloadRemoteImagineMedia(initialUrl: string, transport: ImagineMediaTransport, options: {
    lookup: ImagineDnsLookup;
    timeoutMs: number;
    maxBytes: number;
    accept: string;
    maxRedirects: number;
}): Promise<ImagineDownloadResult>;
export declare function createPinnedImagineDownloader(options?: {
    lookup?: ImagineDnsLookup;
    maxRedirects?: number;
}): ImagineDownloader;
/**
 * Test-only adapter around an injected fetch. Ordinary mock fetch is not
 * production-safe: it cannot pin DNS at connect time.
 */
export declare function createImagineDownloaderFromFetch(fetchImpl: ImagineFetch, options: {
    trustedTestTransport: true;
    lookup?: ImagineDnsLookup;
    maxRedirects?: number;
}): ImagineDownloader;
export declare class GrokImagineClient {
    private readonly resolveApiKey;
    private readonly attachments;
    private readonly media;
    private readonly apiFetch;
    private readonly downloader;
    private readonly imageDownloadTimeoutMs;
    private readonly videoDownloadTimeoutMs;
    private readonly apiTimeoutMs;
    private readonly maxRedirects;
    private readonly imageMaxBytes;
    private readonly apiJsonMaxBytes;
    private readonly videoResults;
    private readonly videoInflight;
    constructor(options: GrokImagineClientOptions);
    generateImage(input: GenerateImagineImageInput): Promise<ImagineImageResult>;
    startVideo(input: StartImagineVideoInput): Promise<ImagineVideoStartResult>;
    videoStatus(requestId: string, options?: {
        name?: string;
    }): Promise<ImagineVideoStatusResult>;
    private pollVideo;
    private rememberVideo;
    private persistGeneratedImage;
    private resolveCredential;
    private apiJson;
}
export declare function createGrokImagineClient(options: GrokImagineClientOptions): GrokImagineClient;
/** Gate a same-origin image download. Requires an explicit trusted/authz token. */
export declare function openTrustedImagineImageDownload(attachments: ImagineAttachmentStore, ref: ImagineImageAttachmentRef, authz: TrustedImagineAuthz): Promise<ImagineImageDownloadView>;
//# sourceMappingURL=grok-imagine.d.ts.map
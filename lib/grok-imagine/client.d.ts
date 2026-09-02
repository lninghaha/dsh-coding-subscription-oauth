/**
 * Grok Imagine pinned transport and official API client.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */
import { type TrustedImagineAuthz } from "../media-store.js";
import { type GenerateImagineImageInput, type GrokImagineClientOptions, type ImagineAttachmentStore, type ImagineDnsLookup, type ImagineDownloader, type ImagineDownloadResult, type ImagineFetch, type ImagineImageAttachmentRef, type ImagineImageDownloadView, type ImagineImageResult, type ImagineMediaTransport, type ImagineVideoStartResult, type ImagineVideoStatusResult, type StartImagineVideoInput } from "./types.js";
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
    signal?: AbortSignal;
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
    private readonly disposeController;
    private disposed;
    constructor(options: GrokImagineClientOptions);
    /**
     * Permanently retire this client. In-flight API calls, downloads, and
     * media persistence operations are aborted; subsequent operations fail
     * closed with an `INVALID_INPUT` error until callers construct a new client.
     */
    dispose(): void;
    /** @returns true once {@link dispose} has been called. */
    get isDisposed(): boolean;
    private assertWritable;
    generateImage(input: GenerateImagineImageInput, signal?: AbortSignal): Promise<ImagineImageResult>;
    startVideo(input: StartImagineVideoInput, signal?: AbortSignal): Promise<ImagineVideoStartResult>;
    videoStatus(requestId: string, options?: {
        name?: string;
        signal?: AbortSignal;
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
//# sourceMappingURL=client.d.ts.map
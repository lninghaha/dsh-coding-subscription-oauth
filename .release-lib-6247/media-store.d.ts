/**
 * Owner-private content-addressed store for Grok Imagine video artifacts.
 * Public identifiers are opaque; callers never receive a filesystem path,
 * content hash, or a signed upstream URL.
 * @module dsh-coding-subscription-oauth/media-store
 */
/** Hard ceiling for one artifact and for aggregate stored object bytes. */
export declare const MEDIA_STORE_MAX_BYTES: number;
/** Hard ceiling for artifact retention. Callers cannot raise this. */
export declare const MEDIA_STORE_RETENTION_MS: number;
export declare const MEDIA_STORE_DIR_MODE = 448;
export declare const MEDIA_STORE_FILE_MODE = 384;
export declare const MEDIA_STORE_INDEX_VERSION = 1;
export declare const MEDIA_STORE_INDEX_MAX_BYTES: number;
/** Opaque public id: 32 lowercase hex characters. */
export declare const MEDIA_ARTIFACT_ID_PATTERN: RegExp;
export declare const IMAGINE_MEDIA_ROUTE_PREFIX = "/plugins/dsh-coding-subscription-oauth/imagine/media/";
declare const TRUSTED_IMAGINE: unique symbol;
export type MediaStoreVideoType = "video/mp4" | "video/webm";
export type MediaStoreErrorCode = "INVALID_ID" | "INVALID_INPUT" | "TOO_LARGE" | "NOT_FOUND" | "EXPIRED" | "CORRUPT" | "UNSUPPORTED_TYPE" | "FORBIDDEN";
export declare class MediaStoreError extends Error {
    readonly code: MediaStoreErrorCode;
    constructor(code: MediaStoreErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
export interface MediaArtifactMeta {
    /** Opaque public identifier. Never a path, hash, or bearer URL. */
    artifactId: string;
    mediaType: MediaStoreVideoType;
    bytes: number;
    createdAt: number;
    expiresAt: number;
    name?: string;
}
export interface SaveMediaInput {
    data: Uint8Array;
    mediaType: MediaStoreVideoType;
    name?: string;
}
export interface StoredMedia {
    meta: MediaArtifactMeta;
    data: Uint8Array;
}
export interface MediaCleanupReport {
    expiredArtifacts: number;
    removedObjects: number;
}
export interface MediaStoreOptions {
    now?: () => number;
    /** Per-artifact ceiling, capped at {@link MEDIA_STORE_MAX_BYTES}. */
    maxBytes?: number;
    /** Aggregate unique-object ceiling, capped at {@link MEDIA_STORE_MAX_BYTES}. */
    maxTotalBytes?: number;
    retentionMs?: number;
    randomId?: () => string;
}
export interface MediaDownloadHeaders {
    "Content-Type": string;
    "Content-Length": string;
    "Content-Disposition": string;
    "Cache-Control": string;
    "X-Content-Type-Options": "nosniff";
}
export interface MediaDownloadView {
    meta: MediaArtifactMeta;
    body: Uint8Array;
    headers: MediaDownloadHeaders;
}
/** Runtime token proving a route already authorized this download. */
export interface TrustedImagineAuthz {
    readonly [TRUSTED_IMAGINE]: true;
}
export interface CreateTrustedImagineAuthzInput {
    readonly remoteAddress?: string;
    readonly authorized?: boolean;
}
/** Reject anything that is not a 32-char lowercase hex artifact id. */
export declare function parseMediaArtifactId(value: string): string | undefined;
export declare function isSafeMediaArtifactId(value: string): boolean;
/** Trusted same-origin path for one stored video artifact. */
export declare function imagineMediaPath(artifactId: string): string;
/** Extract a safe artifact id from a same-origin media route. */
export declare function parseImagineMediaPath(pathname: string): string | undefined;
export declare function mediaDownloadHeaders(meta: MediaArtifactMeta): MediaDownloadHeaders;
/** Loopback-only peer check for the parent route gate. */
export declare function isTrustedImaginePeer(remoteAddress: string | undefined): boolean;
/** Build a runtime authz token. Raw objects are not accepted by openTrusted helpers. */
export declare function createTrustedImagineAuthz(input: CreateTrustedImagineAuthzInput): TrustedImagineAuthz;
export declare function assertTrustedImagineAuthz(authz: TrustedImagineAuthz): void;
/**
 * Content-addressed video store. Directories are 0700; objects and index
 * documents are 0600. Public lookup uses an opaque id, never the digest.
 */
export declare class MediaStore {
    readonly root: string;
    readonly maxBytes: number;
    readonly maxTotalBytes: number;
    retentionMs: number;
    private readonly now;
    private readonly randomId;
    private tail;
    private retentionReconciled;
    constructor(root: string, options?: MediaStoreOptions);
    /**
     * Apply a live retention ceiling under the store lock. Lowering it rewrites
     * existing index expiries and deletes newly expired objects before resolving;
     * raising it affects only artifacts saved after this call.
     */
    applyRetentionMs(retentionMs: number): Promise<MediaCleanupReport>;
    save(input: SaveMediaInput): Promise<MediaArtifactMeta>;
    lookup(artifactId: string): Promise<MediaArtifactMeta | undefined>;
    read(artifactId: string): Promise<StoredMedia>;
    delete(artifactId: string): Promise<boolean>;
    cleanup(): Promise<MediaCleanupReport>;
    /** Trusted same-origin download primitive. Never returns an upstream URL. */
    openDownload(artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView>;
    private effectiveExpiresAt;
    private effectiveMeta;
    private runExclusive;
    private saveUnlocked;
    private deleteUnlocked;
    private cleanupUnlocked;
    private readIndex;
    private removeObjectIfUnreferenced;
}
/** Open a trusted same-origin download. Requires an explicit authz token. */
export declare function openTrustedMediaDownload(store: MediaStore, artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView>;
export {};
//# sourceMappingURL=media-store.d.ts.map
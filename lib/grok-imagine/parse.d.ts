/**
 * Grok Imagine pure parse / path / media-type helpers.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */
import type { MediaStoreVideoType } from "../media-store.js";
import { type ImagineImageAttachmentRef, type ImagineImageDownloadHeaders, type ImagineImageMediaType } from "./types.js";
declare function isRecord(value: unknown): value is Record<string, unknown>;
export { isRecord };
export declare function redactImagineMessage(error: unknown): string;
export declare function grokImagineVideoStatusPath(requestId: string): string;
export declare function isSafeImagineAttachmentId(attachmentId: string): boolean;
export declare function imagineImagePath(attachmentId: string): string;
export declare function parseImagineImagePath(pathname: string): string | undefined;
export declare function imagineImageDownloadHeaders(ref: ImagineImageAttachmentRef): ImagineImageDownloadHeaders;
export declare function detectImageMediaType(data: Uint8Array): ImagineImageMediaType | undefined;
export declare function detectVideoMediaType(data: Uint8Array): MediaStoreVideoType | undefined;
export declare function parseVideoRequestId(value: unknown): string;
/** Enforce min/max bounds on a candidate image-id array. */
export declare function clampImagineImageIds(ids: readonly unknown[]): readonly string[];
//# sourceMappingURL=parse.d.ts.map
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
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment, StoredImageAttachment } from "@deepseek-ai/dsh-attachment";
import { type CodexAuthSession, type CodexFetch, type CodexHttpClient } from "./codex-http.ts";
export declare const CODEX_IMAGE_GENERATION_URL = "https://chatgpt.com/backend-api/codex/images/generations";
export declare const CODEX_IMAGE_EDIT_URL = "https://chatgpt.com/backend-api/codex/images/edits";
export declare const CODEX_IMAGE_MODEL = "gpt-image-2";
export declare const CODEX_IMAGE_AUTO = "auto";
export declare const CODEX_IMAGE_RESPONSE_FORMAT = "b64_json";
export declare const CODEX_IMAGE_MAX_REFERENCES = 5;
export declare const CODEX_IMAGE_CAPABLE_PROVIDERS: readonly ["codex-oauth", "openai-codex", "codex-oauth-fast"];
export type CodexImageCapableProvider = (typeof CODEX_IMAGE_CAPABLE_PROVIDERS)[number];
export declare const CODEX_IMAGE_SIZES: readonly ["auto", "1024x1024", "1536x1024", "1024x1536"];
export type CodexImageSize = (typeof CODEX_IMAGE_SIZES)[number];
export declare const CODEX_IMAGE_QUALITIES: readonly ["auto", "low", "medium", "high"];
export type CodexImageQuality = (typeof CODEX_IMAGE_QUALITIES)[number];
export declare const CODEX_IMAGE_BACKGROUNDS: readonly ["auto", "opaque", "transparent"];
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
/** True only for a Codex OAuth route that explicitly declares image input. */
export declare function isCodexImageCapableRoute(route: CodexImageRoute | undefined): boolean;
export declare function assertCodexImageCapableRoute(route: CodexImageRoute | undefined): void;
/**
 * Collect canonical image attachment refs visibly present in current session
 * message content. Nested tool-results and arbitrary objects are ignored.
 */
export declare function collectCanonicalImageRefs(messages: readonly CodexDerivedMessage[]): Map<string, ImageAttachmentRef>;
/**
 * Resolve edit IDs only against canonical refs visibly present in `deriveMessages()`.
 * Unknown IDs, HTTP URLs, nested-only objects, and more than
 * {@link CODEX_IMAGE_MAX_REFERENCES} are rejected (fail closed).
 */
export declare function resolveSessionImageRefs(deriveMessages: () => readonly CodexDerivedMessage[], imageIds: readonly string[]): ImageAttachmentRef[];
export declare function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined;
/** Encoded-size precheck. `undefined` means the payload is not valid base64/base64url. */
export declare function estimateDecodedBase64Bytes(value: string): number | undefined;
/** Decode standard base64 or base64url. Rejects invalid alphabets and length mismatches. */
export declare function decodeImageBase64(value: string): Uint8Array | undefined;
/** Factory for generate/edit controllers. Parent registers tools only when the feature is enabled. */
export declare function createCodexImageController(options: CodexImageControllerOptions): CodexImageController;
//# sourceMappingURL=codex-images.d.ts.map
/**
 * Same-origin GET routes for generated Imagine images and video artifacts.
 * The Host webServer only accepts exact paths, so this registrar keeps a
 * bounded table of opaque ids and registers one exact disposer per remembered
 * image ref or media artifact.
 * @module dsh-coding-subscription-oauth/imagine-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import { type ImagineImageAttachmentRef } from "./grok-imagine.js";
import { type MediaArtifactMeta, type MediaDownloadView, type TrustedImagineAuthz } from "./media-store.js";
import { type OwnerRequestPolicy } from "./web-origin.js";
/** Hard ceiling for live exact download routes. Callers cannot raise this. */
export declare const IMAGINE_ROUTE_MAX_ENTRIES = 64;
/** Hard ceiling for remembered image routes. Callers cannot raise this. */
export declare const IMAGINE_IMAGE_ROUTE_TTL_MS: number;
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
    readonly imageLimits?: {
        readonly maxImageBytes?: number;
    };
    readImage(ref: ImagineImageAttachmentRef, signal?: AbortSignal): Promise<{
        ref: ImagineImageAttachmentRef;
        data: Uint8Array;
    }>;
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
    readonly ownerRequestPolicy?: OwnerRequestPolicy;
}
export interface ImagineRouteRegistry {
    rememberImages(refs: readonly ImageAttachmentRef[] | readonly ImagineImageAttachmentRef[]): void;
    rememberArtifact(meta: MediaArtifactMeta): void;
    revokeImages(): void;
    revokeArtifacts(): void;
    dispose(): void;
}
/** Register the bounded exact-path Imagine download registry. */
export declare function registerImagineRoutes(ctx: ImagineRouteContext, options: ImagineRouteOptions): ImagineRouteRegistry;
//# sourceMappingURL=imagine-routes.d.ts.map
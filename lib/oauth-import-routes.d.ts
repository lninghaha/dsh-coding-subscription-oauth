/**
 * Same-origin Web API for allowlisted CLI OAuth source discovery and
 * two-phase import into destination stores. Preview tickets stay in one
 * process-local session; persist happens inside the destination store lock.
 * @module dsh-coding-subscription-oauth/oauth-import-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type OAuthImportCommitAction, type OAuthImportSessionOptions, type OAuthSourceCredential, type OAuthSourceDiscovery, type OAuthSourceKind, type OAuthSourcePathOptions } from "./oauth-sources.ts";
export declare const OAUTH_IMPORT_SOURCES_PATH = "/plugins/dsh-grok-build/oauth/sources";
export declare const OAUTH_IMPORT_PREVIEW_PATH = "/plugins/dsh-grok-build/oauth/sources/preview";
export declare const OAUTH_IMPORT_COMMIT_PATH = "/plugins/dsh-grok-build/oauth/sources/commit";
export declare const OAUTH_IMPORT_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/sources/cancel";
export interface OAuthImportRouteContext {
    webServer: {
        register(route: {
            kind: "exact";
            path: string;
            handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    effect?(setup: () => void | (() => void | Promise<void>), label?: string): void;
}
export interface OAuthImportDestinationStore {
    readonly filename: string;
    modify(providerId: string, fn: (current: OAuthSourceCredential | undefined) => Promise<OAuthSourceCredential | undefined>): Promise<OAuthSourceCredential | undefined>;
}
export interface OAuthImportDestination {
    providerId: string;
    store: OAuthImportDestinationStore;
}
export type OAuthImportDestinations = {
    [K in OAuthSourceKind]: OAuthImportDestination;
};
export interface OAuthImportAppliedEvent {
    kind: OAuthSourceKind;
    action: Extract<OAuthImportCommitAction, "imported" | "overwritten">;
}
export interface OAuthImportRouteOptions extends OAuthImportSessionOptions, OAuthSourcePathOptions {
    onImported?: (event: OAuthImportAppliedEvent) => void | Promise<void>;
}
export interface OAuthImportSourcesResponse {
    sources: OAuthSourceDiscovery[];
}
export interface OAuthImportCancelResult {
    ok: true;
    cancelled: boolean;
}
/** Register same-origin CLI source import routes when the Web server is composed. */
export declare function registerOAuthImportRoutes(ctx: OAuthImportRouteContext, destinations: OAuthImportDestinations, options?: OAuthImportRouteOptions): void;
export declare function oauthImportErrorStatus(error: unknown): number;
//# sourceMappingURL=oauth-import-routes.d.ts.map
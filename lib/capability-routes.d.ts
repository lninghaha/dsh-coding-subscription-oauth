/**
 * Plugin-owned same-origin Web routes for the capability-settings namespace.
 * Arbitrary Host settings namespaces are not remotely exposed, so this plugin
 * publishes only the secret-free snapshot and the two optional read surfaces.
 * @module dsh-coding-subscription-oauth/capability-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type CapabilitySettings, type CapabilitySettingsPatch, type CapabilitySettingsSnapshot } from "./capability-settings.ts";
export declare const CAPABILITY_SETTINGS_PATH = "/plugins/dsh-grok-build/capabilities";
export declare const CODEX_USAGE_PATH = "/plugins/dsh-grok-build/codex/usage";
export declare const IMAGINE_CREDENTIAL_STATUS_PATH = "/plugins/dsh-grok-build/imagine/credential-status";
/** Structural `ctx.webServer` + `ctx.effect` surface used by the registrar. */
export interface CapabilityRouteContext {
    readonly webServer: {
        register(route: {
            kind: "exact" | "prefix";
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    effect(callback: () => void | (() => void | Promise<void>), label?: string): unknown;
}
/** Owner-facing subset of {@link import("./capability-settings.ts").CapabilitySettingsController}. */
export interface CapabilityRouteController {
    snapshot(): CapabilitySettingsSnapshot;
    current(): CapabilitySettings;
    patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
    replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
}
/** Secret-free Imagine credential probe returned on the optional status route. */
export interface ImagineCredentialStatus {
    readonly configured: boolean;
    readonly source: string;
    readonly writable: boolean;
}
export interface CapabilityRouteOptions {
    readonly controller: CapabilityRouteController;
    readonly usage?: () => unknown | Promise<unknown>;
    readonly credentialInfo?: () => unknown | Promise<unknown>;
}
/** Register the plugin-owned capability routes. Owns and returns the route disposer. */
export declare function registerCapabilityRoutes(ctx: CapabilityRouteContext, options: CapabilityRouteOptions): () => void;
//# sourceMappingURL=capability-routes.d.ts.map
/**
 * Atomic registration helper for plugin-owned Web routes.
 * `webServer.register()` is not fiber-scoped, so a later registration failure
 * must release every earlier route before the setup error escapes.
 * @module dsh-coding-subscription-oauth/web-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export interface PluginWebRoute {
    readonly kind: "exact" | "prefix";
    readonly path: string;
    readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface PluginWebRouteRegistry {
    register(route: PluginWebRoute): () => void;
}
/** Run imperative route setup or roll every successful registration back. */
export declare function registerWebRouteSetupAtomically(registry: PluginWebRouteRegistry, setup: (tracked: PluginWebRouteRegistry) => unknown): () => void;
/** Register all routes or leave the registry exactly as it was. */
export declare function registerWebRoutesAtomically(registry: PluginWebRouteRegistry, routes: readonly PluginWebRoute[]): () => void;
//# sourceMappingURL=web-routes.d.ts.map
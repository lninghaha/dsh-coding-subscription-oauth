/**
 * GET {api}/oauth/limits[?provider=<slug>[&force=1]] — secret-free limit gauges.
 * @module dsh-coding-subscription-oauth/limits-routes
 */
import { type LimitsReader } from "./limits.js";
import { type OwnerRequestPolicy } from "./web-origin.js";
import { registerWebRouteSetupAtomically } from "./web-routes.js";
type WebServerLike = Parameters<typeof registerWebRouteSetupAtomically>[0];
export interface LimitsRouteContext {
    readonly webServer: WebServerLike;
    effect(factory: () => () => void, name?: string): unknown;
}
/** Register the limits route. Returns the disposer. */
export declare function registerLimitsRoutes(ctx: LimitsRouteContext, reader: LimitsReader, ownerRequestPolicy?: OwnerRequestPolicy): () => void;
export {};
//# sourceMappingURL=limits-routes.d.ts.map
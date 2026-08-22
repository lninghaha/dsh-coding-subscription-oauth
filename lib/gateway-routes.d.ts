/**
 * Settings-facing routes for the opt-in local API gateway.
 * @module dsh-coding-subscription-oauth/gateway-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodingOAuthGatewayController } from "./gateway.js";
import { type OwnerRequestPolicy } from "./web-origin.js";
export { GATEWAY_REVEAL_PATH, GATEWAY_ROTATE_PATH, GATEWAY_SETTINGS_PATH } from "./ids.js";
export interface GatewayRouteContext {
    readonly webServer: {
        register(route: {
            kind: "exact" | "prefix";
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    effect(callback: () => () => void | Promise<void>, label?: string): unknown;
}
export declare function registerGatewayRoutes(ctx: GatewayRouteContext, controller: CodingOAuthGatewayController, ownerRequestPolicy?: OwnerRequestPolicy): () => void;
//# sourceMappingURL=gateway-routes.d.ts.map
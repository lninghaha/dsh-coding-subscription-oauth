/**
 * Settings-facing routes for the opt-in local API gateway.
 * @module dsh-coding-subscription-oauth/gateway-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodingOAuthGatewayController } from "./gateway.js";
export declare const GATEWAY_SETTINGS_PATH = "/plugins/dsh-grok-build/gateway";
export declare const GATEWAY_REVEAL_PATH = "/plugins/dsh-grok-build/gateway/reveal";
export declare const GATEWAY_ROTATE_PATH = "/plugins/dsh-grok-build/gateway/rotate";
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
export declare function registerGatewayRoutes(ctx: GatewayRouteContext, controller: CodingOAuthGatewayController): () => void;
//# sourceMappingURL=gateway-routes.d.ts.map
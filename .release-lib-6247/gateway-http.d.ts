/**
 * Isolated node:http server for the opt-in local gateway.
 * @module dsh-coding-subscription-oauth/gateway-http
 */
import { type Server } from "node:http";
import { type GatewayBackend } from "./gateway-backend.js";
import { type GatewayConfig } from "./gateway-config.js";
export interface GatewayHttpOptions {
    config: GatewayConfig;
    apiKey: string;
    backend: GatewayBackend;
}
export declare function createGatewayHttpServer(options: GatewayHttpOptions): Server;
export declare function listenGateway(server: Server, config: GatewayConfig): Promise<void>;
export declare function closeGateway(server: Server): Promise<void>;
//# sourceMappingURL=gateway-http.d.ts.map
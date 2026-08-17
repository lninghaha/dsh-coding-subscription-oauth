/**
 * Opt-in local API gateway configuration.
 * @module dsh-coding-subscription-oauth/gateway-config
 */
import z from "@deepseek-ai/schemastery";
export declare const GATEWAY_DEFAULT_BIND = "127.0.0.1";
export declare const GATEWAY_DEFAULT_PORT = 18080;
export interface GatewayConfig {
    readonly enabled: boolean;
    readonly bind: string;
    readonly port: number;
    readonly apiKey?: string;
    readonly rateLimit: number;
}
export declare const GatewayConfigSchema: z<Partial<GatewayConfig>>;
export declare function resolveGatewayConfig(raw?: Partial<GatewayConfig>): GatewayConfig;
export declare function isLoopbackBind(bind: string): boolean;
//# sourceMappingURL=gateway-config.d.ts.map
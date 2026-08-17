/**
 * Opt-in local API gateway configuration.
 * @module dsh-coding-subscription-oauth/gateway-config
 */
import z from "@deepseek-ai/schemastery";
export declare const GATEWAY_DEFAULT_BIND = "127.0.0.1";
export declare const GATEWAY_DEFAULT_PORT = 18080;
export declare const GATEWAY_MIN_PORT = 1024;
export declare const GATEWAY_MAX_PORT = 65535;
export declare const GATEWAY_RANDOM_PORT_MIN = 18100;
export declare const GATEWAY_RANDOM_PORT_MAX = 18999;
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
export declare function assertGatewayPort(port: number): number;
export declare function randomGatewayPort(exclude?: number | readonly number[]): number;
//# sourceMappingURL=gateway-config.d.ts.map
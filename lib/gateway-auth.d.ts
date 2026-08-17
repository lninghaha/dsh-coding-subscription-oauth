/**
 * Owner-only gateway API key file.
 * @module dsh-coding-subscription-oauth/gateway-auth
 */
export declare const GATEWAY_KEY_FILENAME = ".coding-oauth-gateway.json";
declare const KEY_FORMAT_VERSION = 1;
export interface GatewayKeyDocument {
    version: typeof KEY_FORMAT_VERSION;
    apiKey: string;
    enabled?: boolean;
    port?: number;
}
export declare function gatewayKeyPath(dshHome?: string): string;
export declare function generateGatewayApiKey(): string;
export declare function gatewayKeysEqual(left: string, right: string): boolean;
export declare function maskGatewayApiKey(apiKey: string): string;
export declare function loadGatewayKeyDocument(path: string): Promise<GatewayKeyDocument | undefined>;
export declare function loadOrCreateGatewayApiKey(path: string, configured?: string): Promise<string>;
export declare function persistGatewayApiKey(path: string, apiKey: string): Promise<void>;
export declare function persistGatewayKeyDocument(path: string, document: GatewayKeyDocument): Promise<void>;
export {};
//# sourceMappingURL=gateway-auth.d.ts.map
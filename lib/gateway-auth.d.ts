/**
 * Owner-only gateway API key file.
 * @module dsh-coding-subscription-oauth/gateway-auth
 */
export declare const GATEWAY_KEY_FILENAME = ".coding-oauth-gateway.json";
export declare function gatewayKeyPath(dshHome?: string): string;
export declare function generateGatewayApiKey(): string;
export declare function gatewayKeysEqual(left: string, right: string): boolean;
export declare function loadOrCreateGatewayApiKey(path: string, configured?: string): Promise<string>;
export declare function persistGatewayApiKey(path: string, apiKey: string): Promise<void>;
//# sourceMappingURL=gateway-auth.d.ts.map
/**
 * Scoped egress proxy for coding-subscription OAuth and inference traffic.
 * @module dsh-coding-subscription-oauth/proxy
 */
export interface CodingOAuthProxyOptions {
    proxyKimi?: boolean;
}
/** Install one process-wide dispatcher that proxies only the audited host list. */
export declare function ensureCodingOAuthProxy(explicit?: string, options?: CodingOAuthProxyOptions): string | undefined;
export declare function codingOAuthProxyInEffect(): string | undefined;
/** Appended to Grok discovery/token/catalog transport errors when a scoped proxy is installed. */
export declare function codingOAuthProxyUnreachableHint(): string;
//# sourceMappingURL=proxy.d.ts.map
/**
 * Scoped egress proxy for coding-subscription OAuth and inference traffic.
 * @module dsh-coding-subscription-oauth/proxy
 */
export interface CodingOAuthProxyOptions {
    proxyKimi?: boolean;
}
/** Install one process-wide dispatcher that proxies only the audited host list. */
export declare function ensureCodingOAuthProxy(explicit?: string, options?: CodingOAuthProxyOptions): string | undefined;
/** Backward-compatible name retained for existing callers. */
export declare function ensureGrokBuildProxy(explicit?: string): string | undefined;
export declare function codingOAuthProxyInEffect(): string | undefined;
/** Backward-compatible status accessor. */
export declare function grokBuildProxyInEffect(): string | undefined;
//# sourceMappingURL=proxy.d.ts.map
/**
 * Grok Imagine network allowlist / private-IP helpers.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */
/** True when an address is loopback, private, reserved, documentation, or an embedded special form. */
export declare function isBlockedIp(address: string): boolean;
export declare function normalizeHostname(hostname: string): string;
export declare function isBlockedHostname(hostname: string): boolean;
export declare function isAllowlistedImagineHost(hostname: string): boolean;
//# sourceMappingURL=net.d.ts.map
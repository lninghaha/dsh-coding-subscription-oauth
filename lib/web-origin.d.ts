/**
 * Loopback + same-origin authorization shared by private plugin Web routes.
 * Rejecting non-loopback Host values closes DNS-rebinding access even when the
 * TCP peer itself is 127.0.0.1 or ::1.
 * @module dsh-coding-subscription-oauth/web-origin
 */
import type { IncomingMessage } from "node:http";
/** Authorize one browser request for owner-local exact/settings routes. */
export declare function isTrustedLoopbackWebRequest(req: IncomingMessage): boolean;
//# sourceMappingURL=web-origin.d.ts.map
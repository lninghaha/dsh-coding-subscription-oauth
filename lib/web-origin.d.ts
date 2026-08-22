/**
 * Owner-request authorization shared by private plugin Web routes.
 * @module dsh-coding-subscription-oauth/web-origin
 */
import type { IncomingMessage } from "node:http";
import type { OwnerRequestPolicy as CoreOwnerRequestPolicy } from "dsh-coding-oauth-core";
import type { DshCompatibilityDiagnostic } from "./compatibility.js";
export declare const OWNER_PROOF_HEADER = "x-dsh-owner-proof";
export declare const OWNER_CSRF_HEADER = "x-dsh-csrf-token";
export type { OwnerAccessMode } from "dsh-coding-oauth-core";
export interface TrustedReverseProxyPolicyConfig {
    /** Exact TCP peers allowed to inject owner-only headers. Forwarded peers never count. */
    readonly peers?: readonly string[];
    /** Exact browser origins allowed through the trusted proxy. */
    readonly origins?: readonly string[];
    /** Secret injected by the trusted proxy only after owner authentication. */
    readonly ownerProof?: string;
    /** Independent CSRF secret injected by the trusted proxy. */
    readonly csrfToken?: string;
}
export interface OwnerRequestPolicyConfig {
    /** Use when loopback is intentionally reached through an SSH port forward. */
    readonly loopbackAccessMode?: "loopback" | "ssh-tunnel";
    readonly trustedProxy?: TrustedReverseProxyPolicyConfig;
}
export type OwnerRequestPolicy = CoreOwnerRequestPolicy<IncomingMessage, DshCompatibilityDiagnostic>;
/** Adapt a host-owned policy so service churn cannot escape through Web routes. */
export declare function safeguardOwnerRequestPolicy(policy: OwnerRequestPolicy): OwnerRequestPolicy;
/** Build an immutable owner-request policy. Partial proxy configuration is deliberately unusable. */
export declare function createOwnerRequestPolicy(config?: OwnerRequestPolicyConfig): OwnerRequestPolicy;
export declare const LOOPBACK_OWNER_REQUEST_POLICY: OwnerRequestPolicy;
/** Backward-compatible loopback predicate for external callers. */
export declare function isTrustedLoopbackWebRequest(req: IncomingMessage): boolean;
//# sourceMappingURL=web-origin.d.ts.map
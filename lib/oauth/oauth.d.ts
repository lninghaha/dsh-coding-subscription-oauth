/**
 * Grok Build OAuth authorization-code + PKCE flow (primary login path).
 *
 * Mirrors the official Grok CLI: OIDC discovery, S256 PKCE, dual-channel code
 * capture (loopback listener + manual paste), form POST token exchange.
 * The device-code flow remains the fallback (see auth.ts / bin.ts).
 * @module dsh-coding-subscription-oauth/oauth
 */
import type { OAuthCredential } from "@earendil-works/pi-ai";
/** OIDC issuer for both Grok CLI and Grok Build. */
export declare const GROK_BUILD_OAUTH_ISSUER = "https://auth.x.ai";
/**
 * Public client id known to work for the device flow; reused as the default
 * for the authorization-code flow until the official CLI's own id is
 * confirmed (T2.1). Override with GROK_OAUTH2_CLIENT_ID.
 */
export declare const GROK_BUILD_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/** Scopes the official CLI requests (grok-cli:access = CLI inference pass). */
export declare const GROK_BUILD_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
/** Default loopback port observed for the official CLI (codex-app-transfer). */
export declare const GROK_BUILD_OAUTH_DEFAULT_PORT = 56121;
export type GrokBuildOAuthErrorCode = "discovery" | "loopback" | "state_mismatch" | "token_exchange" | "cancelled" | "timeout";
/** OAuth failure with a stable, secret-free machine code. */
export declare class GrokBuildOAuthError extends Error {
    readonly code: GrokBuildOAuthErrorCode;
    constructor(code: GrokBuildOAuthErrorCode, message: string);
}
export interface GrokBuildOAuthParams {
    issuer: string;
    clientId: string;
    scope: string;
    /** Loopback port for the redirect URI; falls forward on EADDRINUSE. */
    port: number;
    /** Optional xAI extension parameter. */
    referrer?: string;
}
/** Resolve OAuth parameters from overrides then GROK_OAUTH2_* env vars. */
export declare function resolveOAuthParams(overrides?: Partial<GrokBuildOAuthParams>): GrokBuildOAuthParams;
interface DiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
}
export interface DiscoveryFetchOptions {
    /** Loopback-only test override: permit `http://127.0.0.1`/`http://[::1]` issuers. */
    readonly allowInsecureLoopbackIssuer?: boolean;
}
/** Fetch (and cache for the process) the issuer's discovery document. */
export declare function discoverOAuthEndpoints(issuer: string, signal?: AbortSignal, options?: DiscoveryFetchOptions): Promise<DiscoveryDocument>;
/** Generate an S256 PKCE verifier/challenge pair (Web Crypto compatible). */
export declare function generatePkce(): {
    verifier: string;
    challenge: string;
};
/** Build the authorization URL for one login attempt. */
export declare function buildAuthorizeUrl(endpoints: DiscoveryDocument, params: GrokBuildOAuthParams, redirectUri: string, challenge: string, state: string, nonce: string): string;
/** Exchange a refresh token for a fresh credential (rotation-tolerant). */
export declare function refreshGrokBuildToken(refreshToken: string, overrides?: Partial<GrokBuildOAuthParams>, signal?: AbortSignal, discoveryOptions?: DiscoveryFetchOptions): Promise<OAuthCredential>;
export interface PkceLoginCallbacks {
    /** Invoked with the authorization URL to display/open for the user. */
    onAuthorizeUrl(url: string): void;
    /**
     * Manual-paste channel: resolve with the code (or full redirect URL) the
     * user pasted. Return undefined to disable this channel. Rejects on cancel.
     */
    awaitCode?: (signal: AbortSignal) => Promise<string | undefined>;
    signal?: AbortSignal;
    timeoutMs?: number;
}
/** Extract a bare code from user input that may be a full redirect URL. */
export declare function extractCode(input: string): string;
/**
 * Run the authorization-code + PKCE login. The code arrives via the loopback
 * listener or the manual-paste channel, whichever wins. The caller persists
 * the returned credential (store.modify under the file lock).
 */
export declare function loginGrokBuildPkce(callbacks: PkceLoginCallbacks, overrides?: Partial<GrokBuildOAuthParams & DiscoveryFetchOptions>): Promise<OAuthCredential>;
export {};
//# sourceMappingURL=oauth.d.ts.map
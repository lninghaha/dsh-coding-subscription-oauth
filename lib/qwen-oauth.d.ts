/**
 * Qwen Code (chat.qwen.ai) OAuth: RFC 8628 device authorization grant with PKCE.
 *
 * pi-ai ships no Qwen subscription flow, so it is implemented here against the
 * public Qwen Code client. The access token authenticates OpenAI-compatible
 * requests to the portal API as `Authorization: Bearer`.
 * @module dsh-coding-subscription-oauth/qwen-oauth
 */
import type { OAuthAuth } from "@earendil-works/pi-ai";
/** Public Qwen Code client id (no secret; PKCE protects the exchange). */
export declare const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
export declare const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
export declare const QWEN_OAUTH_DEFAULT_HOST = "https://chat.qwen.ai";
export declare const QWEN_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Override for tests and private mirrors. Must be https (or http on loopback). */
export declare function qwenOAuthHost(env?: NodeJS.ProcessEnv): string;
export declare function generateQwenPkce(): {
    verifier: string;
    challenge: string;
};
export interface QwenDeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    intervalSeconds: number;
    expiresInSeconds: number;
}
export declare function startQwenDeviceAuthorization(host: string, challenge: string, signal: AbortSignal): Promise<QwenDeviceAuthorization>;
export declare const qwenCodeOAuth: OAuthAuth;
//# sourceMappingURL=qwen-oauth.d.ts.map
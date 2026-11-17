/**
 * Qwen Code subscription OAuth: RFC 8628 device authorization grant against
 * auth.qwen.ai, mirroring the official Qwen Code CLI (`QwenSubscriptionOAuthClient`).
 *
 * pi-ai ships no Qwen subscription flow, so it is implemented here. The device
 * grant is a public client (`qwen-code-cli`) with no PKCE and no client secret.
 * The access token authenticates OpenAI-compatible requests to
 * https://api.qwen.ai/compatible-mode/v1 as `Authorization: Bearer`.
 * @module dsh-coding-subscription-oauth/qwen-oauth
 */
import type { OAuthAuth } from "@earendil-works/pi-ai";
export declare const QWEN_OAUTH_CLIENT_ID = "qwen-code-cli";
export declare const QWEN_OAUTH_SCOPE = "model:invoke profile:read";
export declare const QWEN_OAUTH_DEFAULT_HOST = "https://auth.qwen.ai";
export declare const QWEN_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** The official CLI refuses accounts below these plans. */
export declare const QWEN_ALLOWED_PLANS: readonly string[];
/** Override for tests and private mirrors. Must be https (or http on loopback). */
export declare function qwenOAuthHost(env?: NodeJS.ProcessEnv): string;
export interface QwenDeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    intervalSeconds: number;
    expiresAt: number;
}
export declare function startQwenDeviceAuthorization(host: string, signal: AbortSignal): Promise<QwenDeviceAuthorization>;
export declare const qwenCodeOAuth: OAuthAuth;
//# sourceMappingURL=qwen-oauth.d.ts.map
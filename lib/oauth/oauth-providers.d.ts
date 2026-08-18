/**
 * Native pi-ai OAuth providers and their stable Harness route aliases.
 * @module dsh-coding-subscription-oauth/oauth-providers
 */
import type { Api, Provider } from "@earendil-works/pi-ai";
import { type CodingOAuthProviderSlug } from "../core/ids.js";
export type SubscriptionProviderSlug = Exclude<CodingOAuthProviderSlug, "grok">;
export type SubscriptionLoginMethod = "browser" | "device";
export interface OAuthProviderDefinition {
    slug: SubscriptionProviderSlug;
    route: string;
    nativeProviderId: string;
    displayName: string;
    authFilename: string;
    modelsCacheFilename: string;
    loginMethods: readonly SubscriptionLoginMethod[];
    recommendedLoginMethod: SubscriptionLoginMethod;
    providerFactory(): Provider<Api>;
    requestProvider(selectedIds?: readonly string[]): Provider<Api>;
}
export declare const CODEX_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const KIMI_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const CLAUDE_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const OAUTH_PROVIDER_DEFINITIONS: readonly [OAuthProviderDefinition, OAuthProviderDefinition, OAuthProviderDefinition];
export declare function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined;
//# sourceMappingURL=oauth-providers.d.ts.map
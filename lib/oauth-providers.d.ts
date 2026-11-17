/**
 * Native pi-ai OAuth providers and their stable Harness route aliases.
 * @module dsh-coding-subscription-oauth/oauth-providers
 */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { type CodingOAuthProviderSlug } from "./ids.js";
import { type LiveModelEntry } from "./qwen-provider.js";
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
    /** `catalog` overrides the static model list when the session holds a live one. */
    requestProvider(selectedIds?: readonly string[], catalog?: readonly Model<Api>[]): Provider<Api>;
    /** Optional live account model listing; the session replaces its baseline catalog with it. */
    fetchLiveModels?(accessToken: string, signal: AbortSignal): Promise<readonly LiveModelEntry[]>;
    /** Build a catalog model from a live descriptor; defaults to inheriting the baseline template. */
    liveModel?(entry: LiveModelEntry): Model<Api>;
}
export declare const CODEX_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const KIMI_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const QWEN_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const CLAUDE_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
export declare const OAUTH_PROVIDER_DEFINITIONS: readonly [OAuthProviderDefinition, OAuthProviderDefinition, OAuthProviderDefinition, OAuthProviderDefinition];
export declare function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined;
//# sourceMappingURL=oauth-providers.d.ts.map
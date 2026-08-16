/**
 * Persistent OAuth session and static model selection for one subscription provider.
 * @module dsh-coding-subscription-oauth/oauth-session
 */
import type { Api, AuthInteraction, Credential, Model, MutableModels, OAuthCredential, Provider } from "@earendil-works/pi-ai";
import type { OAuthProviderDefinition } from "./oauth-providers.ts";
import { OAuthCredentialFileStore } from "./store.ts";
export declare function oauthModelsCachePath(basename: string, dshHome?: string): string;
export interface OAuthProviderStatus {
    authenticated: boolean;
    expiresAt?: number;
}
export declare class OAuthProviderSession {
    readonly definition: OAuthProviderDefinition;
    readonly store: OAuthCredentialFileStore;
    readonly models: MutableModels;
    private readonly catalog;
    private readonly cacheFile;
    private selectedIds;
    constructor(definition: OAuthProviderDefinition, onCatalogChange?: () => void, store?: OAuthCredentialFileStore, cacheFile?: string);
    private onCatalogChange;
    availableModels(): Model<Api>[];
    selectedModelIds(): string[] | undefined;
    visibleModels(): Model<Api>[];
    provider(): Provider;
    loadCachedModels(): Promise<void>;
    setSelectedModels(ids: readonly string[]): Promise<void>;
    status(): Promise<OAuthProviderStatus>;
    login(interaction: AuthInteraction): Promise<Credential>;
    resolveAccessToken(): Promise<string | undefined>;
    /**
     * Backdate the stored token's expiry so the next `getAuth()` refreshes.
     * Called after an upstream 401 rejected a locally-valid token.
     */
    invalidateAccessToken(): Promise<void>;
    storedCredential(): Promise<OAuthCredential | undefined>;
    logout(): Promise<void>;
    private writeCache;
}
//# sourceMappingURL=oauth-session.d.ts.map
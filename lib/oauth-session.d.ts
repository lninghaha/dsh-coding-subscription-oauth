/**
 * Persistent OAuth session and static model selection for one subscription provider.
 * @module dsh-coding-subscription-oauth/oauth-session
 */
import type { Api, AuthInteraction, Credential, Model, MutableModels, OAuthCredential, Provider } from "@earendil-works/pi-ai";
import type { OAuthProviderDefinition } from "./oauth-providers.js";
import { type LoginPersistOptions, OAuthCredentialFileStore } from "./store.js";
export declare function oauthModelsCachePath(basename: string, dshHome?: string): string;
export interface OAuthProviderStatus {
    authenticated: boolean;
    expiresAt?: number;
}
export declare class OAuthProviderSession {
    readonly definition: OAuthProviderDefinition;
    readonly store: OAuthCredentialFileStore;
    readonly models: MutableModels;
    private readonly baseline;
    private catalog;
    private readonly cacheFile;
    private readonly liveCacheFile;
    private liveRefreshedAt;
    private liveInFlight;
    /** Bumped on logout so an in-flight listing cannot repopulate a signed-out catalog. */
    private liveGeneration;
    private selectedIds;
    private readonly cacheQueue;
    constructor(definition: OAuthProviderDefinition, onCatalogChange?: () => void, store?: OAuthCredentialFileStore, cacheFile?: string);
    private onCatalogChange;
    availableModels(): Model<Api>[];
    selectedModelIds(): string[] | undefined;
    visibleModels(): Model<Api>[];
    provider(): Provider;
    loadCachedModels(): Promise<void>;
    /** Live entries inherit transport fields from the baseline template, never from the network/cache. */
    private materializeLive;
    /**
     * Replace the baseline catalog with the account's live model list. Best effort: any
     * failure keeps the last good catalog and retries later. De-duplicated and TTL-gated.
     */
    refreshLiveModels(force?: boolean): Promise<void>;
    setSelectedModels(ids: readonly string[] | undefined): Promise<void>;
    status(): Promise<OAuthProviderStatus>;
    login(interaction: AuthInteraction, persist?: LoginPersistOptions): Promise<Credential>;
    resolveAccessToken(): Promise<string | undefined>;
    /**
     * Backdate the stored token's expiry so the next `getAuth()` refreshes.
     * Called after an upstream 401 rejected a locally-valid token.
     */
    invalidateAccessToken(): Promise<void>;
    /** Refresh host discovery after an account switch/remove without a full logout. */
    notifyCredentialChange(): void;
    storedCredential(): Promise<OAuthCredential | undefined>;
    logout(): Promise<void>;
    private writeCache;
}
//# sourceMappingURL=oauth-session.d.ts.map
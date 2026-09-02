/**
 * Shared OAuth store + live catalog for the host plugin and CLI.
 * @module dsh-coding-subscription-oauth/session
 */
import type { Api, Model, MutableModels, Provider } from "@earendil-works/pi-ai";
import { type CatalogSource } from "./catalog.js";
import { GrokBuildCredentialStore } from "./store.js";
/** One process-local owner of the credential and the account model list. */
export declare class GrokBuildSession {
    readonly store: GrokBuildCredentialStore;
    readonly models: MutableModels;
    private readonly baselineCatalog;
    private liveIds;
    private liveModels;
    private selectedIds;
    private source;
    private listingError;
    private readonly cacheFile;
    private onCatalogChange;
    constructor(store?: GrokBuildCredentialStore, onCatalogChange?: () => void);
    /** Secret-free listing diagnostic from the last refresh. */
    get catalogError(): string | undefined;
    get catalogSource(): CatalogSource;
    availableModels(): Model<Api>[];
    selectedModelIds(): string[] | undefined;
    visibleModels(): Model<Api>[];
    /** Provider whose id matches the harness route so PiAiAdapter can list models. */
    provider(): Provider;
    loadCachedCatalog(): Promise<void>;
    refreshLiveCatalog(signal?: AbortSignal): Promise<void>;
    setSelectedModels(ids: readonly string[]): Promise<void>;
    /**
     * Backdate the stored token's expiry so the next `getAuth()` refreshes.
     * Called after an upstream 401 rejected a locally-valid token.
     */
    invalidateAccessToken(): Promise<void>;
    /** Refresh host discovery after an account switch/remove without a full logout. */
    notifyCredentialChange(): void;
    logout(): Promise<void>;
    private writeCache;
}
//# sourceMappingURL=session.d.ts.map
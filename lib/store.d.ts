/**
 * Owner-only persistent OAuth credential storage for coding-subscription routes.
 * @module dsh-coding-subscription-oauth/store
 */
import type { Credential, CredentialInfo, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
/** On-disk multi-account format. Readers still accept v1 and migrate under lock. */
declare const AUTH_FORMAT_VERSION: 2;
/** Operator-owned account hard cap (Settings + store). Aligned with Hub. */
export declare const OAUTH_MAX_ACCOUNTS = 8;
/** How a login or import writes into the multi-account document. */
export type LoginPersistMode = "add" | "overwrite-active";
export interface LoginPersistOptions {
    mode: LoginPersistMode;
    confirmOverwrite?: boolean;
}
/** Non-empty account id; max 128; restricted charset for path-safe operator labels. */
export type AccountId = string;
export interface AccountRecord {
    id: AccountId;
    label?: string;
    credential: OAuthCredential;
    createdAt: number;
}
export interface AuthDocumentV2 {
    version: typeof AUTH_FORMAT_VERSION;
    activeAccountId: AccountId;
    accounts: AccountRecord[];
}
/** Non-secret row for Settings account lists. Never includes tokens. */
export interface AccountSummary {
    id: AccountId;
    label?: string;
    expires: number;
    accountId?: string;
}
export declare function isValidAccountId(value: unknown): value is AccountId;
/**
 * Prefer provider `credential.accountId` when path-safe; otherwise mint a unique
 * operator id so multiple anonymous logins do not collide on `legacy`.
 */
export declare function resolveAccountIdForCredential(credential: OAuthCredential): AccountId;
/** Resolve one private OAuth document path beneath DSH_HOME. */
export declare function oauthCredentialPath(basename: string, dshHome?: string): string;
/** Resolve the legacy Grok Build OAuth document path. */
export declare function grokBuildAuthPath(dshHome?: string): string;
/**
 * File-backed pi-ai store scoped to exactly one provider id. Separate provider
 * files prevent one corrupted or rotated credential from affecting another.
 * On disk the file may hold up to eight operator-owned accounts; CredentialStore
 * methods always project the active account only.
 */
export declare class OAuthCredentialFileStore implements CredentialStore {
    readonly providerId: string;
    private readonly label;
    readonly filename: string;
    private loginPersist;
    constructor(providerId: string, filename: string, label: string);
    private readCurrent;
    /**
     * Hardened load. `read`/`list` keep parse failures loud. `modify` treats a
     * safe-but-unparseable document as absent so a confirmed replace can proceed.
     * Unsafe/symlink/wrong-owner/too-large files still throw.
     */
    private loadCurrent;
    private loadDocument;
    /** Refuse a dest that became unsafe after the lock was taken and before rename. */
    private assertDestinationReplaceable;
    private writeDocument;
    private nextDocumentAfterLogin;
    private mutateDocument;
    read(providerId: string): Promise<Credential | undefined>;
    list(): Promise<readonly CredentialInfo[]>;
    modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    /**
     * Redirect `modify` writes (pi-ai `models.login`) through multi-account upsert
     * semantics for the duration of `fn`.
     */
    runLoginPersist<T>(options: LoginPersistOptions, fn: () => Promise<T>): Promise<T>;
    /** Persist a login/import credential without going through pi-ai `modify`. */
    persistLoginCredential(credential: OAuthCredential, options: LoginPersistOptions): Promise<void>;
    /**
     * Force the next `getAuth()` to refresh by backdating `expires` into the past.
     * Used after an upstream 401: the stored access token was rejected even though
     * the local expiry had not yet passed (server-side revocation or skew). The
     * access/refresh pair is preserved — only the freshness marker moves — so the
     * refresh token can still mint a replacement. Returns true when a credential
     * was actually backdated; false when nothing is stored.
     */
    invalidate(providerId: string): Promise<boolean>;
    delete(providerId: string): Promise<void>;
    /** Read-only account list for Settings / API. Never includes tokens. */
    listAccounts(): Promise<readonly AccountSummary[]>;
    getActiveAccountId(): Promise<string | undefined>;
    /**
     * Read one account's credential without changing activeAccountId.
     * Used by the optional quota-aware pool proxy for sticky per-request routing.
     */
    readAccount(id: string): Promise<OAuthCredential | undefined>;
    /**
     * Serialized refresh/write for one account id. Does not move activeAccountId.
     * Returns undefined when the account is absent (caller treats as missing credential).
     */
    modifyAccount(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    setActiveAccount(id: string): Promise<void>;
    upsertAccount(input: {
        id: string;
        label?: string;
        credential: OAuthCredential;
        makeActive?: boolean;
    }): Promise<void>;
    removeAccount(id: string): Promise<void>;
}
/** Legacy-named store retained for existing imports and credential migration. */
export declare class GrokBuildCredentialStore extends OAuthCredentialFileStore {
    constructor(filename?: string);
}
export {};
//# sourceMappingURL=store.d.ts.map
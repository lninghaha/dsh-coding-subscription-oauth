/** Same-origin Web settings routes for Grok Build OAuth. */
import type { Context } from "@deepseek-ai/cordis";
import type { CatalogSource } from "./catalog.js";
import type { DshCompatibility } from "./compatibility.js";
import { ANTIGRAVITY_ROUTE, type CodingOAuthProviderSlug } from "./ids.js";
import type { SubscriptionLoginMethod } from "./oauth-providers.js";
import type { OAuthProviderSession } from "./oauth-session.js";
import type { GrokBuildSession } from "./session.js";
import type { AccountSummary } from "./store.js";
import { type OwnerAccessMode, type OwnerRequestPolicy } from "./web-origin.js";
export { CODING_OAUTH_ACCOUNTS_REMOVE_PATH, CODING_OAUTH_ACCOUNTS_SET_ACTIVE_PATH, CODING_OAUTH_LOGIN_CANCEL_PATH, CODING_OAUTH_LOGIN_CODE_PATH, CODING_OAUTH_LOGIN_PATH, CODING_OAUTH_LOGOUT_PATH, CODING_OAUTH_MODELS_PATH, CODING_OAUTH_STATUS_PATH, GROK_BUILD_AUTH_IMPORT_PATH, GROK_BUILD_AUTH_LOGIN_CANCEL_PATH, GROK_BUILD_AUTH_LOGIN_CODE_PATH, GROK_BUILD_AUTH_LOGIN_PATH, GROK_BUILD_AUTH_LOGOUT_PATH, GROK_BUILD_AUTH_MODELS_PATH, GROK_BUILD_AUTH_STATUS_PATH, } from "./ids.js";
export type GrokBuildLoginMethod = "pkce" | "device";
export type GrokBuildWebAuthStatus = {
    status: "signed-out";
    grokImportAvailable: boolean;
} | {
    status: "signing-in";
    method: GrokBuildLoginMethod;
    url?: string;
    userCode?: string;
    grokImportAvailable: boolean;
} | {
    status: "signed-in";
    models: string[];
    available: string[];
    selected: string[];
    catalogSource: CatalogSource;
    catalogError?: string;
    grokImportAvailable: boolean;
    accounts: AccountSummary[];
    activeAccountId: string;
} | {
    status: "error";
    message: string;
    grokImportAvailable: boolean;
};
export interface LoginChallenge {
    method: GrokBuildLoginMethod;
    url: string;
    userCode?: string;
}
/**
 * One lifecycle owner for the pending login (PKCE or device), the published
 * challenge, the pasted-code channel, and the public status.
 */
export declare class GrokBuildWebAuth {
    private readonly session;
    private state;
    private operation;
    private cancellation;
    private method;
    private challenge;
    private challengeWaiters;
    private codeResolver;
    constructor(session: GrokBuildSession);
    status(): Promise<GrokBuildWebAuthStatus>;
    /** Start (or join) a login. A different method aborts and restarts the flow. */
    signIn(method: GrokBuildLoginMethod): Promise<LoginChallenge>;
    /** Hand a pasted authorization code (or redirect URL) to a pending PKCE login. */
    submitCode(code: string): Promise<void>;
    /** Abort a pending login without touching any stored credential. */
    cancel(): Promise<void>;
    importGrok(): Promise<void>;
    setModels(ids: readonly string[]): Promise<void>;
    setActiveAccount(id: string): Promise<void>;
    removeAccount(id: string): Promise<void>;
    signOut(): Promise<void>;
    dispose(): Promise<void>;
    private start;
    private runPkce;
    private runDevice;
    private onEvent;
    private acceptChallenge;
    private readStoredStatus;
    private rejectChallenge;
}
export type SubscriptionWebAuthStatus = {
    provider: Exclude<CodingOAuthProviderSlug, "grok">;
    route: string;
    displayName: string;
    loginMethods: readonly SubscriptionLoginMethod[];
    recommendedLoginMethod: SubscriptionLoginMethod;
    models: string[];
    available: string[];
    selected: string[];
} & ({
    status: "signed-out";
} | {
    status: "signing-in";
    method: SubscriptionLoginMethod;
    url?: string;
    userCode?: string;
} | {
    status: "signed-in";
    expiresAt?: number;
    accounts: AccountSummary[];
    activeAccountId: string;
} | {
    status: "error";
    message: string;
});
export interface SubscriptionLoginChallenge {
    method: SubscriptionLoginMethod;
    url: string;
    userCode?: string;
}
/** Web lifecycle for one pi-ai subscription OAuth provider. */
export declare class SubscriptionWebAuth {
    readonly session: OAuthProviderSession;
    private readonly challengeTimeoutMs;
    private state;
    private operation;
    private cancellation;
    private method;
    private challenge;
    private challengeWaiters;
    private codeResolver;
    constructor(session: OAuthProviderSession, challengeTimeoutMs?: number);
    status(): Promise<SubscriptionWebAuthStatus>;
    signIn(method: SubscriptionLoginMethod): Promise<SubscriptionLoginChallenge>;
    submitCode(code: string): Promise<void>;
    cancel(): Promise<void>;
    setModels(ids: readonly string[]): Promise<void>;
    setActiveAccount(id: string): Promise<void>;
    removeAccount(id: string): Promise<void>;
    signOut(): Promise<void>;
    dispose(): Promise<void>;
    private baseStatus;
    private readStoredStatus;
    private start;
    private run;
    private awaitCode;
    private onEvent;
    private acceptChallenge;
    private rejectChallenge;
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
export declare function registerGrokBuildAuthRoutes(ctx: Context, session: GrokBuildSession, existingAuth?: GrokBuildWebAuth, ownerRequestPolicy?: OwnerRequestPolicy): void;
export interface CodingOAuthWebStatus {
    accessMode: OwnerAccessMode;
    uiOwner: "standalone" | "hub";
    compatibility: DshCompatibility;
    providers: {
        grok: GrokBuildWebAuthStatus;
        codex: SubscriptionWebAuthStatus;
        kimi: SubscriptionWebAuthStatus;
        claude: SubscriptionWebAuthStatus;
    };
    antigravity: {
        installed: boolean;
        route: typeof ANTIGRAVITY_ROUTE;
        management: "cli";
    };
}
/** Register the unified Coding OAuth API plus the compatibility Grok routes. */
export declare function registerCodingOAuthRoutes(ctx: Context, grokSession: GrokBuildSession, subscriptionSessions: readonly OAuthProviderSession[], ownerRequestPolicy?: OwnerRequestPolicy, compatibility?: (accessMode: OwnerAccessMode) => DshCompatibility): void;
//# sourceMappingURL=auth-routes.d.ts.map
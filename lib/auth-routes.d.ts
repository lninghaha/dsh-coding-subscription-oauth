/** Same-origin Web settings routes for Grok Build OAuth. */
import type { Context } from "@deepseek-ai/cordis";
import type { CatalogSource } from "./catalog.js";
import { ANTIGRAVITY_ROUTE, type CodingOAuthProviderSlug } from "./ids.js";
import type { SubscriptionLoginMethod } from "./oauth-providers.js";
import type { OAuthProviderSession } from "./oauth-session.js";
import type { GrokBuildSession } from "./session.js";
export declare const GROK_BUILD_AUTH_STATUS_PATH = "/plugins/dsh-grok-build/auth/status";
export declare const GROK_BUILD_AUTH_LOGIN_PATH = "/plugins/dsh-grok-build/auth/login";
export declare const GROK_BUILD_AUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/auth/login/code";
export declare const GROK_BUILD_AUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/auth/login/cancel";
export declare const GROK_BUILD_AUTH_IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
export declare const GROK_BUILD_AUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/auth/logout";
export declare const GROK_BUILD_AUTH_MODELS_PATH = "/plugins/dsh-grok-build/auth/models";
export declare const CODING_OAUTH_STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
export declare const CODING_OAUTH_LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
export declare const CODING_OAUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
export declare const CODING_OAUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
export declare const CODING_OAUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
export declare const CODING_OAUTH_MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
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
export declare function registerGrokBuildAuthRoutes(ctx: Context, session: GrokBuildSession, existingAuth?: GrokBuildWebAuth): void;
export interface CodingOAuthWebStatus {
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
export declare function registerCodingOAuthRoutes(ctx: Context, grokSession: GrokBuildSession, subscriptionSessions: readonly OAuthProviderSession[]): void;
//# sourceMappingURL=auth-routes.d.ts.map
import z from "@deepseek-ai/schemastery";
import { GenerateOptions, LlmAdapter, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { Api, AuthInteraction, Credential, CredentialInfo, CredentialStore, Model, MutableModels, OAuthCredential, Provider } from "@earendil-works/pi-ai";
import { Context } from "@deepseek-ai/cordis";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
//#region src/ids.d.ts
/** pi-ai provider ids used by login, refresh, and credential storage. */
declare const XAI_PI_PROVIDER = "xai";
declare const CODEX_PI_PROVIDER = "openai-codex";
declare const KIMI_PI_PROVIDER = "kimi-coding";
declare const CLAUDE_PI_PROVIDER = "anthropic";
/** Harness LLM routes. OAuth aliases avoid the user's API-key route ids. */
declare const GROK_BUILD_ROUTE = "grok-build";
declare const CODEX_OAUTH_ROUTE = "codex-oauth";
declare const KIMI_CODE_OAUTH_ROUTE = "kimi-code-oauth";
declare const CLAUDE_CODE_OAUTH_ROUTE = "claude-code-oauth";
declare const ANTIGRAVITY_ROUTE = "agy";
declare const CODING_OAUTH_ROUTES: readonly ["grok-build", "codex-oauth", "kimi-code-oauth", "claude-code-oauth"];
type CodingOAuthRoute = typeof CODING_OAUTH_ROUTES[number];
type CodingOAuthProviderSlug = 'grok' | 'codex' | 'kimi' | 'claude';
/** Basenames of private OAuth documents inside the Harness home. */
declare const GROK_BUILD_AUTH_FILENAME = ".grok-build-auth.json";
declare const CODEX_OAUTH_AUTH_FILENAME = ".codex-oauth-auth.json";
declare const KIMI_CODE_OAUTH_AUTH_FILENAME = ".kimi-code-oauth-auth.json";
declare const CLAUDE_CODE_OAUTH_AUTH_FILENAME = ".claude-code-oauth-auth.json";
/** Basenames of model selection/catalog caches inside the Harness home. */
declare const GROK_BUILD_MODELS_CACHE_FILENAME = ".grok-build-models.json";
declare const CODEX_OAUTH_MODELS_CACHE_FILENAME = ".codex-oauth-models.json";
declare const KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME = ".kimi-code-oauth-models.json";
declare const CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME = ".claude-code-oauth-models.json";
/** Fallback model when no live Grok catalog listing is available. */
declare const DEFAULT_GROK_BUILD_MODEL = "grok-4.5";
/** Provider idle ceiling used by every composite route. */
declare const GROK_BUILD_STREAM_IDLE_TIMEOUT_MS = 300000;
//#endregion
//#region src/oauth-providers.d.ts
type SubscriptionProviderSlug = Exclude<CodingOAuthProviderSlug, 'grok'>;
type SubscriptionLoginMethod = 'browser' | 'device';
interface OAuthProviderDefinition {
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
declare const CODEX_OAUTH_PROVIDER: OAuthProviderDefinition;
declare const KIMI_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
declare const CLAUDE_CODE_OAUTH_PROVIDER: OAuthProviderDefinition;
declare const OAUTH_PROVIDER_DEFINITIONS: readonly [OAuthProviderDefinition, OAuthProviderDefinition, OAuthProviderDefinition];
declare function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined;
//#endregion
//#region src/store.d.ts
/** Resolve one private OAuth document path beneath DSH_HOME. */
declare function oauthCredentialPath(basename: string, dshHome?: string): string;
/** Resolve the legacy Grok Build OAuth document path. */
declare function grokBuildAuthPath(dshHome?: string): string;
/**
 * File-backed pi-ai store scoped to exactly one provider id. Separate provider
 * files prevent one corrupted or rotated credential from affecting another.
 */
declare class OAuthCredentialFileStore implements CredentialStore {
  readonly providerId: string;
  private readonly label;
  readonly filename: string;
  constructor(providerId: string, filename: string, label: string);
  private readCurrent;
  read(providerId: string): Promise<Credential | undefined>;
  list(): Promise<readonly CredentialInfo[]>;
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  delete(providerId: string): Promise<void>;
}
/** Legacy-named store retained for existing imports and credential migration. */
declare class GrokBuildCredentialStore extends OAuthCredentialFileStore {
  constructor(filename?: string);
}
//#endregion
//#region src/oauth-session.d.ts
declare function oauthModelsCachePath(basename: string, dshHome?: string): string;
interface OAuthProviderStatus {
  authenticated: boolean;
  expiresAt?: number;
}
declare class OAuthProviderSession {
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
  storedCredential(): Promise<OAuthCredential | undefined>;
  logout(): Promise<void>;
  private writeCache;
}
//#endregion
//#region src/catalog.d.ts
type CatalogSource = 'live' | 'cache' | 'fallback';
/**
 * Pull model ids from a listing body. The `/v1/models-v2` response shape is
 * not a published contract, so accept the common envelopes: a bare array, an
 * OpenAI-style `{ data: [...] }`, or `{ models: [...] }`; rows may be plain
 * ids or objects with an `id` field.
 */
declare function extractModelIds(body: unknown): string[];
/** Turn a live id into a pi-ai model, inheriting baseline metadata when possible. */
declare function materializeLiveModel(id: string, catalog?: readonly Model<Api>[]): Model<Api>;
/**
 * If `liveIds` is missing or empty, serve the baseline catalog.
 * Otherwise serve only the live ids, each materialized against the baseline.
 */
declare function mergeLiveCatalog(catalog: readonly Model<Api>[], liveIds: readonly string[] | undefined): Model<Api>[];
declare function preferredGrokBuildModelFrom(models: readonly {
  id: string;
}[]): string;
/**
 * Fetch the account-visible model ids from `/v1/models-v2` with the CLI
 * fingerprint headers. Throws a secret-free error on failure.
 */
declare function fetchLiveModelIds(accessToken: string, signal?: AbortSignal): Promise<string[]>;
//#endregion
//#region src/session.d.ts
/** One process-local owner of the credential and the account model list. */
declare class GrokBuildSession {
  readonly store: GrokBuildCredentialStore;
  readonly models: MutableModels;
  private readonly baselineCatalog;
  private liveIds;
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
  logout(): Promise<void>;
  private writeCache;
}
//#endregion
//#region src/adapter.d.ts
/** Prefer grok-4.5 when the current (live or baseline) list has it. */
declare function preferredGrokBuildModel(models?: readonly {
  id: string;
}[]): string;
/** Existing Grok-only constructor retained for public API compatibility. */
declare function createGrokBuildAdapter(session: GrokBuildSession, resolveAttachments: () => AttachmentStore | undefined): PiAiAdapter;
/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
declare function createCodingOAuthAdapter(grok: GrokBuildSession, subscriptions: readonly OAuthProviderSession[], resolveAttachments: () => AttachmentStore | undefined): LlmAdapter;
//#endregion
//#region src/alias-adapter.d.ts
interface AliasLlmRoutePolicy {
  /** User-facing provider name shown above models in the model selector. */
  displayName?: string;
  /** Return false to hide every model for this route from discovery. */
  isAuthenticated?: () => Promise<boolean>;
}
/**
 * Keeps pi-ai model.provider identities native while exposing collision-free
 * Harness route names. Every public operation translates exactly once.
 */
declare class AliasLlmAdapter extends LlmAdapter {
  private readonly inner;
  private readonly aliases;
  private readonly policies;
  constructor(inner: LlmAdapter, aliases: ReadonlyMap<string, string>, policies?: ReadonlyMap<string, AliasLlmRoutePolicy>);
  private nativeProvider;
  providerInfo(provider: string): LlmProviderInfo;
  providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//#endregion
//#region src/auth.d.ts
/** Non-secret login state shown by the launcher. */
interface GrokBuildAuthStatus {
  authenticated: boolean;
  expiresAt?: Date;
}
/**
 * Complete the xAI device-code OAuth flow and persist the credential.
 * The Grok Build backend accepts the same auth.x.ai tokens (scope
 * `grok-cli:access`); the PKCE authorization-code flow lands in a later
 * milestone as the primary path.
 */
declare function loginGrokBuild(interaction: AuthInteraction, store?: GrokBuildCredentialStore): Promise<void>;
/** Copy ~/.grok/auth.json into the dsh store. Does not modify the Grok file. */
declare function importGrokBuildFromGrok(store?: GrokBuildCredentialStore, filename?: string): Promise<void>;
/** Remove the stored Grok Build credential. */
declare function logoutGrokBuild(store?: GrokBuildCredentialStore): Promise<void>;
/** Read non-secret login state without refreshing the token. */
declare function grokBuildAuthStatus(store?: GrokBuildCredentialStore): Promise<GrokBuildAuthStatus>;
/** Login then refresh the account model list when a session is available. */
declare function loginGrokBuildSession(interaction: AuthInteraction, session: GrokBuildSession): Promise<void>;
declare function importGrokBuildSession(session: GrokBuildSession, filename?: string): Promise<void>;
//#endregion
//#region src/auth-routes.d.ts
declare const GROK_BUILD_AUTH_STATUS_PATH = "/plugins/dsh-grok-build/auth/status";
declare const GROK_BUILD_AUTH_LOGIN_PATH = "/plugins/dsh-grok-build/auth/login";
declare const GROK_BUILD_AUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/auth/login/code";
declare const GROK_BUILD_AUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/auth/login/cancel";
declare const GROK_BUILD_AUTH_IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
declare const GROK_BUILD_AUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/auth/logout";
declare const GROK_BUILD_AUTH_MODELS_PATH = "/plugins/dsh-grok-build/auth/models";
declare const CODING_OAUTH_STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
declare const CODING_OAUTH_LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
declare const CODING_OAUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
declare const CODING_OAUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
declare const CODING_OAUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
declare const CODING_OAUTH_MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
type GrokBuildLoginMethod = 'pkce' | 'device';
type GrokBuildWebAuthStatus = {
  status: 'signed-out';
  grokImportAvailable: boolean;
} | {
  status: 'signing-in';
  method: GrokBuildLoginMethod;
  url?: string;
  userCode?: string;
  grokImportAvailable: boolean;
} | {
  status: 'signed-in';
  models: string[];
  available: string[];
  selected: string[];
  catalogSource: CatalogSource;
  catalogError?: string;
  grokImportAvailable: boolean;
} | {
  status: 'error';
  message: string;
  grokImportAvailable: boolean;
};
interface LoginChallenge {
  method: GrokBuildLoginMethod;
  url: string;
  userCode?: string;
}
/**
 * One lifecycle owner for the pending login (PKCE or device), the published
 * challenge, the pasted-code channel, and the public status.
 */
declare class GrokBuildWebAuth {
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
type SubscriptionWebAuthStatus = {
  provider: Exclude<CodingOAuthProviderSlug, 'grok'>;
  route: string;
  displayName: string;
  loginMethods: readonly SubscriptionLoginMethod[];
  recommendedLoginMethod: SubscriptionLoginMethod;
  models: string[];
  available: string[];
  selected: string[];
} & ({
  status: 'signed-out';
} | {
  status: 'signing-in';
  method: SubscriptionLoginMethod;
  url?: string;
  userCode?: string;
} | {
  status: 'signed-in';
  expiresAt?: number;
} | {
  status: 'error';
  message: string;
});
interface SubscriptionLoginChallenge {
  method: SubscriptionLoginMethod;
  url: string;
  userCode?: string;
}
/** Web lifecycle for one pi-ai subscription OAuth provider. */
declare class SubscriptionWebAuth {
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
declare function registerGrokBuildAuthRoutes(ctx: Context, session: GrokBuildSession, existingAuth?: GrokBuildWebAuth): void;
interface CodingOAuthWebStatus {
  providers: {
    grok: GrokBuildWebAuthStatus;
    codex: SubscriptionWebAuthStatus;
    kimi: SubscriptionWebAuthStatus;
    claude: SubscriptionWebAuthStatus;
  };
  antigravity: {
    installed: boolean;
    route: typeof ANTIGRAVITY_ROUTE;
    management: 'cli';
  };
}
/** Register the unified Coding OAuth API plus the compatibility Grok routes. */
declare function registerCodingOAuthRoutes(ctx: Context, grokSession: GrokBuildSession, subscriptionSessions: readonly OAuthProviderSession[]): void;
//#endregion
//#region src/grok-import.d.ts
interface GrokImportProbe {
  available: boolean;
  path: string;
}
/** Resolve the Grok CLI auth document. */
declare function grokAuthPath(home?: string): string;
/** Parse a Grok CLI / generic OAuth document into a pi-ai credential. */
declare function parseGrokAuthDocument(text: string, filename: string): OAuthCredential;
/** Whether ~/.grok/auth.json exists and looks importable. Never returns secrets. */
declare function probeGrokAuth(filename?: string): Promise<GrokImportProbe>;
/** Copy Grok CLI tokens into the dsh store. Does not write the Grok file. */
declare function importGrokAuth(store: GrokBuildCredentialStore, filename?: string): Promise<OAuthCredential>;
//#endregion
//#region src/provider.d.ts
/** Inference backend base URL (Responses API lives under `${baseUrl}/responses`). */
declare const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Account model catalog endpoint fetched by the official CLI. */
declare const GROK_BUILD_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models-v2";
/**
 * Official Grok CLI version this plugin fingerprints as.
 * Track the `@xai-official/grok` npm release stream; make overridable via
 * GROK_BUILD_CLIENT_VERSION for urgent drift fixes without a release.
 */
declare const GROK_CLIENT_VERSION: string;
/**
 * Fingerprint headers required by the Grok Build middleware. Missing headers
 * are a known 403 trigger (codex-app-transfer field notes, 2026-07).
 */
declare function grokBuildFingerprintHeaders(): Record<string, string>;
/** Static baseline catalog, used until a live `/models-v2` listing succeeds. */
declare function grokBuildBaselineModels(): Model<'openai-responses'>[];
/**
 * Build the Grok Build pi-ai provider. Auth is apiKey-shaped: the OAuth
 * access token is injected as the bearer key by the surrounding adapter
 * (`Models.getAuth` on the login provider performs refresh under the store
 * lock before the key ever reaches here).
 */
declare function grokBuildProvider(models: readonly Model<Api>[]): Provider;
//#endregion
//#region src/oauth.d.ts
/** OIDC issuer for both Grok CLI and Grok Build. */
declare const GROK_BUILD_OAUTH_ISSUER = "https://auth.x.ai";
/**
 * Public client id known to work for the device flow; reused as the default
 * for the authorization-code flow until the official CLI's own id is
 * confirmed (T2.1). Override with GROK_OAUTH2_CLIENT_ID.
 */
declare const GROK_BUILD_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/** Scopes the official CLI requests (grok-cli:access = CLI inference pass). */
declare const GROK_BUILD_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
/** Default loopback port observed for the official CLI (codex-app-transfer). */
declare const GROK_BUILD_OAUTH_DEFAULT_PORT = 56121;
type GrokBuildOAuthErrorCode = 'discovery' | 'loopback' | 'state_mismatch' | 'token_exchange' | 'cancelled' | 'timeout';
/** OAuth failure with a stable, secret-free machine code. */
declare class GrokBuildOAuthError extends Error {
  readonly code: GrokBuildOAuthErrorCode;
  constructor(code: GrokBuildOAuthErrorCode, message: string);
}
interface GrokBuildOAuthParams {
  issuer: string;
  clientId: string;
  scope: string;
  /** Loopback port for the redirect URI; falls forward on EADDRINUSE. */
  port: number;
  /** Optional xAI extension parameter. */
  referrer?: string;
}
/** Resolve OAuth parameters from overrides then GROK_OAUTH2_* env vars. */
declare function resolveOAuthParams(overrides?: Partial<GrokBuildOAuthParams>): GrokBuildOAuthParams;
interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
}
/** Fetch (and cache for the process) the issuer's discovery document. */
declare function discoverOAuthEndpoints(issuer: string, signal?: AbortSignal): Promise<DiscoveryDocument>;
/** Generate an S256 PKCE verifier/challenge pair (Web Crypto compatible). */
declare function generatePkce(): {
  verifier: string;
  challenge: string;
};
/** Build the authorization URL for one login attempt. */
declare function buildAuthorizeUrl(endpoints: DiscoveryDocument, params: GrokBuildOAuthParams, redirectUri: string, challenge: string, state: string, nonce: string): string;
/** Exchange a refresh token for a fresh credential (rotation-tolerant). */
declare function refreshGrokBuildToken(refreshToken: string, overrides?: Partial<GrokBuildOAuthParams>, signal?: AbortSignal): Promise<OAuthCredential>;
interface PkceLoginCallbacks {
  /** Invoked with the authorization URL to display/open for the user. */
  onAuthorizeUrl(url: string): void;
  /**
   * Manual-paste channel: resolve with the code (or full redirect URL) the
   * user pasted. Return undefined to disable this channel. Rejects on cancel.
   */
  awaitCode?: (signal: AbortSignal) => Promise<string | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Extract a bare code from user input that may be a full redirect URL. */
declare function extractCode(input: string): string;
/**
 * Run the authorization-code + PKCE login. The code arrives via the loopback
 * listener or the manual-paste channel, whichever wins. The caller persists
 * the returned credential (store.modify under the file lock).
 */
declare function loginGrokBuildPkce(callbacks: PkceLoginCallbacks, overrides?: Partial<GrokBuildOAuthParams>): Promise<OAuthCredential>;
//#endregion
//#region src/proxy.d.ts
/**
 * Scoped egress proxy for coding-subscription OAuth and inference traffic.
 * @module dsh-grok-build/proxy
 */
interface CodingOAuthProxyOptions {
  proxyKimi?: boolean;
}
/** Install one process-wide dispatcher that proxies only the audited host list. */
declare function ensureCodingOAuthProxy(explicit?: string, options?: CodingOAuthProxyOptions): string | undefined;
/** Backward-compatible name retained for existing callers. */
declare function ensureGrokBuildProxy(explicit?: string): string | undefined;
declare function codingOAuthProxyInEffect(): string | undefined;
/** Backward-compatible status accessor. */
declare function grokBuildProxyInEffect(): string | undefined;
//#endregion
//#region src/redact.d.ts
/** Remove token-like strings from an external OAuth diagnostic. */
declare function safeMessage(error: unknown): string;
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "llm-grok-build-oauth";
/** LLM registry required before the subscription route can register. */
declare const inject: string[];
/** Plugin configuration; every field is optional. */
interface Config {
  /** HTTP(S) proxy URL for the audited coding-subscription host allowlist. */
  proxy?: string;
  /** Kimi China traffic stays direct unless explicitly opted into the proxy. */
  proxyKimi?: boolean;
}
declare const Config: z<Config>;
/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { ANTIGRAVITY_ROUTE, AliasLlmAdapter, type AliasLlmRoutePolicy, CLAUDE_CODE_OAUTH_AUTH_FILENAME, CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME, CLAUDE_CODE_OAUTH_PROVIDER, CLAUDE_CODE_OAUTH_ROUTE, CLAUDE_PI_PROVIDER, CODEX_OAUTH_AUTH_FILENAME, CODEX_OAUTH_MODELS_CACHE_FILENAME, CODEX_OAUTH_PROVIDER, CODEX_OAUTH_ROUTE, CODEX_PI_PROVIDER, CODING_OAUTH_LOGIN_CANCEL_PATH, CODING_OAUTH_LOGIN_CODE_PATH, CODING_OAUTH_LOGIN_PATH, CODING_OAUTH_LOGOUT_PATH, CODING_OAUTH_MODELS_PATH, CODING_OAUTH_ROUTES, CODING_OAUTH_STATUS_PATH, type CatalogSource, type CodingOAuthProviderSlug, type CodingOAuthProxyOptions, type CodingOAuthRoute, type CodingOAuthWebStatus, Config, DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_AUTH_FILENAME, GROK_BUILD_AUTH_IMPORT_PATH, GROK_BUILD_AUTH_LOGIN_CANCEL_PATH, GROK_BUILD_AUTH_LOGIN_CODE_PATH, GROK_BUILD_AUTH_LOGIN_PATH, GROK_BUILD_AUTH_LOGOUT_PATH, GROK_BUILD_AUTH_MODELS_PATH, GROK_BUILD_AUTH_STATUS_PATH, GROK_BUILD_BASE_URL, GROK_BUILD_MODELS_CACHE_FILENAME, GROK_BUILD_MODELS_URL, GROK_BUILD_OAUTH_CLIENT_ID, GROK_BUILD_OAUTH_DEFAULT_PORT, GROK_BUILD_OAUTH_ISSUER, GROK_BUILD_OAUTH_SCOPE, GROK_BUILD_ROUTE, GROK_BUILD_STREAM_IDLE_TIMEOUT_MS, GROK_CLIENT_VERSION, type GrokBuildAuthStatus, GrokBuildCredentialStore, type GrokBuildLoginMethod, GrokBuildOAuthError, type GrokBuildOAuthErrorCode, type GrokBuildOAuthParams, GrokBuildSession, GrokBuildWebAuth, type GrokBuildWebAuthStatus, type GrokImportProbe, KIMI_CODE_OAUTH_AUTH_FILENAME, KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME, KIMI_CODE_OAUTH_PROVIDER, KIMI_CODE_OAUTH_ROUTE, KIMI_PI_PROVIDER, type LoginChallenge, OAUTH_PROVIDER_DEFINITIONS, OAuthCredentialFileStore, type OAuthProviderDefinition, OAuthProviderSession, type OAuthProviderStatus, type PkceLoginCallbacks, type SubscriptionLoginChallenge, type SubscriptionLoginMethod, type SubscriptionProviderSlug, SubscriptionWebAuth, type SubscriptionWebAuthStatus, XAI_PI_PROVIDER, apply, buildAuthorizeUrl, codingOAuthProxyInEffect, createCodingOAuthAdapter, createGrokBuildAdapter, discoverOAuthEndpoints, ensureCodingOAuthProxy, ensureGrokBuildProxy, extractCode, extractModelIds, fetchLiveModelIds, generatePkce, grokAuthPath, grokBuildAuthPath, grokBuildAuthStatus, grokBuildBaselineModels, grokBuildFingerprintHeaders, grokBuildProvider, grokBuildProxyInEffect, importGrokAuth, importGrokBuildFromGrok, importGrokBuildSession, inject, loginGrokBuild, loginGrokBuildPkce, loginGrokBuildSession, logoutGrokBuild, materializeLiveModel, mergeLiveCatalog, name, oauthCredentialPath, oauthModelsCachePath, oauthProviderDefinition, parseGrokAuthDocument, preferredGrokBuildModel, preferredGrokBuildModelFrom, probeGrokAuth, refreshGrokBuildToken, registerCodingOAuthRoutes, registerGrokBuildAuthRoutes, resolveOAuthParams, safeMessage };
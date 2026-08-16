/**
 * Grok Build OAuth orchestration shared by the plugin and standalone CLI.
 * @module dsh-coding-subscription-oauth/auth
 */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { GrokBuildSession } from "./session.ts";
import { GrokBuildCredentialStore } from "./store.ts";
/** Non-secret login state shown by the launcher. */
export interface GrokBuildAuthStatus {
    authenticated: boolean;
    expiresAt?: Date;
}
/**
 * Complete the xAI device-code OAuth flow and persist the credential.
 * The Grok Build backend accepts the same auth.x.ai tokens (scope
 * `grok-cli:access`); the PKCE authorization-code flow lands in a later
 * milestone as the primary path.
 */
export declare function loginGrokBuild(interaction: AuthInteraction, store?: GrokBuildCredentialStore): Promise<void>;
/** Copy ~/.grok/auth.json into the dsh store. Does not modify the Grok file. */
export declare function importGrokBuildFromGrok(store?: GrokBuildCredentialStore, filename?: string): Promise<void>;
/** Remove the stored Grok Build credential. */
export declare function logoutGrokBuild(store?: GrokBuildCredentialStore): Promise<void>;
/** Read non-secret login state without refreshing the token. */
export declare function grokBuildAuthStatus(store?: GrokBuildCredentialStore): Promise<GrokBuildAuthStatus>;
/** Login then refresh the account model list when a session is available. */
export declare function loginGrokBuildSession(interaction: AuthInteraction, session: GrokBuildSession): Promise<void>;
export declare function importGrokBuildSession(session: GrokBuildSession, filename?: string): Promise<void>;
//# sourceMappingURL=auth.d.ts.map
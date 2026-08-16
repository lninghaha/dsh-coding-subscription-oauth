/**
 * Grok Build OAuth orchestration shared by the plugin and standalone CLI.
 * @module dsh-coding-subscription-oauth/auth
 */

import type { AuthInteraction } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { importGrokAuth } from "./grok-import.ts";
import { XAI_PI_PROVIDER } from "./ids.ts";
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
export async function loginGrokBuild(
	interaction: AuthInteraction,
	store: GrokBuildCredentialStore = new GrokBuildCredentialStore(),
): Promise<void> {
	const models = createModels({ credentials: store });
	models.setProvider(xaiProvider());
	await models.login(XAI_PI_PROVIDER, "oauth", interaction);
}

/** Copy ~/.grok/auth.json into the dsh store. Does not modify the Grok file. */
export async function importGrokBuildFromGrok(
	store: GrokBuildCredentialStore = new GrokBuildCredentialStore(),
	filename?: string,
): Promise<void> {
	await importGrokAuth(store, filename);
}

/** Remove the stored Grok Build credential. */
export async function logoutGrokBuild(store: GrokBuildCredentialStore = new GrokBuildCredentialStore()): Promise<void> {
	await store.delete(XAI_PI_PROVIDER);
}

/** Read non-secret login state without refreshing the token. */
export async function grokBuildAuthStatus(
	store: GrokBuildCredentialStore = new GrokBuildCredentialStore(),
): Promise<GrokBuildAuthStatus> {
	const credential = await store.read(XAI_PI_PROVIDER);
	return credential?.type === "oauth"
		? { authenticated: true, expiresAt: new Date(credential.expires) }
		: { authenticated: false };
}

/** Login then refresh the account model list when a session is available. */
export async function loginGrokBuildSession(interaction: AuthInteraction, session: GrokBuildSession): Promise<void> {
	await loginGrokBuild(interaction, session.store);
	await session.refreshLiveCatalog();
}

export async function importGrokBuildSession(session: GrokBuildSession, filename?: string): Promise<void> {
	await importGrokBuildFromGrok(session.store, filename);
	await session.refreshLiveCatalog();
}

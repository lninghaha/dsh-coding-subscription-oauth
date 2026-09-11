/** Runtime-owner probe shared by the client settings entry. */

/** One host-served client entry from `window.__DSH_BOOT__`. */
interface ClientBootEntry {
	readonly id?: unknown;
}

/** The Usage Center hub's client entry id in the host boot payload. */
const HUB_CLIENT_ENTRY_ID = "dsh-hub-oauth-gateway";

/**
 * Whether the Usage Center hub's browser half is part of this page.
 *
 * The host publishes `window.__DSH_BOOT__.entries` before any client plugin
 * applies, so this is the ownership signal readable *synchronously* while
 * `apply` runs — and it has to be synchronous: a settings-section registration
 * only reaches the settings registry inside the plugin's own apply window, so a
 * registration that waits for the status probe never appears at all.
 *
 * The hub's client registers its own "Accounts & Models" section
 * unconditionally, so hiding this plugin's duplicate entry can never leave the
 * surface without an owner.
 */
export function hubClientLoaded(): boolean {
	const boot = globalThis as { readonly __DSH_BOOT__?: { readonly entries?: readonly ClientBootEntry[] } };
	const entries = boot.__DSH_BOOT__?.entries;
	if (!Array.isArray(entries)) return false;
	return entries.some((entry) => entry !== null && typeof entry === "object" && entry.id === HUB_CLIENT_ENTRY_ID);
}

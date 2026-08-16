/**
 * One-shot import of Grok CLI credentials into the dsh-owned store.
 * The source file is never written. Refresh tokens rotate, so later dsh
 * refresh may invalidate ~/.grok/auth.json — that is documented, not a bug.
 * @module dsh-coding-subscription-oauth/grok-import
 */
import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { GrokBuildCredentialStore } from "./store.js";
export interface GrokImportProbe {
    available: boolean;
    path: string;
}
/** Resolve the Grok CLI auth document. */
export declare function grokAuthPath(home?: string): string;
/** Parse a Grok CLI / generic OAuth document into a pi-ai credential. */
export declare function parseGrokAuthDocument(text: string, filename: string): OAuthCredential;
/** Whether ~/.grok/auth.json exists and looks importable. Never returns secrets. */
export declare function probeGrokAuth(filename?: string): Promise<GrokImportProbe>;
/** Copy Grok CLI tokens into the dsh store. Does not write the Grok file. */
export declare function importGrokAuth(store: GrokBuildCredentialStore, filename?: string): Promise<OAuthCredential>;
//# sourceMappingURL=grok-import.d.ts.map
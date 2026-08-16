/**
 * Owner-only persistent OAuth credential storage for coding-subscription routes.
 * @module dsh-coding-subscription-oauth/store
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type { Credential, CredentialInfo, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { GROK_BUILD_AUTH_FILENAME, XAI_PI_PROVIDER } from "./ids.ts";
import { OAuthSourceError, readHardenedOAuthSourceFile } from "./oauth-sources.ts";

/** Current on-disk format; readers reject every other version. */
const AUTH_FORMAT_VERSION = 1;

interface AuthDocument {
	version: typeof AUTH_FORMAT_VERSION;
	credential: OAuthCredential;
}

function parseDocument(text: string, filename: string, label: string): AuthDocument {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`${label}: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label}: ${filename} must contain an object`);
	}
	const document = value as Record<string, unknown>;
	if (document["version"] !== AUTH_FORMAT_VERSION) {
		throw new Error(`${label}: ${filename} has unsupported auth format version ${String(document["version"])}`);
	}
	if (Object.keys(document).some((key) => key !== "version" && key !== "credential")) {
		throw new Error(`${label}: ${filename} contains an unknown top-level field`);
	}
	const raw = document["credential"];
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${label}: ${filename} credential must be an object`);
	}
	const credential = raw as Record<string, unknown>;
	const allowed = new Set(["type", "access", "refresh", "expires", "accountId"]);
	if (Object.keys(credential).some((key) => !allowed.has(key))) {
		throw new Error(`${label}: ${filename} credential contains an unknown field`);
	}
	if (credential["type"] !== "oauth") throw new Error(`${label}: ${filename} credential type must be oauth`);
	for (const key of ["access", "refresh"] as const) {
		if (typeof credential[key] !== "string" || credential[key].length === 0) {
			throw new Error(`${label}: ${filename} credential ${key} must be a non-empty string`);
		}
	}
	if (
		credential["accountId"] !== undefined &&
		(typeof credential["accountId"] !== "string" || credential["accountId"].length === 0)
	) {
		throw new Error(`${label}: ${filename} credential accountId must be a non-empty string when present`);
	}
	if (
		typeof credential["expires"] !== "number" ||
		!Number.isFinite(credential["expires"]) ||
		credential["expires"] <= 0
	) {
		throw new Error(`${label}: ${filename} credential expires must be a positive finite number`);
	}
	return { version: AUTH_FORMAT_VERSION, credential: credential as unknown as OAuthCredential };
}

function cloneCredential(credential: OAuthCredential): OAuthCredential {
	return structuredClone(credential);
}

/** Resolve one private OAuth document path beneath DSH_HOME. */
export function oauthCredentialPath(basename: string, dshHome?: string): string {
	return resolve(join(resolveDshHome(dshHome), basename));
}

/** Resolve the legacy Grok Build OAuth document path. */
export function grokBuildAuthPath(dshHome?: string): string {
	return oauthCredentialPath(GROK_BUILD_AUTH_FILENAME, dshHome);
}

/**
 * File-backed pi-ai store scoped to exactly one provider id. Separate provider
 * files prevent one corrupted or rotated credential from affecting another.
 */
export class OAuthCredentialFileStore implements CredentialStore {
	readonly filename: string;

	constructor(
		readonly providerId: string,
		filename: string,
		private readonly label: string,
	) {
		this.filename = resolve(filename);
	}

	private async readCurrent(): Promise<OAuthCredential | undefined> {
		return this.loadCurrent({ allowUnreadable: false });
	}

	/**
	 * Hardened load. `read`/`list` keep parse failures loud. `modify` treats a
	 * safe-but-unparseable document as absent so a confirmed replace can proceed.
	 * Unsafe/symlink/wrong-owner/too-large files still throw.
	 */
	private async loadCurrent(options: { allowUnreadable: boolean }): Promise<OAuthCredential | undefined> {
		let text: string;
		try {
			text = (await readHardenedOAuthSourceFile(this.filename)).text;
		} catch (error) {
			if (error instanceof OAuthSourceError && error.code === "not_found") return undefined;
			if (error instanceof OAuthSourceError && error.code === "unsafe_source") {
				throw new Error(`${this.label}: credential file failed owner-only no-follow validation`);
			}
			throw error;
		}
		try {
			return cloneCredential(parseDocument(text, this.filename, this.label).credential);
		} catch (error) {
			if (options.allowUnreadable) return undefined;
			throw error;
		}
	}

	/** Refuse a dest that became unsafe after the lock was taken and before rename. */
	private async assertDestinationReplaceable(): Promise<void> {
		try {
			await readHardenedOAuthSourceFile(this.filename);
		} catch (error) {
			if (error instanceof OAuthSourceError && error.code === "not_found") return;
			if (error instanceof OAuthSourceError && (error.code === "unsafe_source" || error.code === "too_large")) {
				throw new Error(`${this.label}: credential file failed owner-only no-follow validation`);
			}
			throw error;
		}
	}

	async read(providerId: string): Promise<Credential | undefined> {
		return providerId === this.providerId ? this.readCurrent() : undefined;
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return (await this.readCurrent()) === undefined ? [] : [{ providerId: this.providerId, type: "oauth" }];
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		if (providerId !== this.providerId) {
			throw new Error(`${this.label}: credential store does not own provider "${providerId}"`);
		}
		await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
		return withFileLock(this.filename, async () => {
			const current = await this.loadCurrent({ allowUnreadable: true });
			const candidate = await fn(current);
			if (candidate === undefined) return current;
			const document = parseDocument(
				JSON.stringify({
					version: AUTH_FORMAT_VERSION,
					credential: candidate,
				}),
				this.filename,
				this.label,
			);
			await this.assertDestinationReplaceable();
			await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
				mode: 0o600,
				dirMode: 0o700,
			});
			return cloneCredential(document.credential);
		});
	}

	/**
	 * Force the next `getAuth()` to refresh by backdating `expires` into the past.
	 * Used after an upstream 401: the stored access token was rejected even though
	 * the local expiry had not yet passed (server-side revocation or skew). The
	 * access/refresh pair is preserved — only the freshness marker moves — so the
	 * refresh token can still mint a replacement. Returns true when a credential
	 * was actually backdated; false when nothing is stored.
	 */
	async invalidate(providerId: string): Promise<boolean> {
		if (providerId !== this.providerId) return false;
		let invalidated = false;
		await this.modify(providerId, async (current) => {
			if (current?.type !== "oauth") return undefined;
			invalidated = true;
			return { ...current, expires: Date.now() - 1000 };
		});
		return invalidated;
	}

	async delete(providerId: string): Promise<void> {
		if (providerId !== this.providerId) return;
		await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
		await withFileLock(this.filename, () => rm(this.filename, { force: true }));
	}
}

/** Legacy-named store retained for existing imports and credential migration. */
export class GrokBuildCredentialStore extends OAuthCredentialFileStore {
	constructor(filename: string = grokBuildAuthPath()) {
		super(XAI_PI_PROVIDER, filename, "grok-build");
	}
}

/**
 * Owner-only persistent OAuth credential storage for coding-subscription routes.
 * @module dsh-coding-subscription-oauth/store
 */

import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type { Credential, CredentialInfo, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { GROK_BUILD_AUTH_FILENAME, XAI_PI_PROVIDER } from "./ids.ts";
import { OAuthSourceError, readHardenedOAuthSourceFile } from "./oauth-sources.ts";

/** On-disk multi-account format. Readers still accept v1 and migrate under lock. */
const AUTH_FORMAT_VERSION = 2 as const;
const AUTH_FORMAT_VERSION_V1 = 1 as const;
/** Operator-owned account hard cap (Settings + store). Aligned with Hub. */
export const OAUTH_MAX_ACCOUNTS = 8;
const MAX_ACCOUNTS = OAUTH_MAX_ACCOUNTS;
const LEGACY_ACCOUNT_ID = "legacy";
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:@+-]+$/u;
const UNCHANGED = Symbol("unchanged");

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

export function isValidAccountId(value: unknown): value is AccountId {
	return typeof value === "string" && value.length > 0 && value.length <= 128 && ACCOUNT_ID_PATTERN.test(value);
}

function parseOAuthCredential(raw: unknown, filename: string, label: string): OAuthCredential {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${label}: ${filename} credential must be an object`);
	}
	const credential = raw as Record<string, unknown>;
	const allowed = new Set(["type", "access", "refresh", "expires", "accountId"]);
	if (Object.keys(credential).some((key) => !allowed.has(key))) {
		throw new Error(`${label}: ${filename} credential contains an unknown field`);
	}
	if (credential.type !== "oauth") throw new Error(`${label}: ${filename} credential type must be oauth`);
	for (const key of ["access", "refresh"] as const) {
		if (typeof credential[key] !== "string" || credential[key].length === 0) {
			throw new Error(`${label}: ${filename} credential ${key} must be a non-empty string`);
		}
	}
	if (
		credential.accountId !== undefined &&
		(typeof credential.accountId !== "string" || credential.accountId.length === 0)
	) {
		throw new Error(`${label}: ${filename} credential accountId must be a non-empty string when present`);
	}
	if (typeof credential.expires !== "number" || !Number.isFinite(credential.expires) || credential.expires <= 0) {
		throw new Error(`${label}: ${filename} credential expires must be a positive finite number`);
	}
	return credential as unknown as OAuthCredential;
}

function parseAccountRecord(raw: unknown, filename: string, label: string, index: number): AccountRecord {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${label}: ${filename} accounts[${String(index)}] must be an object`);
	}
	const record = raw as Record<string, unknown>;
	const allowed = new Set(["id", "label", "credential", "createdAt"]);
	if (Object.keys(record).some((key) => !allowed.has(key))) {
		throw new Error(`${label}: ${filename} accounts[${String(index)}] contains an unknown field`);
	}
	if (!isValidAccountId(record.id)) {
		throw new Error(`${label}: ${filename} accounts[${String(index)}].id is not a valid account id`);
	}
	if (record.label !== undefined && (typeof record.label !== "string" || record.label.length === 0)) {
		throw new Error(`${label}: ${filename} accounts[${String(index)}].label must be a non-empty string when present`);
	}
	if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt) || record.createdAt <= 0) {
		throw new Error(`${label}: ${filename} accounts[${String(index)}].createdAt must be a positive finite number`);
	}
	const credential = parseOAuthCredential(record.credential, filename, label);
	return {
		id: record.id,
		...(record.label === undefined ? {} : { label: record.label }),
		credential,
		createdAt: record.createdAt,
	};
}

function parseDocumentV2(document: Record<string, unknown>, filename: string, label: string): AuthDocumentV2 {
	if (Object.keys(document).some((key) => key !== "version" && key !== "activeAccountId" && key !== "accounts")) {
		throw new Error(`${label}: ${filename} contains an unknown top-level field`);
	}
	if (!isValidAccountId(document.activeAccountId)) {
		throw new Error(`${label}: ${filename} activeAccountId is not a valid account id`);
	}
	if (!Array.isArray(document.accounts)) {
		throw new Error(`${label}: ${filename} accounts must be an array`);
	}
	if (document.accounts.length < 1 || document.accounts.length > MAX_ACCOUNTS) {
		throw new Error(`${label}: ${filename} accounts must contain between 1 and ${String(MAX_ACCOUNTS)} entries`);
	}
	const accounts = document.accounts.map((entry, index) => parseAccountRecord(entry, filename, label, index));
	const ids = new Set<string>();
	for (const account of accounts) {
		if (ids.has(account.id)) {
			throw new Error(`${label}: ${filename} accounts contains a duplicate id`);
		}
		ids.add(account.id);
	}
	if (!ids.has(document.activeAccountId)) {
		throw new Error(`${label}: ${filename} activeAccountId does not match any account`);
	}
	return {
		version: AUTH_FORMAT_VERSION,
		activeAccountId: document.activeAccountId,
		accounts,
	};
}

function parseDocumentV1(document: Record<string, unknown>, filename: string, label: string): OAuthCredential {
	if (Object.keys(document).some((key) => key !== "version" && key !== "credential")) {
		throw new Error(`${label}: ${filename} contains an unknown top-level field`);
	}
	return parseOAuthCredential(document.credential, filename, label);
}

/** Parse on-disk JSON into a v2 document. v1 becomes one in-memory account (not yet persisted). */
function parseDocument(
	text: string,
	filename: string,
	label: string,
): { document: AuthDocumentV2; migratedFromV1: boolean } {
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
	if (document.version === AUTH_FORMAT_VERSION_V1) {
		return { document: migrateV1Credential(parseDocumentV1(document, filename, label)), migratedFromV1: true };
	}
	if (document.version === AUTH_FORMAT_VERSION) {
		return { document: parseDocumentV2(document, filename, label), migratedFromV1: false };
	}
	throw new Error(`${label}: ${filename} has unsupported auth format version ${String(document.version)}`);
}

function migrateV1Credential(credential: OAuthCredential): AuthDocumentV2 {
	const accountIdField = (credential as { accountId?: unknown }).accountId;
	const id = isValidAccountId(accountIdField) ? accountIdField : LEGACY_ACCOUNT_ID;
	return {
		version: AUTH_FORMAT_VERSION,
		activeAccountId: id,
		accounts: [
			{
				id,
				credential: cloneCredential(credential),
				createdAt: Date.now(),
			},
		],
	};
}

function cloneCredential(credential: OAuthCredential): OAuthCredential {
	return structuredClone(credential);
}

function cloneDocument(document: AuthDocumentV2): AuthDocumentV2 {
	return structuredClone(document);
}

function activeCredential(document: AuthDocumentV2): OAuthCredential {
	const active = document.accounts.find((account) => account.id === document.activeAccountId);
	if (active === undefined) {
		throw new Error("active account missing from document");
	}
	return cloneCredential(active.credential);
}

/**
 * Prefer provider `credential.accountId` when path-safe; otherwise mint a unique
 * operator id so multiple anonymous logins do not collide on `legacy`.
 */
export function resolveAccountIdForCredential(credential: OAuthCredential): AccountId {
	const accountIdField = (credential as { accountId?: unknown }).accountId;
	if (isValidAccountId(accountIdField)) return accountIdField;
	return `acct-${randomBytes(8).toString("hex")}`;
}

function documentFromCredential(credential: OAuthCredential): AuthDocumentV2 {
	const id = resolveAccountIdForCredential(credential);
	return {
		version: AUTH_FORMAT_VERSION,
		activeAccountId: id,
		accounts: [
			{
				id,
				credential: cloneCredential(credential),
				createdAt: Date.now(),
			},
		],
	};
}

function withUpdatedActiveCredential(document: AuthDocumentV2, credential: OAuthCredential): AuthDocumentV2 {
	const accounts = document.accounts.map((account) =>
		account.id === document.activeAccountId
			? { ...account, credential: cloneCredential(credential) }
			: cloneAccount(account),
	);
	return {
		version: AUTH_FORMAT_VERSION,
		activeAccountId: document.activeAccountId,
		accounts,
	};
}

function cloneAccount(account: AccountRecord): AccountRecord {
	return {
		id: account.id,
		...(account.label === undefined ? {} : { label: account.label }),
		credential: cloneCredential(account.credential),
		createdAt: account.createdAt,
	};
}

function summarizeAccount(account: AccountRecord): AccountSummary {
	const accountIdField = (account.credential as { accountId?: unknown }).accountId;
	return {
		id: account.id,
		...(account.label === undefined ? {} : { label: account.label }),
		expires: account.credential.expires,
		...(typeof accountIdField === "string" && accountIdField.length > 0 ? { accountId: accountIdField } : {}),
	};
}

function validatedDocument(document: AuthDocumentV2, filename: string, label: string): AuthDocumentV2 {
	return parseDocument(JSON.stringify(document), filename, label).document;
}

/** Resolve one private OAuth document path beneath DSH_HOME. */
export function oauthCredentialPath(basename: string, dshHome?: string): string {
	if (
		basename.length === 0 ||
		basename.length > 128 ||
		basename === "." ||
		basename === ".." ||
		!/^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(basename)
	) {
		throw new TypeError("OAuth credential basename must be a safe local filename");
	}
	return resolve(join(resolveDshHome(dshHome), basename));
}

/** Resolve the legacy Grok Build OAuth document path. */
export function grokBuildAuthPath(dshHome?: string): string {
	return oauthCredentialPath(GROK_BUILD_AUTH_FILENAME, dshHome);
}

/**
 * File-backed pi-ai store scoped to exactly one provider id. Separate provider
 * files prevent one corrupted or rotated credential from affecting another.
 * On disk the file may hold up to eight operator-owned accounts; CredentialStore
 * methods always project the active account only.
 */
export class OAuthCredentialFileStore implements CredentialStore {
	readonly filename: string;
	private loginPersist: LoginPersistOptions | undefined;

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
		const loaded = await this.loadDocument({ allowUnreadable: options.allowUnreadable, persistMigration: false });
		return loaded === undefined ? undefined : activeCredential(loaded.document);
	}

	private async loadDocument(options: {
		allowUnreadable: boolean;
		persistMigration: boolean;
	}): Promise<{ document: AuthDocumentV2; migratedFromV1: boolean } | undefined> {
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
			const parsed = parseDocument(text, this.filename, this.label);
			if (options.persistMigration && parsed.migratedFromV1) {
				await this.writeDocument(parsed.document);
			}
			return parsed;
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

	private async writeDocument(document: AuthDocumentV2): Promise<AuthDocumentV2> {
		const validated = validatedDocument(document, this.filename, this.label);
		await this.assertDestinationReplaceable();
		await writeFileAtomic(this.filename, `${JSON.stringify(validated, null, 2)}\n`, {
			mode: 0o600,
			dirMode: 0o700,
		});
		return cloneDocument(validated);
	}

	private nextDocumentAfterLogin(
		current: AuthDocumentV2 | undefined,
		credential: OAuthCredential,
		options: LoginPersistOptions,
	): AuthDocumentV2 {
		const parsed = parseOAuthCredential(credential, this.filename, this.label);
		if (options.mode === "overwrite-active") {
			if (current === undefined) return documentFromCredential(parsed);
			if (options.confirmOverwrite !== true) {
				throw new Error(`${this.label}: confirmOverwrite is required to replace the active account`);
			}
			return withUpdatedActiveCredential(current, parsed);
		}
		const id = resolveAccountIdForCredential(parsed);
		if (current === undefined) {
			return {
				version: AUTH_FORMAT_VERSION,
				activeAccountId: id,
				accounts: [
					{
						id,
						credential: cloneCredential(parsed),
						createdAt: Date.now(),
					},
				],
			};
		}
		const existingIndex = current.accounts.findIndex((account) => account.id === id);
		if (existingIndex < 0 && current.accounts.length >= MAX_ACCOUNTS) {
			throw new Error(`${this.label}: at most ${String(MAX_ACCOUNTS)} accounts may be stored`);
		}
		const accounts = current.accounts.map(cloneAccount);
		if (existingIndex >= 0) {
			const existing = accounts[existingIndex];
			if (existing === undefined) {
				throw new Error(`${this.label}: account "${id}" is not stored`);
			}
			accounts[existingIndex] = {
				id,
				...(existing.label === undefined ? {} : { label: existing.label }),
				credential: cloneCredential(parsed),
				createdAt: existing.createdAt,
			};
		} else {
			accounts.push({
				id,
				credential: cloneCredential(parsed),
				createdAt: Date.now(),
			});
		}
		return {
			version: AUTH_FORMAT_VERSION,
			activeAccountId: id,
			accounts,
		};
	}

	private async mutateDocument(
		options: { allowUnreadable: boolean },
		fn: (current: AuthDocumentV2 | undefined) => Promise<AuthDocumentV2 | undefined | typeof UNCHANGED>,
	): Promise<AuthDocumentV2 | undefined> {
		await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
		return withFileLock(this.filename, async () => {
			const loaded = await this.loadDocument({
				allowUnreadable: options.allowUnreadable,
				persistMigration: false,
			});
			const current = loaded === undefined ? undefined : loaded.document;
			const migratedFromV1 = loaded?.migratedFromV1 === true;
			const next = await fn(current === undefined ? undefined : cloneDocument(current));
			if (next === UNCHANGED) {
				if (migratedFromV1 && current !== undefined) {
					return this.writeDocument(current);
				}
				return current === undefined ? undefined : cloneDocument(current);
			}
			if (next === undefined) {
				await rm(this.filename, { force: true });
				return undefined;
			}
			return this.writeDocument(next);
		});
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
		const document = await this.mutateDocument({ allowUnreadable: true }, async (current) => {
			const active = current === undefined ? undefined : activeCredential(current);
			const candidate = await fn(active);
			if (candidate === undefined) return UNCHANGED;
			if (candidate.type !== "oauth") {
				throw new Error(`${this.label}: ${this.filename} credential type must be oauth`);
			}
			if (this.loginPersist !== undefined) {
				return this.nextDocumentAfterLogin(current, candidate, this.loginPersist);
			}
			if (current === undefined) return documentFromCredential(candidate);
			return withUpdatedActiveCredential(current, candidate);
		});
		return document === undefined ? undefined : activeCredential(document);
	}

	/**
	 * Redirect `modify` writes (pi-ai `models.login`) through multi-account upsert
	 * semantics for the duration of `fn`.
	 */
	async runLoginPersist<T>(options: LoginPersistOptions, fn: () => Promise<T>): Promise<T> {
		if (this.loginPersist !== undefined) {
			throw new Error(`${this.label}: login persist already in progress`);
		}
		this.loginPersist = options;
		try {
			return await fn();
		} finally {
			this.loginPersist = undefined;
		}
	}

	/** Persist a login/import credential without going through pi-ai `modify`. */
	async persistLoginCredential(credential: OAuthCredential, options: LoginPersistOptions): Promise<void> {
		await this.mutateDocument({ allowUnreadable: true }, async (current) =>
			this.nextDocumentAfterLogin(current, credential, options),
		);
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

	/** Read-only account list for Settings / API. Never includes tokens. */
	async listAccounts(): Promise<readonly AccountSummary[]> {
		const document = await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) return UNCHANGED;
			return UNCHANGED;
		});
		if (document === undefined) return [];
		return document.accounts.map(summarizeAccount);
	}

	async getActiveAccountId(): Promise<string | undefined> {
		const document = await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) return UNCHANGED;
			return UNCHANGED;
		});
		return document?.activeAccountId;
	}

	/**
	 * Read one account's credential without changing activeAccountId.
	 * Used by the optional quota-aware pool proxy for sticky per-request routing.
	 */
	async readAccount(id: string): Promise<OAuthCredential | undefined> {
		if (!isValidAccountId(id)) return undefined;
		const document = await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) return UNCHANGED;
			return UNCHANGED;
		});
		const account = document?.accounts.find((entry) => entry.id === id);
		return account === undefined ? undefined : cloneCredential(account.credential);
	}

	/**
	 * Serialized refresh/write for one account id. Does not move activeAccountId.
	 * Returns undefined when the account is absent (caller treats as missing credential).
	 */
	async modifyAccount(
		id: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		if (!isValidAccountId(id)) {
			throw new TypeError(`${this.label}: account id is invalid`);
		}
		const document = await this.mutateDocument({ allowUnreadable: true }, async (current) => {
			if (current === undefined) return UNCHANGED;
			const index = current.accounts.findIndex((account) => account.id === id);
			if (index < 0) return UNCHANGED;
			const existing = current.accounts[index];
			if (existing === undefined) return UNCHANGED;
			const candidate = await fn(cloneCredential(existing.credential));
			if (candidate === undefined) return UNCHANGED;
			if (candidate.type !== "oauth") {
				throw new Error(`${this.label}: ${this.filename} credential type must be oauth`);
			}
			const accounts = current.accounts.map(cloneAccount);
			const target = accounts[index];
			if (target === undefined) return UNCHANGED;
			accounts[index] = {
				...target,
				credential: cloneCredential(candidate),
			};
			return {
				version: AUTH_FORMAT_VERSION,
				activeAccountId: current.activeAccountId,
				accounts,
			};
		});
		if (document === undefined) return undefined;
		const account = document.accounts.find((entry) => entry.id === id);
		return account === undefined ? undefined : cloneCredential(account.credential);
	}

	async setActiveAccount(id: string): Promise<void> {
		if (!isValidAccountId(id)) {
			throw new TypeError(`${this.label}: account id is invalid`);
		}
		await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) {
				throw new Error(`${this.label}: no credential accounts are stored`);
			}
			if (!current.accounts.some((account) => account.id === id)) {
				throw new Error(`${this.label}: account "${id}" is not stored`);
			}
			if (current.activeAccountId === id) return UNCHANGED;
			return {
				version: AUTH_FORMAT_VERSION,
				activeAccountId: id,
				accounts: current.accounts.map(cloneAccount),
			};
		});
	}

	async upsertAccount(input: {
		id: string;
		label?: string;
		credential: OAuthCredential;
		makeActive?: boolean;
	}): Promise<void> {
		if (!isValidAccountId(input.id)) {
			throw new TypeError(`${this.label}: account id is invalid`);
		}
		if (input.label !== undefined && (typeof input.label !== "string" || input.label.length === 0)) {
			throw new TypeError(`${this.label}: account label must be a non-empty string when present`);
		}
		const credential = parseOAuthCredential(input.credential, this.filename, this.label);
		await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) {
				return {
					version: AUTH_FORMAT_VERSION,
					activeAccountId: input.id,
					accounts: [
						{
							id: input.id,
							...(input.label === undefined ? {} : { label: input.label }),
							credential: cloneCredential(credential),
							createdAt: Date.now(),
						},
					],
				};
			}
			const existingIndex = current.accounts.findIndex((account) => account.id === input.id);
			if (existingIndex < 0 && current.accounts.length >= MAX_ACCOUNTS) {
				throw new Error(`${this.label}: at most ${String(MAX_ACCOUNTS)} accounts may be stored`);
			}
			const accounts = current.accounts.map(cloneAccount);
			if (existingIndex >= 0) {
				const existing = accounts[existingIndex];
				if (existing === undefined) {
					throw new Error(`${this.label}: account "${input.id}" is not stored`);
				}
				accounts[existingIndex] = {
					id: input.id,
					...(input.label !== undefined
						? { label: input.label }
						: existing.label === undefined
							? {}
							: { label: existing.label }),
					credential: cloneCredential(credential),
					createdAt: existing.createdAt,
				};
			} else {
				accounts.push({
					id: input.id,
					...(input.label === undefined ? {} : { label: input.label }),
					credential: cloneCredential(credential),
					createdAt: Date.now(),
				});
			}
			return {
				version: AUTH_FORMAT_VERSION,
				activeAccountId: input.makeActive === true ? input.id : current.activeAccountId,
				accounts,
			};
		});
	}

	async removeAccount(id: string): Promise<void> {
		if (!isValidAccountId(id)) {
			throw new TypeError(`${this.label}: account id is invalid`);
		}
		await this.mutateDocument({ allowUnreadable: false }, async (current) => {
			if (current === undefined) return UNCHANGED;
			const accounts = current.accounts.filter((account) => account.id !== id).map(cloneAccount);
			if (accounts.length === current.accounts.length) return UNCHANGED;
			if (accounts.length === 0) return undefined;
			const fallback = accounts[0];
			if (fallback === undefined) return undefined;
			const activeAccountId = current.activeAccountId === id ? fallback.id : current.activeAccountId;
			return {
				version: AUTH_FORMAT_VERSION,
				activeAccountId,
				accounts,
			};
		});
	}
}

/** Legacy-named store retained for existing imports and credential migration. */
export class GrokBuildCredentialStore extends OAuthCredentialFileStore {
	constructor(filename: string = grokBuildAuthPath()) {
		super(XAI_PI_PROVIDER, filename, "grok-build");
	}
}

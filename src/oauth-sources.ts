/**
 * Allowlisted CLI OAuth source discovery, hardened reads, exact parsers, and
 * two-phase preview/commit primitives. The HTTP routes and destination stores
 * stay outside this module so the parent can wire them later.
 * @module dsh-coding-subscription-oauth/oauth-sources
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";
import {
	CLAUDE_PI_PROVIDER,
	CODEX_PI_PROVIDER,
	type CodingOAuthProviderSlug,
	KIMI_PI_PROVIDER,
	XAI_PI_PROVIDER,
} from "./ids.ts";

/** Hard ceiling for a CLI source or destination document. */
export const OAUTH_SOURCE_MAX_BYTES = 64 * 1024;

/** In-memory preview tickets are one-use and live five minutes. */
export const OAUTH_IMPORT_PREVIEW_TTL_MS = 5 * 60 * 1000;

const EXPIRING_SOON_MS = 60 * 60 * 1000;
const PREVIEW_ID_BYTES = 18;
const HMAC_KEY_BYTES = 32;
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

export type OAuthSourceKind = CodingOAuthProviderSlug;

export const OAUTH_SOURCE_KINDS = ["grok", "codex", "kimi", "claude"] as const satisfies readonly OAuthSourceKind[];

export type OAuthImportConflict =
	| "none"
	| "same_credential"
	| "same_account"
	| "different_account"
	| "unknown_account"
	| "unreadable_destination"
	| "unsafe_destination";

export type OAuthImportPreviewAction = "import" | "reuse" | "overwrite" | "blocked";
export type OAuthImportCommitAction = "imported" | "unchanged" | "overwritten";

export type OAuthSourceErrorCode =
	| "not_found"
	| "unsafe_source"
	| "too_large"
	| "invalid_document"
	| "unsupported"
	| "preview_expired"
	| "preview_invalid"
	| "source_changed"
	| "destination_changed"
	| "confirm_required"
	| "unsafe_destination";

export type OAuthSourceUnavailableReason = "missing" | "unsafe" | "invalid" | "too_large";
export type OAuthDestinationStatus = "missing" | "readable" | "unreadable" | "unsafe";

export interface OAuthSourceCredential {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}

export interface OAuthSourceSpec {
	kind: OAuthSourceKind;
	envHome: "GROK_HOME" | "CODEX_HOME" | "KIMI_SHARE_DIR" | "CLAUDE_CONFIG_DIR";
	defaultDir: string;
	relativeFile: string;
	providerId: string;
}

export interface OAuthSourcePathOptions {
	env?: NodeJS.Dict<string>;
	home?: string;
}

export interface OAuthSourceFileIdentity {
	dev: number;
	ino: number;
	size: number;
	uid: number;
	mode: number;
}

export interface HardenedOAuthSourceRead {
	path: string;
	text: string;
	identity: OAuthSourceFileIdentity;
}

export interface OAuthSourceDiscovery {
	kind: OAuthSourceKind;
	displayPath: string;
	available: boolean;
	expiresAt?: number;
	reason?: OAuthSourceUnavailableReason;
}

export interface OAuthSourceProbe {
	kind: OAuthSourceKind;
	available: boolean;
	displayPath: string;
	expiresAt?: number;
	reason?: OAuthSourceUnavailableReason;
}

export interface OAuthImportDestinationView {
	path?: string;
	status?: OAuthDestinationStatus;
	credential?: OAuthSourceCredential;
	revision?: string;
}

export interface OAuthDestinationInspection {
	status: OAuthDestinationStatus;
	identity?: OAuthSourceFileIdentity;
	/** Internal. Never serialize this field to a client. */
	credential?: OAuthSourceCredential;
}

export interface OAuthImportPreview {
	previewId: string;
	kind: OAuthSourceKind;
	displayPath: string;
	expiresAt: number;
	ticketExpiresAt: number;
	conflict: OAuthImportConflict;
	action: OAuthImportPreviewAction;
	warnings: string[];
	confirmOverwriteRequired: boolean;
}

export interface OAuthImportCommitResult {
	action: OAuthImportCommitAction;
	displayPath: string;
	expiresAt: number;
	warnings: string[];
}

export interface OAuthImportSessionOptions {
	now?: () => number;
	ttlMs?: number;
}

export interface OAuthImportPreviewInput extends OAuthSourcePathOptions {
	kind: OAuthSourceKind;
	destination?: OAuthImportDestinationView;
}

export interface OAuthImportCommitInput extends OAuthSourcePathOptions {
	previewId: string;
	confirmOverwrite?: boolean;
	destination?: OAuthImportDestinationView;
}

interface Ticket {
	previewId: string;
	kind: OAuthSourceKind;
	sourcePath: string;
	displayPath: string;
	sourceIdentity: OAuthSourceFileIdentity;
	destinationRevision: string;
	destinationFingerprint: string;
	credential: OAuthSourceCredential;
	conflict: OAuthImportConflict;
	createdAt: number;
	ticketExpiresAt: number;
}

const SOURCE_SPECS: { [K in OAuthSourceKind]: OAuthSourceSpec } = {
	grok: {
		kind: "grok",
		envHome: "GROK_HOME",
		defaultDir: ".grok",
		relativeFile: "auth.json",
		providerId: XAI_PI_PROVIDER,
	},
	codex: {
		kind: "codex",
		envHome: "CODEX_HOME",
		defaultDir: ".codex",
		relativeFile: "auth.json",
		providerId: CODEX_PI_PROVIDER,
	},
	kimi: {
		kind: "kimi",
		envHome: "KIMI_SHARE_DIR",
		defaultDir: ".kimi",
		relativeFile: posix.join("credentials", "kimi-code.json"),
		providerId: KIMI_PI_PROVIDER,
	},
	claude: {
		kind: "claude",
		envHome: "CLAUDE_CONFIG_DIR",
		defaultDir: ".claude",
		relativeFile: ".credentials.json",
		providerId: CLAUDE_PI_PROVIDER,
	},
};

/** Stable allowlist metadata for parent route/store wiring. */
export const OAUTH_SOURCE_SPECS: readonly OAuthSourceSpec[] = OAUTH_SOURCE_KINDS.map((kind) => SOURCE_SPECS[kind]);

/** Secret-free failure from discovery, parse, preview, or commit. */
export class OAuthSourceError extends Error {
	readonly code: OAuthSourceErrorCode;

	constructor(code: OAuthSourceErrorCode, message: string) {
		super(message);
		this.name = "OAuthSourceError";
		this.code = code;
	}
}

export function isOAuthSourceError(error: unknown): error is OAuthSourceError {
	return error instanceof OAuthSourceError;
}

export function isOAuthSourceKind(value: string): value is OAuthSourceKind {
	return (OAUTH_SOURCE_KINDS as readonly string[]).includes(value);
}

export function oauthSourceSpec(kind: OAuthSourceKind): OAuthSourceSpec {
	return SOURCE_SPECS[kind];
}

export function oauthSourceProviderId(kind: OAuthSourceKind): string {
	return SOURCE_SPECS[kind].providerId;
}

/** Resolve one allowlisted CLI auth document. Env/home are injectable for tests. */
export function resolveOAuthSourcePath(kind: OAuthSourceKind, options: OAuthSourcePathOptions = {}): string {
	const spec = SOURCE_SPECS[kind];
	const env = options.env ?? process.env;
	const home = options.home ?? nonEmptyString(env["HOME"]) ?? homedir();
	const override = nonEmptyString(env[spec.envHome]);
	const base = override ?? join(home, spec.defaultDir);
	return resolve(base, spec.relativeFile);
}

/**
 * Client-safe display path. Never returns an absolute filesystem location.
 * Env overrides render as `$GROK_HOME/auth.json`; defaults as `~/.grok/auth.json`.
 */
export function oauthSourceDisplayPath(kind: OAuthSourceKind, options: OAuthSourcePathOptions = {}): string {
	const spec = SOURCE_SPECS[kind];
	const env = options.env ?? process.env;
	if (nonEmptyString(env[spec.envHome]) !== undefined) {
		return `$${spec.envHome}/${spec.relativeFile}`;
	}
	return `~/${posix.join(spec.defaultDir, spec.relativeFile)}`;
}

export function oauthImportRequiresConfirm(conflict: OAuthImportConflict): boolean {
	return conflict !== "none" && conflict !== "same_credential" && conflict !== "unsafe_destination";
}

export function oauthImportPreviewAction(conflict: OAuthImportConflict): OAuthImportPreviewAction {
	if (conflict === "none") return "import";
	if (conflict === "same_credential") return "reuse";
	if (conflict === "unsafe_destination") return "blocked";
	return "overwrite";
}

/**
 * lstat → O_NOFOLLOW open → fstat. Rejects symlinks, non-regular files, non-owner
 * files, group/other access, TOCTOU identity changes, and payloads over 64KiB.
 * POSIX fails closed if O_NOFOLLOW or the process uid is unavailable. Windows
 * skips POSIX uid/mode owner checks but still applies identity and size limits.
 * Never chmod()s or writes the path.
 */
export async function readHardenedOAuthSourceFile(filename: string): Promise<HardenedOAuthSourceRead> {
	const path = resolve(filename);
	let listed: Stats;
	try {
		listed = await lstat(path);
	} catch (error) {
		throw mapReadError(error, "source");
	}
	assertSafeStats(listed, "source", true);

	const flags = openFlags();
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, flags);
		const opened = await handle.stat();
		assertSafeStats(opened, "source", false);
		assertSameIdentity(listed, opened);
		if (opened.size > OAUTH_SOURCE_MAX_BYTES) {
			throw new OAuthSourceError("too_large", "oauth source: file exceeds the 64KiB limit");
		}
		const buffer = await handle.readFile();
		if (buffer.byteLength > OAUTH_SOURCE_MAX_BYTES) {
			throw new OAuthSourceError("too_large", "oauth source: file exceeds the 64KiB limit");
		}
		const after = await handle.stat();
		assertSafeStats(after, "source", false);
		assertSameIdentity(opened, after);
		if (after.size !== buffer.byteLength) {
			throw new OAuthSourceError("unsafe_source", "oauth source: file changed while it was being read");
		}
		return { path, text: buffer.toString("utf8"), identity: identityOf(opened) };
	} catch (error) {
		if (error instanceof OAuthSourceError) throw error;
		throw mapReadError(error, "source");
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

/** Inspect a destination store file with the same hardened reader. Never follows dest. */
export async function inspectOAuthDestinationFile(filename: string): Promise<OAuthDestinationInspection> {
	try {
		const read = await readHardenedOAuthSourceFile(filename);
		const credential = parseStoredOAuthCredentialDocument(read.text);
		if (credential === undefined) {
			return { status: "unreadable", identity: read.identity };
		}
		return { status: "readable", identity: read.identity, credential };
	} catch (error) {
		if (error instanceof OAuthSourceError && error.code === "not_found") {
			return { status: "missing" };
		}
		if (error instanceof OAuthSourceError && (error.code === "unsafe_source" || error.code === "too_large")) {
			return { status: "unsafe" };
		}
		return { status: "unreadable" };
	}
}

export function parseOAuthSourceDocument(kind: OAuthSourceKind, text: string): OAuthSourceCredential {
	switch (kind) {
		case "grok":
			return parseGrokCliAuthDocument(text);
		case "codex":
			return parseCodexCliAuthDocument(text);
		case "kimi":
			return parseKimiCliAuthDocument(text);
		case "claude":
			return parseClaudeCliAuthDocument(text);
	}
}

/**
 * Grok CLI scope map. Selects the auth.x.ai OIDC entry (`key` + `refresh_token`).
 * Expiry must be a valid RFC3339 `expires_at`. Multiple matching entries pick
 * the latest valid expiry.
 */
export function parseGrokCliAuthDocument(text: string): OAuthSourceCredential {
	const value = parseJsonObject(text, "grok CLI auth document");
	const mapped: OAuthSourceCredential[] = [];
	for (const [mapKey, nested] of Object.entries(value)) {
		if (!isRecord(nested)) continue;
		const parsed = grokOidcEntry(nested, mapKey);
		if (parsed !== undefined) mapped.push(parsed);
	}
	const chosen = latestGrokCredential(mapped);
	if (chosen !== undefined) return chosen;
	const direct = grokOidcEntry(value);
	if (direct !== undefined) return direct;
	throw new OAuthSourceError(
		"invalid_document",
		"grok CLI auth document has no auth.x.ai OIDC key, refresh_token, and RFC3339 expires_at",
	);
}

/**
 * Codex CLI `tokens` object. Requires id/access/refresh, JWT `exp` in seconds.
 * Account id prefers official `tokens.account_id`, then top-level `account_id`
 * for compatibility, then the full ChatGPT account id from the access JWT.
 * Rejects API-key documents.
 */
export function parseCodexCliAuthDocument(text: string): OAuthSourceCredential {
	const value = parseJsonObject(text, "codex CLI auth document");
	if (nonEmptyString(value["OPENAI_API_KEY"]) !== undefined) {
		throw new OAuthSourceError("invalid_document", "codex CLI auth document is an API key, not an OAuth session");
	}
	const mode = nonEmptyString(value["auth_mode"]);
	if (mode === "apikey" || mode === "api_key") {
		throw new OAuthSourceError("invalid_document", "codex CLI auth document is an API key, not an OAuth session");
	}
	const tokens = value["tokens"];
	if (!isRecord(tokens)) {
		throw new OAuthSourceError("invalid_document", "codex CLI auth document does not contain a tokens object");
	}
	const access = nonEmptyString(tokens["access_token"]);
	const refresh = nonEmptyString(tokens["refresh_token"]);
	const idToken = nonEmptyString(tokens["id_token"]);
	if (access === undefined || refresh === undefined || idToken === undefined) {
		throw new OAuthSourceError(
			"invalid_document",
			"codex CLI auth document tokens must include id_token, access_token, and refresh_token",
		);
	}
	const expires = jwtExpMs(access) ?? jwtExpMs(idToken);
	if (expires === undefined) {
		throw new OAuthSourceError("invalid_document", "codex CLI auth document tokens do not contain a JWT exp claim");
	}
	const accountId =
		nonEmptyString(tokens["account_id"]) ??
		nonEmptyString(value["account_id"]) ??
		chatgptAccountIdFromAccessJwt(access);
	return credentialOf(access, refresh, expires, accountId);
}

/** Kimi Code CLI document. Snake_case `access_token` / `refresh_token` / `expires_at` seconds. */
export function parseKimiCliAuthDocument(text: string): OAuthSourceCredential {
	const value = parseJsonObject(text, "kimi CLI auth document");
	const access = nonEmptyString(value["access_token"]);
	const refresh = nonEmptyString(value["refresh_token"]);
	const expiresAt = value["expires_at"];
	if (access === undefined || refresh === undefined) {
		throw new OAuthSourceError(
			"invalid_document",
			"kimi CLI auth document must contain access_token and refresh_token",
		);
	}
	if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		throw new OAuthSourceError("invalid_document", "kimi CLI auth document expires_at must be positive Unix seconds");
	}
	const accountId = nonEmptyString(value["user_id"]);
	return credentialOf(access, refresh, expiresAt * 1000, accountId);
}

/** Claude Code CLI document. `claudeAiOauth` camelCase `accessToken` / `refreshToken` / `expiresAt` ms. */
export function parseClaudeCliAuthDocument(text: string): OAuthSourceCredential {
	const value = parseJsonObject(text, "claude CLI auth document");
	const nested = value["claudeAiOauth"];
	if (!isRecord(nested)) {
		throw new OAuthSourceError("invalid_document", "claude CLI auth document does not contain claudeAiOauth");
	}
	const access = nonEmptyString(nested["accessToken"]);
	const refresh = nonEmptyString(nested["refreshToken"]);
	const expiresAt = nested["expiresAt"];
	if (access === undefined || refresh === undefined) {
		throw new OAuthSourceError(
			"invalid_document",
			"claude CLI auth document claudeAiOauth must contain accessToken and refreshToken",
		);
	}
	if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		throw new OAuthSourceError(
			"invalid_document",
			"claude CLI auth document expiresAt must be a positive Unix millisecond value",
		);
	}
	const accountId = nonEmptyString(nested["accountId"]) ?? nonEmptyString(nested["account_id"]);
	return credentialOf(access, refresh, expiresAt, accountId);
}

export async function probeOAuthSource(
	kind: OAuthSourceKind,
	options: OAuthSourcePathOptions = {},
): Promise<OAuthSourceProbe> {
	const displayPath = oauthSourceDisplayPath(kind, options);
	const path = resolveOAuthSourcePath(kind, options);
	try {
		const read = await readHardenedOAuthSourceFile(path);
		const credential = parseOAuthSourceDocument(kind, read.text);
		return { kind, available: true, displayPath, expiresAt: credential.expires };
	} catch (error) {
		return { kind, available: false, displayPath, reason: unavailableReason(error) };
	}
}

export async function discoverOAuthSources(options: OAuthSourcePathOptions = {}): Promise<OAuthSourceDiscovery[]> {
	const listings: OAuthSourceDiscovery[] = [];
	for (const kind of OAUTH_SOURCE_KINDS) {
		listings.push(await probeOAuthSource(kind, options));
	}
	return listings;
}

/**
 * In-memory two-phase import controller. Preview IDs are random, one-use, and
 * expire after five minutes. HMAC fingerprints and persist material stay internal.
 */
export class OAuthImportSession {
	readonly #tickets = new Map<string, Ticket>();
	readonly #hmacKey = randomBytes(HMAC_KEY_BYTES);
	readonly #now: () => number;
	readonly #ttlMs: number;

	constructor(options: OAuthImportSessionOptions = {}) {
		this.#now = options.now ?? Date.now;
		this.#ttlMs = options.ttlMs ?? OAUTH_IMPORT_PREVIEW_TTL_MS;
	}

	async discover(options: OAuthSourcePathOptions = {}): Promise<OAuthSourceDiscovery[]> {
		this.#purge(this.#now());
		return discoverOAuthSources(options);
	}

	async preview(input: OAuthImportPreviewInput): Promise<OAuthImportPreview> {
		if (!isOAuthSourceKind(input.kind)) {
			throw new OAuthSourceError("unsupported", "oauth import: unknown source kind");
		}
		const now = this.#now();
		this.#purge(now);
		const sourcePath = resolveOAuthSourcePath(input.kind, input);
		const displayPath = oauthSourceDisplayPath(input.kind, input);
		const read = await readHardenedOAuthSourceFile(sourcePath);
		const credential = parseOAuthSourceDocument(input.kind, read.text);
		const destination = await this.#resolveDestination(input.destination);
		const conflict = classifyOAuthImportConflict(credential, destination);
		const previewId = this.#newPreviewId();
		const ticketExpiresAt = now + this.#ttlMs;
		const ticket: Ticket = {
			previewId,
			kind: input.kind,
			sourcePath,
			displayPath,
			sourceIdentity: read.identity,
			destinationRevision: this.#destinationRevision(destination),
			destinationFingerprint: this.#destinationFingerprint(destination),
			credential: cloneCredential(credential),
			conflict,
			createdAt: now,
			ticketExpiresAt,
		};
		this.#tickets.set(previewId, ticket);
		return publicPreview(ticket, now);
	}

	/**
	 * Consume the preview, reopen the allowlisted source, and compare the
	 * destination revision. Call this from inside the destination store lock.
	 * Use {@link OAuthImportCommitOutcome.takePersist} for the write material.
	 */
	async commit(input: OAuthImportCommitInput): Promise<OAuthImportCommitOutcome> {
		const now = this.#now();
		const ticket = this.#takeTicket(input.previewId, now);

		const expectedPath = resolveOAuthSourcePath(ticket.kind, input);
		if (expectedPath !== ticket.sourcePath) {
			throw new OAuthSourceError("source_changed", "oauth import: source path no longer matches the allowlist");
		}
		const read = await readHardenedOAuthSourceFile(ticket.sourcePath);
		if (!sameIdentity(ticket.sourceIdentity, read.identity)) {
			throw new OAuthSourceError("source_changed", "oauth import: source file identity changed");
		}
		const fresh = parseOAuthSourceDocument(ticket.kind, read.text);
		if (fresh.access !== ticket.credential.access || fresh.refresh !== ticket.credential.refresh) {
			throw new OAuthSourceError("source_changed", "oauth import: source credential changed");
		}

		const destination = await this.#resolveDestination(input.destination);
		if (!this.#sameDestination(ticket, destination)) {
			throw new OAuthSourceError("destination_changed", "oauth import: destination revision changed");
		}
		const conflict = classifyOAuthImportConflict(fresh, destination);
		if (conflict === "unsafe_destination") {
			throw new OAuthSourceError("unsafe_destination", "oauth import: destination file is not safe to replace");
		}
		if (oauthImportRequiresConfirm(conflict) && input.confirmOverwrite !== true) {
			throw new OAuthSourceError(
				"confirm_required",
				"oauth import: confirmOverwrite is required to replace the stored credential",
			);
		}

		const warnings = credentialWarnings(fresh, conflict, now);
		if (conflict === "same_credential") {
			const expiresAt = destination.credential?.expires ?? fresh.expires;
			return new OAuthImportCommitOutcome(
				{ action: "unchanged", displayPath: ticket.displayPath, expiresAt, warnings },
				undefined,
			);
		}
		const action: OAuthImportCommitAction = conflict === "none" ? "imported" : "overwritten";
		return new OAuthImportCommitOutcome(
			{ action, displayPath: ticket.displayPath, expiresAt: fresh.expires, warnings },
			cloneCredential(fresh),
		);
	}

	cancel(previewId: string): boolean {
		const existed = this.#tickets.delete(previewId);
		this.#purge(this.#now());
		return existed;
	}

	async #resolveDestination(view: OAuthImportDestinationView | undefined): Promise<ResolvedDestination> {
		if (view === undefined) return { status: "missing" };
		if (view.path !== undefined) {
			return this.#resolvePathDestination(view.path, view.revision);
		}
		const extras = view.revision === undefined ? {} : { revision: view.revision };
		if (view.status === "unsafe") {
			return { status: "unsafe", ...extras };
		}
		if (view.credential !== undefined) {
			return { status: "readable", credential: cloneCredential(view.credential), ...extras };
		}
		if (view.status === "unreadable") {
			return { status: "unreadable", ...extras };
		}
		if (view.status === "readable") {
			return { status: "unreadable", ...extras };
		}
		return { status: "missing", ...extras };
	}

	async #resolvePathDestination(path: string, revision: string | undefined): Promise<ResolvedDestination> {
		const inspected = await inspectOAuthDestinationFile(path);
		const extras = {
			...(inspected.identity === undefined ? {} : { identity: inspected.identity }),
			...(revision === undefined ? {} : { revision }),
		};
		if (inspected.status === "unsafe") {
			return { status: "unsafe", ...extras };
		}
		if (inspected.status === "unreadable") {
			return { status: "unreadable", ...extras };
		}
		if (inspected.status === "readable" && inspected.credential !== undefined) {
			return { status: "readable", credential: cloneCredential(inspected.credential), ...extras };
		}
		return { status: "missing", ...extras };
	}

	#destinationRevision(destination: ResolvedDestination): string {
		if (destination.revision !== undefined && destination.revision.length > 0) {
			return destination.revision;
		}
		return this.#destinationFingerprint(destination);
	}

	#destinationFingerprint(destination: ResolvedDestination): string {
		return hmacHex(this.#hmacKey, serializeDestination(destination));
	}

	#sameDestination(ticket: Ticket, destination: ResolvedDestination): boolean {
		return (
			sameRevision(ticket.destinationRevision, this.#destinationRevision(destination)) &&
			sameRevision(ticket.destinationFingerprint, this.#destinationFingerprint(destination))
		);
	}

	#takeTicket(previewId: string, now: number): Ticket {
		const ticket = this.#tickets.get(previewId);
		if (ticket !== undefined) this.#tickets.delete(previewId);
		this.#purge(now);
		if (ticket === undefined) {
			throw new OAuthSourceError("preview_invalid", "oauth import: preview is not valid");
		}
		if (ticket.ticketExpiresAt <= now) {
			throw new OAuthSourceError("preview_expired", "oauth import: preview has expired");
		}
		return ticket;
	}

	#newPreviewId(): string {
		for (;;) {
			const previewId = randomBytes(PREVIEW_ID_BYTES).toString("base64url");
			if (!this.#tickets.has(previewId)) return previewId;
		}
	}

	#purge(now: number): void {
		for (const [previewId, ticket] of this.#tickets) {
			if (ticket.ticketExpiresAt <= now) this.#tickets.delete(previewId);
		}
	}
}

/** Public commit result plus hidden persist material. */
export class OAuthImportCommitOutcome {
	readonly result: OAuthImportCommitResult;
	readonly #persist: OAuthSourceCredential | undefined;

	constructor(result: OAuthImportCommitResult, persist: OAuthSourceCredential | undefined) {
		this.result = result;
		this.#persist = persist;
	}

	/** Internal. Write this through the destination store; omit to keep dest canonical. */
	takePersist(): OAuthSourceCredential | undefined {
		return this.#persist === undefined ? undefined : cloneCredential(this.#persist);
	}

	toJSON(): OAuthImportCommitResult {
		return this.result;
	}
}

export function createOAuthImportSession(options: OAuthImportSessionOptions = {}): OAuthImportSession {
	return new OAuthImportSession(options);
}

export function classifyOAuthImportConflict(
	incoming: OAuthSourceCredential,
	destination: { status?: OAuthDestinationStatus; credential?: OAuthSourceCredential },
): OAuthImportConflict {
	const status = destination.status ?? (destination.credential === undefined ? "missing" : "readable");
	if (status === "unsafe") return "unsafe_destination";
	if (status === "unreadable") return "unreadable_destination";
	const current = destination.credential;
	if (status === "missing" || current === undefined) return "none";
	if (current.access === incoming.access && current.refresh === incoming.refresh) return "same_credential";
	const currentAccount = current.accountId;
	const incomingAccount = incoming.accountId;
	if (currentAccount !== undefined && incomingAccount !== undefined) {
		return currentAccount === incomingAccount ? "same_account" : "different_account";
	}
	return "unknown_account";
}

interface ResolvedDestination {
	status: OAuthDestinationStatus;
	credential?: OAuthSourceCredential;
	identity?: OAuthSourceFileIdentity;
	revision?: string;
}

function publicPreview(ticket: Ticket, now: number): OAuthImportPreview {
	return {
		previewId: ticket.previewId,
		kind: ticket.kind,
		displayPath: ticket.displayPath,
		expiresAt: ticket.credential.expires,
		ticketExpiresAt: ticket.ticketExpiresAt,
		conflict: ticket.conflict,
		action: oauthImportPreviewAction(ticket.conflict),
		warnings: credentialWarnings(ticket.credential, ticket.conflict, now),
		confirmOverwriteRequired: oauthImportRequiresConfirm(ticket.conflict),
	};
}

function credentialWarnings(credential: OAuthSourceCredential, conflict: OAuthImportConflict, now: number): string[] {
	const warnings: string[] = [];
	if (credential.expires <= now) warnings.push("Imported credential is already expired");
	else if (credential.expires - now <= EXPIRING_SOON_MS) warnings.push("Imported credential expires soon");
	if (conflict === "different_account") warnings.push("Stored credential belongs to a different account");
	if (conflict === "same_account") warnings.push("Stored credential for this account will be replaced");
	if (conflict === "unknown_account") warnings.push("Cannot confirm the stored credential belongs to the same account");
	if (conflict === "unreadable_destination") warnings.push("Existing destination credential could not be read");
	return warnings;
}

function grokOidcEntry(record: Record<string, unknown>, mapKey?: string): OAuthSourceCredential | undefined {
	const access = nonEmptyString(record["key"]);
	const refresh = nonEmptyString(record["refresh_token"]);
	if (access === undefined || refresh === undefined) return undefined;
	const issuer = nonEmptyString(record["oidc_issuer"]) ?? "";
	const matchesIssuer = issuer.includes("auth.x.ai");
	const matchesKey = mapKey?.includes("auth.x.ai") ?? false;
	if (!matchesIssuer && !matchesKey) return undefined;
	const expiresAt = nonEmptyString(record["expires_at"]);
	if (expiresAt === undefined) return undefined;
	const expires = parseRfc3339(expiresAt);
	if (expires === undefined) return undefined;
	return credentialOf(access, refresh, expires, nonEmptyString(record["user_id"]));
}

function latestGrokCredential(mapped: readonly OAuthSourceCredential[]): OAuthSourceCredential | undefined {
	let chosen: OAuthSourceCredential | undefined;
	for (const candidate of mapped) {
		if (chosen === undefined || candidate.expires > chosen.expires) chosen = candidate;
	}
	return chosen;
}

function parseStoredOAuthCredentialDocument(text: string): OAuthSourceCredential | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value) || value["version"] !== 1) return undefined;
	if (Object.keys(value).some((key) => key !== "version" && key !== "credential")) return undefined;
	const raw = value["credential"];
	if (!isRecord(raw)) return undefined;
	const allowed = new Set(["type", "access", "refresh", "expires", "accountId"]);
	if (Object.keys(raw).some((key) => !allowed.has(key))) return undefined;
	if (raw["type"] !== "oauth") return undefined;
	const access = nonEmptyString(raw["access"]);
	const refresh = nonEmptyString(raw["refresh"]);
	const expires = raw["expires"];
	if (access === undefined || refresh === undefined) return undefined;
	if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) return undefined;
	const accountId = raw["accountId"];
	if (accountId !== undefined && (typeof accountId !== "string" || accountId.length === 0)) return undefined;
	return credentialOf(access, refresh, expires, typeof accountId === "string" ? accountId : undefined);
}

function credentialOf(
	access: string,
	refresh: string,
	expires: number,
	accountId: string | undefined,
): OAuthSourceCredential {
	return {
		type: "oauth",
		access,
		refresh,
		expires,
		...(accountId === undefined ? {} : { accountId }),
	};
}

function cloneCredential(credential: OAuthSourceCredential): OAuthSourceCredential {
	return credentialOf(credential.access, credential.refresh, credential.expires, credential.accountId);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new OAuthSourceError("invalid_document", `${label} is not valid JSON`);
	}
	if (!isRecord(value)) {
		throw new OAuthSourceError("invalid_document", `${label} must be a JSON object`);
	}
	return value;
}

function parseRfc3339(value: string): number | undefined {
	const parsed = Date.parse(value);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	const trimmed = value.replace(/(\.\d{3})\d+/u, "$1");
	const again = Date.parse(trimmed);
	return Number.isFinite(again) && again > 0 ? again : undefined;
}

/** Decode a compact JWT payload. Never logs token material. */
function jwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	const payload = parts[1];
	if (payload === undefined || payload.length === 0) return undefined;
	let json: string;
	try {
		json = Buffer.from(payload, "base64url").toString("utf8");
	} catch {
		return undefined;
	}
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return undefined;
	}
	return isRecord(value) ? value : undefined;
}

function jwtExpMs(token: string): number | undefined {
	const payload = jwtPayload(token);
	if (payload === undefined) return undefined;
	const exp = payload["exp"];
	if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return undefined;
	return exp * 1000;
}

function chatgptAccountIdFromAccessJwt(access: string): string | undefined {
	const payload = jwtPayload(access);
	if (payload === undefined) return undefined;
	const auth = payload[OPENAI_AUTH_CLAIM];
	if (!isRecord(auth)) return undefined;
	return nonEmptyString(auth["chatgpt_account_id"]);
}

function assertSafeStats(stats: Stats, role: "source" | "destination", fromLstat: boolean): void {
	if (fromLstat && stats.isSymbolicLink()) {
		throw new OAuthSourceError("unsafe_source", `oauth ${role}: refusing to follow a symlink`);
	}
	if (!stats.isFile() || stats.isSymbolicLink()) {
		throw new OAuthSourceError("unsafe_source", `oauth ${role}: path is not a regular file`);
	}
	if (stats.size > OAUTH_SOURCE_MAX_BYTES) {
		throw new OAuthSourceError("too_large", `oauth ${role}: file exceeds the 64KiB limit`);
	}
	if (process.platform === "win32") {
		// Windows has no POSIX owner/mode model. Symlink and identity checks still apply.
		return;
	}
	const uid = currentUid();
	if (uid === undefined) {
		throw new OAuthSourceError("unsafe_source", `oauth ${role}: process uid is required to verify file ownership`);
	}
	if (stats.uid !== uid) {
		throw new OAuthSourceError("unsafe_source", `oauth ${role}: file is not owned by the current user`);
	}
	if ((stats.mode & 0o077) !== 0) {
		throw new OAuthSourceError("unsafe_source", `oauth ${role}: file is readable beyond its owner`);
	}
}

function openFlags(): number {
	if (process.platform === "win32") {
		// Windows has no POSIX O_NOFOLLOW. lstat plus identity checks still refuse symlinks.
		return constants.O_RDONLY;
	}
	if (typeof constants.O_NOFOLLOW !== "number") {
		throw new OAuthSourceError("unsafe_source", "oauth source: O_NOFOLLOW is required to open the file safely");
	}
	return constants.O_RDONLY | constants.O_NOFOLLOW;
}

function assertSameIdentity(left: Stats, right: Stats): void {
	if (
		left.dev !== right.dev ||
		left.ino !== right.ino ||
		left.uid !== right.uid ||
		(left.mode & 0o777) !== (right.mode & 0o777) ||
		left.size !== right.size
	) {
		throw new OAuthSourceError("unsafe_source", "oauth source: file identity changed during open");
	}
}

function identityOf(stats: Stats): OAuthSourceFileIdentity {
	return {
		dev: stats.dev,
		ino: stats.ino,
		size: stats.size,
		uid: stats.uid,
		mode: stats.mode & 0o777,
	};
}

function sameIdentity(left: OAuthSourceFileIdentity, right: OAuthSourceFileIdentity): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.uid === right.uid &&
		left.mode === right.mode &&
		left.size === right.size
	);
}

function serializeDestination(destination: ResolvedDestination): string {
	const credential = destination.credential;
	const identity = destination.identity;
	const credentialPart =
		credential === undefined
			? ""
			: ["c", credential.access, credential.refresh, String(credential.expires), credential.accountId ?? ""].join("\0");
	const identityPart =
		identity === undefined
			? ""
			: [
					"f",
					String(identity.dev),
					String(identity.ino),
					String(identity.size),
					String(identity.uid),
					String(identity.mode),
				].join("\0");
	return [destination.status, credentialPart, identityPart].join("\n");
}

function hmacHex(key: Buffer, data: string): string {
	return createHmac("sha256", key).update(data).digest("hex");
}

function sameRevision(left: string, right: string): boolean {
	if (left === right) return true;
	if (!/^[0-9a-f]+$/iu.test(left) || !/^[0-9a-f]+$/iu.test(right)) return false;
	const expected = Buffer.from(left, "hex");
	const actual = Buffer.from(right, "hex");
	return expected.length === actual.length && expected.length > 0 && timingSafeEqual(expected, actual);
}

function mapReadError(error: unknown, role: "source" | "destination"): OAuthSourceError {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	if (code === "ENOENT") {
		return new OAuthSourceError("not_found", `oauth ${role}: file not found`);
	}
	if (code === "ELOOP" || code === "EMLINK") {
		return new OAuthSourceError("unsafe_source", `oauth ${role}: refusing to follow a symlink`);
	}
	if (code === "EISDIR" || code === "ENOTDIR") {
		return new OAuthSourceError("unsafe_source", `oauth ${role}: path is not a regular file`);
	}
	if (code === "EACCES" || code === "EPERM") {
		return new OAuthSourceError("unsafe_source", `oauth ${role}: file is not readable by the current user`);
	}
	return new OAuthSourceError("unsafe_source", `oauth ${role}: file could not be opened safely`);
}

function unavailableReason(error: unknown): OAuthSourceUnavailableReason {
	if (error instanceof OAuthSourceError) {
		if (error.code === "not_found") return "missing";
		if (error.code === "too_large") return "too_large";
		if (error.code === "unsafe_source" || error.code === "unsafe_destination") return "unsafe";
	}
	return "invalid";
}

function currentUid(): number | undefined {
	return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

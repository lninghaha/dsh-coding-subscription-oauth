/**
 * Owner-private content-addressed store for Grok Imagine video artifacts.
 * Public identifiers are opaque; callers never receive a filesystem path,
 * content hash, or a signed upstream URL.
 * @module dsh-coding-subscription-oauth/media-store
 */

import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

/** Hard ceiling for one artifact and for aggregate stored object bytes. */
export const MEDIA_STORE_MAX_BYTES = 256 * 1024 * 1024;

/** Hard ceiling for artifact retention. Callers cannot raise this. */
export const MEDIA_STORE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const MEDIA_STORE_DIR_MODE = 0o700;
export const MEDIA_STORE_FILE_MODE = 0o600;
export const MEDIA_STORE_INDEX_VERSION = 1;
export const MEDIA_STORE_INDEX_MAX_BYTES = 16 * 1024;

/** Opaque public id: 32 lowercase hex characters. */
export const MEDIA_ARTIFACT_ID_PATTERN = /^[a-f0-9]{32}$/;

export const IMAGINE_MEDIA_ROUTE_PREFIX = "/plugins/dsh-coding-subscription-oauth/imagine/media/";

const NOFOLLOW = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
const TRUSTED_IMAGINE = Symbol.for("dsh-coding-subscription-oauth.trusted-imagine");

export type MediaStoreVideoType = "video/mp4" | "video/webm";

export type MediaStoreErrorCode =
	| "INVALID_ID"
	| "INVALID_INPUT"
	| "TOO_LARGE"
	| "NOT_FOUND"
	| "EXPIRED"
	| "CORRUPT"
	| "UNSUPPORTED_TYPE"
	| "FORBIDDEN";

export class MediaStoreError extends Error {
	readonly code: MediaStoreErrorCode;

	constructor(code: MediaStoreErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MediaStoreError";
		this.code = code;
	}
}

export interface MediaArtifactMeta {
	/** Opaque public identifier. Never a path, hash, or bearer URL. */
	artifactId: string;
	mediaType: MediaStoreVideoType;
	bytes: number;
	createdAt: number;
	expiresAt: number;
	name?: string;
}

export interface SaveMediaInput {
	data: Uint8Array;
	mediaType: MediaStoreVideoType;
	name?: string;
}

export interface StoredMedia {
	meta: MediaArtifactMeta;
	data: Uint8Array;
}

export interface MediaCleanupReport {
	expiredArtifacts: number;
	removedObjects: number;
}

export interface MediaStoreOptions {
	now?: () => number;
	/** Per-artifact ceiling, capped at {@link MEDIA_STORE_MAX_BYTES}. */
	maxBytes?: number;
	/** Aggregate unique-object ceiling, capped at {@link MEDIA_STORE_MAX_BYTES}. */
	maxTotalBytes?: number;
	retentionMs?: number;
	randomId?: () => string;
}

export interface MediaDownloadHeaders {
	"Content-Type": string;
	"Content-Length": string;
	"Content-Disposition": string;
	"Cache-Control": string;
	"X-Content-Type-Options": "nosniff";
}

export interface MediaDownloadView {
	meta: MediaArtifactMeta;
	body: Uint8Array;
	headers: MediaDownloadHeaders;
}

/** Runtime token proving a route already authorized this download. */
export interface TrustedImagineAuthz {
	readonly [TRUSTED_IMAGINE]: true;
}

export interface CreateTrustedImagineAuthzInput {
	readonly remoteAddress?: string;
	readonly authorized?: boolean;
}

interface IndexDocument {
	version: typeof MEDIA_STORE_INDEX_VERSION;
	artifactId: string;
	sha256: string;
	mediaType: MediaStoreVideoType;
	bytes: number;
	createdAt: number;
	expiresAt: number;
	name?: string;
}

function isENOENT(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function isEEXIST(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === "EEXIST";
}

function sha256Hex(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function generateArtifactId(): string {
	return randomBytes(16).toString("hex");
}

function clampPositive(value: number | undefined, ceiling: number, label: string): number {
	const raw = value ?? ceiling;
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
		throw new MediaStoreError("INVALID_INPUT", `${label} must be a positive finite number`);
	}
	return Math.min(Math.floor(raw), ceiling);
}

/** Reject anything that is not a 32-char lowercase hex artifact id. */
export function parseMediaArtifactId(value: string): string | undefined {
	return MEDIA_ARTIFACT_ID_PATTERN.test(value) ? value : undefined;
}

export function isSafeMediaArtifactId(value: string): boolean {
	return parseMediaArtifactId(value) !== undefined;
}

function sanitizeDisplayName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const basename = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1);
	const clean = [...basename]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint >= 0x20 && codePoint !== 0x7f;
		})
		.join("")
		.trim()
		.slice(0, 255);
	return clean === "" ? undefined : clean;
}

/**
 * Characters disallowed inside an HTTP `filename=` token. Quoting, semicolons,
 * directory separators, and CR/LF could break out of the header parameter or
 * inject an additional parameter. The legacy header stays ASCII; any
 * disallowed or non-ASCII characters are moved into the optional
 * `filename*=UTF-8''…` parameter per RFC 5987.
 */
const ASCII_BANNED_CODE_POINTS = new Set<number>([
	0x22, // "
	0x3b, // ;
	0x5c, // backslash
	0x2f, // forward slash
]);

function sanitizeFilenameToken(value: string): string {
	const safe: string[] = [];
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint < 0x20 || codePoint > 0x7e) continue;
		if (ASCII_BANNED_CODE_POINTS.has(codePoint)) continue;
		safe.push(character);
	}
	return safe.join("").trim().slice(0, 120);
}

/**
 * RFC 5987 percent-encoding for the UTF-8 `filename*` parameter.
 * `encodeURIComponent` covers the bulk; we additionally re-encode the
 * punctuation marks RFC 5987 mandates inside an encoded-word.
 */
function encodeRfc5987(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/gu,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
}

/**
 * Returns either a `filename=` parameter (when the value is already safe ASCII)
 * or both `filename=` and `filename*=UTF-8''…` (when the original had to be
 * downgraded for the legacy parameter). The caller wraps the result with
 * `attachment; `.
 */
function contentDispositionFilename(value: string, fallback: string): string {
	const safe = sanitizeFilenameToken(value) || fallback;
	if (safe === value) return `filename="${value}"`;
	const encoded = encodeRfc5987(value);
	return `filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function extensionFor(mediaType: MediaStoreVideoType): "mp4" | "webm" {
	return mediaType === "video/webm" ? "webm" : "mp4";
}

function assertInsideRoot(root: string, candidate: string): string {
	const base = resolve(root);
	const resolved = resolve(candidate);
	const rel = relative(base, resolved);
	if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
		throw new MediaStoreError("INVALID_ID", "media path escaped the store root");
	}
	return resolved;
}

async function lstatOrUndefined(path: string): Promise<import("node:fs").Stats | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isENOENT(error)) return undefined;
		throw error;
	}
}

async function assertRealDirectory(path: string, kind: "root" | "parent" | "leaf"): Promise<void> {
	const stat = await lstatOrUndefined(path);
	if (stat === undefined) {
		throw new MediaStoreError(kind === "root" ? "INVALID_INPUT" : "CORRUPT", `media ${kind} directory is missing`);
	}
	if (stat.isSymbolicLink()) {
		throw new MediaStoreError(
			kind === "root" ? "INVALID_INPUT" : "CORRUPT",
			`media ${kind} directory must not be a symlink`,
		);
	}
	if (!stat.isDirectory()) {
		throw new MediaStoreError(kind === "root" ? "INVALID_INPUT" : "CORRUPT", `media ${kind} path is not a directory`);
	}
}

async function assertSafeRoot(root: string): Promise<void> {
	const stat = await lstatOrUndefined(root);
	if (stat === undefined) return;
	if (stat.isSymbolicLink()) {
		throw new MediaStoreError("INVALID_INPUT", "media store root must not be a symlink");
	}
	if (!stat.isDirectory()) {
		throw new MediaStoreError("INVALID_INPUT", "media store root must be a directory");
	}
}

async function ensurePrivateDir(root: string, path: string): Promise<void> {
	const resolved = path === root ? resolve(root) : assertInsideRoot(root, path);
	if (resolved === resolve(root)) {
		const existing = await lstatOrUndefined(resolved);
		if (existing === undefined) {
			await mkdir(resolved, { recursive: true, mode: MEDIA_STORE_DIR_MODE });
		}
		await assertRealDirectory(resolved, "root");
		if (process.platform !== "win32") await chmod(resolved, MEDIA_STORE_DIR_MODE);
		return;
	}
	await assertRealDirectory(root, "root");
	const relativePath = relative(resolve(root), resolved);
	let current = resolve(root);
	for (const part of relativePath.split(sep)) {
		if (part === "" || part === ".") continue;
		if (part === "..") throw new MediaStoreError("INVALID_ID", "media path escaped the store root");
		current = join(current, part);
		const existing = await lstatOrUndefined(current);
		if (existing === undefined) {
			try {
				await mkdir(current, { mode: MEDIA_STORE_DIR_MODE });
			} catch (error) {
				if (!isEEXIST(error)) throw error;
			}
		}
		await assertRealDirectory(current, "parent");
		if (process.platform !== "win32") await chmod(current, MEDIA_STORE_DIR_MODE);
	}
}

async function openNoFollow(
	path: string,
	flags: number,
	mode?: number,
): Promise<import("node:fs/promises").FileHandle> {
	try {
		return mode === undefined ? await open(path, flags | NOFOLLOW) : await open(path, flags | NOFOLLOW, mode);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | null)?.code;
		if (code === "ELOOP" || code === "EMLINK") {
			throw new MediaStoreError("CORRUPT", "media path is a symlink", { cause: error });
		}
		throw error;
	}
}

async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
	const existing = await lstatOrUndefined(path);
	if (existing === undefined) {
		const missing = new Error("ENOENT");
		(missing as NodeJS.ErrnoException).code = "ENOENT";
		throw missing;
	}
	if (existing.isSymbolicLink()) {
		throw new MediaStoreError("CORRUPT", "media leaf must not be a symlink");
	}
	if (!existing.isFile()) {
		throw new MediaStoreError("CORRUPT", "media leaf is not a regular file");
	}
	if (existing.size > maxBytes) {
		throw new MediaStoreError("TOO_LARGE", "stored media exceeds the bounded read ceiling");
	}
	const handle = await openNoFollow(path, fsConstants.O_RDONLY);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > maxBytes) {
			throw new MediaStoreError("CORRUPT", "media leaf failed a no-follow stat");
		}
		const buffer = Buffer.alloc(stat.size);
		const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
		if (bytesRead !== stat.size) {
			throw new MediaStoreError("CORRUPT", "media leaf could not be read completely");
		}
		return new Uint8Array(buffer.subarray(0, bytesRead));
	} finally {
		await handle.close();
	}
}

async function writeExclusiveFile(root: string, path: string, data: Uint8Array | string): Promise<void> {
	const target = assertInsideRoot(root, path);
	await ensurePrivateDir(root, dirname(target));
	const existing = await lstatOrUndefined(target);
	if (existing !== undefined) {
		if (existing.isSymbolicLink()) {
			throw new MediaStoreError("CORRUPT", "media leaf must not be a symlink");
		}
		const collision = new Error("EEXIST");
		(collision as NodeJS.ErrnoException).code = "EEXIST";
		throw collision;
	}
	const payload = typeof data === "string" ? Buffer.from(data) : data;
	const temporary = join(dirname(target), `.tmp-${randomBytes(8).toString("hex")}`);
	const handle = await openNoFollow(
		temporary,
		fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
		MEDIA_STORE_FILE_MODE,
	);
	try {
		await handle.writeFile(payload);
		if (process.platform !== "win32") await handle.chmod(MEDIA_STORE_FILE_MODE);
	} catch (error) {
		await handle.close().catch(() => undefined);
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	await handle.close();
	try {
		if (process.platform === "win32") {
			const created = await openNoFollow(
				target,
				fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
				MEDIA_STORE_FILE_MODE,
			);
			try {
				await created.writeFile(payload);
			} finally {
				await created.close();
			}
		} else {
			await link(temporary, target);
			await chmod(target, MEDIA_STORE_FILE_MODE);
		}
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		if (isEEXIST(error)) throw error;
		await unlink(target).catch(() => undefined);
		throw error;
	}
	await unlink(temporary).catch(() => undefined);
}

function objectPath(root: string, sha256: string): string {
	if (!/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new MediaStoreError("CORRUPT", "stored digest is not a sha256 hex string");
	}
	return assertInsideRoot(root, join(root, "objects", sha256.slice(0, 2), sha256));
}

function indexPath(root: string, artifactId: string): string {
	const id = parseMediaArtifactId(artifactId);
	if (id === undefined) throw new MediaStoreError("INVALID_ID", "artifact id is not a safe opaque identifier");
	return assertInsideRoot(root, join(root, "index", id.slice(0, 2), `${id}.json`));
}

function parseIndexDocument(text: string): IndexDocument {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new MediaStoreError("CORRUPT", "media index is not valid JSON");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MediaStoreError("CORRUPT", "media index must contain an object");
	}
	const document = value as Record<string, unknown>;
	if (document["version"] !== MEDIA_STORE_INDEX_VERSION) {
		throw new MediaStoreError("CORRUPT", "media index has an unsupported version");
	}
	const artifactId = document["artifactId"];
	const sha256 = document["sha256"];
	const mediaType = document["mediaType"];
	const bytes = document["bytes"];
	const createdAt = document["createdAt"];
	const expiresAt = document["expiresAt"];
	if (typeof artifactId !== "string" || parseMediaArtifactId(artifactId) === undefined) {
		throw new MediaStoreError("CORRUPT", "media index artifact id is invalid");
	}
	if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new MediaStoreError("CORRUPT", "media index digest is invalid");
	}
	if (mediaType !== "video/mp4" && mediaType !== "video/webm") {
		throw new MediaStoreError("CORRUPT", "media index type is unsupported");
	}
	if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
		throw new MediaStoreError("CORRUPT", "media index byte length is invalid");
	}
	if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt <= 0) {
		throw new MediaStoreError("CORRUPT", "media index createdAt is invalid");
	}
	if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
		throw new MediaStoreError("CORRUPT", "media index expiresAt is invalid");
	}
	const name = typeof document["name"] === "string" ? sanitizeDisplayName(document["name"]) : undefined;
	const parsed: IndexDocument = {
		version: MEDIA_STORE_INDEX_VERSION,
		artifactId,
		sha256,
		mediaType,
		bytes,
		createdAt,
		expiresAt,
	};
	if (name !== undefined) parsed.name = name;
	return parsed;
}

function toMeta(document: IndexDocument, expiresAt = document.expiresAt): MediaArtifactMeta {
	const meta: MediaArtifactMeta = {
		artifactId: document.artifactId,
		mediaType: document.mediaType,
		bytes: document.bytes,
		createdAt: document.createdAt,
		expiresAt,
	};
	if (document.name !== undefined) meta.name = document.name;
	return meta;
}

async function storedObjectBytes(root: string): Promise<number> {
	let total = 0;
	for (const file of await listRegularFiles(root, "objects")) {
		const stat = await lstatOrUndefined(file);
		if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) continue;
		total += stat.size;
		if (!Number.isSafeInteger(total)) throw new MediaStoreError("CORRUPT", "media store byte accounting overflowed");
	}
	return total;
}

async function listRegularFiles(root: string, kind: "index" | "objects"): Promise<string[]> {
	const base = join(root, kind);
	const rootStat = await lstatOrUndefined(base);
	if (rootStat === undefined) return [];
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new MediaStoreError("CORRUPT", `${kind} directory must not be a symlink`);
	}
	let buckets: string[];
	try {
		buckets = await readdir(base);
	} catch (error) {
		if (isENOENT(error)) return [];
		throw error;
	}
	const files: string[] = [];
	for (const bucket of buckets) {
		if (bucket.startsWith(".tmp-")) {
			const leftover = join(base, bucket);
			const leftoverStat = await lstatOrUndefined(leftover);
			if (leftoverStat?.isSymbolicLink() === true || leftoverStat?.isFile() === true) {
				await unlink(leftover).catch(() => undefined);
			}
			continue;
		}
		if (!/^[a-f0-9]{2}$/u.test(bucket)) continue;
		const directory = join(base, bucket);
		const directoryStat = await lstatOrUndefined(directory);
		if (directoryStat === undefined) continue;
		if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
			throw new MediaStoreError("CORRUPT", `${kind} bucket must not be a symlink`);
		}
		let entries: string[];
		try {
			entries = await readdir(directory);
		} catch (error) {
			if (isENOENT(error)) continue;
			throw error;
		}
		for (const entry of entries) {
			const full = join(directory, entry);
			const stat = await lstatOrUndefined(full);
			if (stat === undefined) continue;
			if (entry.startsWith(".tmp-")) {
				if (stat.isSymbolicLink() || stat.isFile()) await unlink(full).catch(() => undefined);
				continue;
			}
			if (stat.isSymbolicLink()) {
				await unlink(full).catch(() => undefined);
				continue;
			}
			if (!stat.isFile()) continue;
			if (kind === "index" && !entry.endsWith(".json")) continue;
			if (kind === "objects" && !/^[a-f0-9]{64}$/u.test(entry)) continue;
			files.push(full);
		}
	}
	return files;
}

/** Trusted same-origin path for one stored video artifact. */
export function imagineMediaPath(artifactId: string): string {
	const id = parseMediaArtifactId(artifactId);
	if (id === undefined) throw new MediaStoreError("INVALID_ID", "artifact id is not a safe opaque identifier");
	return `${IMAGINE_MEDIA_ROUTE_PREFIX}${id}`;
}

/** Extract a safe artifact id from a same-origin media route. */
export function parseImagineMediaPath(pathname: string): string | undefined {
	if (!pathname.startsWith(IMAGINE_MEDIA_ROUTE_PREFIX)) return undefined;
	const rest = pathname.slice(IMAGINE_MEDIA_ROUTE_PREFIX.length);
	if (rest.includes("/") || rest.includes("\\") || rest.includes("..")) return undefined;
	return parseMediaArtifactId(rest);
}

export function mediaDownloadHeaders(meta: MediaArtifactMeta): MediaDownloadHeaders {
	const fallback = `imagine-${meta.artifactId}.${extensionFor(meta.mediaType)}`;
	const filename = meta.name ?? fallback;
	return {
		"Content-Type": meta.mediaType,
		"Content-Length": String(meta.bytes),
		"Content-Disposition": `attachment; ${contentDispositionFilename(filename, fallback)}`,
		"Cache-Control": "private, max-age=0, no-store",
		"X-Content-Type-Options": "nosniff",
	};
}

/** Loopback-only peer check for the parent route gate. */
export function isTrustedImaginePeer(remoteAddress: string | undefined): boolean {
	return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

/** Build a runtime authz token. Raw objects are not accepted by openTrusted helpers. */
export function createTrustedImagineAuthz(input: CreateTrustedImagineAuthzInput): TrustedImagineAuthz {
	if (input.authorized === true || isTrustedImaginePeer(input.remoteAddress)) {
		return { [TRUSTED_IMAGINE]: true };
	}
	throw new MediaStoreError("FORBIDDEN", "imagine download is not authorized");
}

export function assertTrustedImagineAuthz(authz: TrustedImagineAuthz): void {
	if (authz?.[TRUSTED_IMAGINE] !== true) {
		throw new MediaStoreError("FORBIDDEN", "imagine download requires an explicit trusted context");
	}
}

/**
 * Content-addressed video store. Directories are 0700; objects and index
 * documents are 0600. Public lookup uses an opaque id, never the digest.
 */
export class MediaStore {
	readonly root: string;
	readonly maxBytes: number;
	readonly maxTotalBytes: number;
	retentionMs: number;
	private readonly now: () => number;
	private readonly randomId: () => string;
	private tail: Promise<void> = Promise.resolve();
	private retentionReconciled = false;

	constructor(root: string, options: MediaStoreOptions = {}) {
		if (typeof root !== "string" || root.trim() === "") {
			throw new MediaStoreError("INVALID_INPUT", "media store root must be a non-empty path");
		}
		this.root = resolve(root);
		this.now = options.now ?? Date.now;
		this.maxBytes = clampPositive(options.maxBytes, MEDIA_STORE_MAX_BYTES, "maxBytes");
		this.maxTotalBytes = clampPositive(options.maxTotalBytes, MEDIA_STORE_MAX_BYTES, "maxTotalBytes");
		this.retentionMs = clampPositive(options.retentionMs, MEDIA_STORE_RETENTION_MS, "retentionMs");
		this.randomId = options.randomId ?? generateArtifactId;
	}

	/**
	 * Apply a live retention ceiling under the store lock. Lowering it rewrites
	 * existing index expiries and deletes newly expired objects before resolving;
	 * raising it affects only artifacts saved after this call.
	 */
	async applyRetentionMs(retentionMs: number): Promise<MediaCleanupReport> {
		const next = clampPositive(retentionMs, MEDIA_STORE_RETENTION_MS, "retentionMs");
		return this.runExclusive(async () => {
			const previous = this.retentionMs;
			if (next > previous && !this.retentionReconciled) {
				const report = await this.cleanupUnlocked();
				this.retentionReconciled = true;
				this.retentionMs = next;
				return report;
			}
			const lowered = next < previous;
			this.retentionMs = next;
			if (!lowered && this.retentionReconciled) return { expiredArtifacts: 0, removedObjects: 0 };
			try {
				const report = await this.cleanupUnlocked();
				this.retentionReconciled = true;
				return report;
			} catch (error) {
				this.retentionReconciled = false;
				throw error;
			}
		});
	}

	async save(input: SaveMediaInput): Promise<MediaArtifactMeta> {
		return this.runExclusive(() => this.saveUnlocked(input));
	}

	async lookup(artifactId: string): Promise<MediaArtifactMeta | undefined> {
		if (parseMediaArtifactId(artifactId) === undefined) return undefined;
		const document = await this.readIndex(artifactId);
		if (document === undefined) return undefined;
		if (this.effectiveExpiresAt(document) <= this.now()) return undefined;
		return this.effectiveMeta(document);
	}

	async read(artifactId: string): Promise<StoredMedia> {
		const id = parseMediaArtifactId(artifactId);
		if (id === undefined) throw new MediaStoreError("INVALID_ID", "artifact id is not a safe opaque identifier");
		const document = await this.readIndex(id);
		if (document === undefined) throw new MediaStoreError("NOT_FOUND", "media artifact was not found");
		if (this.effectiveExpiresAt(document) <= this.now()) {
			throw new MediaStoreError("EXPIRED", "media artifact has expired");
		}
		if (document.bytes > this.maxBytes) {
			throw new MediaStoreError("CORRUPT", "media index exceeds the store byte ceiling");
		}
		let data: Uint8Array;
		try {
			data = await readBoundedFile(objectPath(this.root, document.sha256), this.maxBytes);
		} catch (error) {
			if (error instanceof MediaStoreError) throw error;
			if (isENOENT(error)) throw new MediaStoreError("NOT_FOUND", "media object is missing", { cause: error });
			throw error;
		}
		if (sha256Hex(data) !== document.sha256 || data.byteLength !== document.bytes) {
			throw new MediaStoreError("CORRUPT", "stored media failed integrity verification");
		}
		return { meta: this.effectiveMeta(document), data };
	}

	async delete(artifactId: string): Promise<boolean> {
		return this.runExclusive(() => this.deleteUnlocked(artifactId));
	}

	async cleanup(): Promise<MediaCleanupReport> {
		return this.runExclusive(async () => {
			try {
				const report = await this.cleanupUnlocked();
				this.retentionReconciled = true;
				return report;
			} catch (error) {
				this.retentionReconciled = false;
				throw error;
			}
		});
	}

	/** Trusted same-origin download primitive. Never returns an upstream URL. */
	async openDownload(artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView> {
		assertTrustedImagineAuthz(authz);
		const stored = await this.read(artifactId);
		return {
			meta: stored.meta,
			body: stored.data,
			headers: mediaDownloadHeaders(stored.meta),
		};
	}

	private effectiveExpiresAt(document: IndexDocument): number {
		return Math.min(document.expiresAt, document.createdAt + this.retentionMs);
	}

	private effectiveMeta(document: IndexDocument): MediaArtifactMeta {
		return toMeta(document, this.effectiveExpiresAt(document));
	}

	private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.tail.then(operation, operation);
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private async saveUnlocked(input: SaveMediaInput): Promise<MediaArtifactMeta> {
		if (input.mediaType !== "video/mp4" && input.mediaType !== "video/webm") {
			throw new MediaStoreError("UNSUPPORTED_TYPE", "media store only accepts video/mp4 or video/webm");
		}
		if (input.data.byteLength === 0) {
			throw new MediaStoreError("INVALID_INPUT", "media artifact is empty");
		}
		if (input.data.byteLength > this.maxBytes) {
			throw new MediaStoreError("TOO_LARGE", `media artifact exceeds the ${this.maxBytes} byte ceiling`);
		}
		await assertSafeRoot(this.root);
		const createdAt = this.now();
		const digest = sha256Hex(input.data);
		const object = objectPath(this.root, digest);
		await ensurePrivateDir(this.root, this.root);
		await ensurePrivateDir(this.root, join(this.root, "objects"));
		await ensurePrivateDir(this.root, join(this.root, "index"));
		await ensurePrivateDir(this.root, dirname(object));
		await this.cleanupUnlocked();
		const existingObject = await lstatOrUndefined(object);
		if (existingObject !== undefined) {
			if (existingObject.isSymbolicLink() || !existingObject.isFile()) {
				throw new MediaStoreError("CORRUPT", "object path is not a regular file");
			}
			const current = await readBoundedFile(object, this.maxBytes);
			if (sha256Hex(current) !== digest) {
				throw new MediaStoreError("CORRUPT", "stored object failed integrity verification");
			}
		} else {
			const currentBytes = await storedObjectBytes(this.root);
			if (currentBytes + input.data.byteLength > this.maxTotalBytes) {
				throw new MediaStoreError("TOO_LARGE", `media store exceeds the ${this.maxTotalBytes} byte total ceiling`);
			}
			try {
				await writeExclusiveFile(this.root, object, input.data);
			} catch (error) {
				if (!isEEXIST(error)) throw error;
				const current = await readBoundedFile(object, this.maxBytes);
				if (sha256Hex(current) !== digest) {
					throw new MediaStoreError("CORRUPT", "stored object failed integrity verification");
				}
			}
		}
		let artifactId = this.randomId();
		for (let attempt = 0; attempt < 8; attempt += 1) {
			if (parseMediaArtifactId(artifactId) === undefined) {
				throw new MediaStoreError("INVALID_ID", "generated artifact id is not opaque hex");
			}
			const target = indexPath(this.root, artifactId);
			const existingIndex = await lstatOrUndefined(target);
			if (existingIndex !== undefined) {
				if (existingIndex.isSymbolicLink()) {
					throw new MediaStoreError("CORRUPT", "media index leaf must not be a symlink");
				}
				artifactId = this.randomId();
				continue;
			}
			const document: IndexDocument = {
				version: MEDIA_STORE_INDEX_VERSION,
				artifactId,
				sha256: digest,
				mediaType: input.mediaType,
				bytes: input.data.byteLength,
				createdAt,
				expiresAt: createdAt + this.retentionMs,
			};
			const name = sanitizeDisplayName(input.name);
			if (name !== undefined) document.name = name;
			try {
				await writeExclusiveFile(this.root, target, `${JSON.stringify(document)}\n`);
			} catch (error) {
				if (!isEEXIST(error)) throw error;
				artifactId = this.randomId();
				continue;
			}
			return toMeta(document);
		}
		throw new MediaStoreError("INVALID_ID", "unable to allocate an unused artifact id");
	}

	private async deleteUnlocked(artifactId: string): Promise<boolean> {
		if (parseMediaArtifactId(artifactId) === undefined) return false;
		await assertSafeRoot(this.root);
		const document = await this.readIndex(artifactId);
		if (document === undefined) return false;
		const file = indexPath(this.root, document.artifactId);
		const stat = await lstatOrUndefined(file);
		if (stat?.isSymbolicLink() === true) {
			await unlink(file).catch(() => undefined);
			return true;
		}
		await unlink(file).catch((error: unknown) => {
			if (!isENOENT(error)) throw error;
		});
		await this.removeObjectIfUnreferenced(document.sha256);
		return true;
	}

	private async cleanupUnlocked(): Promise<MediaCleanupReport> {
		await assertSafeRoot(this.root);
		const now = this.now();
		const files = await listRegularFiles(this.root, "index");
		let expiredArtifacts = 0;
		const liveDigests = new Set<string>();
		for (const file of files) {
			let document: IndexDocument;
			try {
				const raw = await readBoundedFile(file, MEDIA_STORE_INDEX_MAX_BYTES);
				document = parseIndexDocument(new TextDecoder().decode(raw));
			} catch {
				await unlink(file).catch(() => undefined);
				expiredArtifacts += 1;
				continue;
			}
			const effectiveExpiresAt = this.effectiveExpiresAt(document);
			if (effectiveExpiresAt <= now) {
				await unlink(file).catch(() => undefined);
				expiredArtifacts += 1;
				continue;
			}
			if (effectiveExpiresAt < document.expiresAt) {
				document.expiresAt = effectiveExpiresAt;
				await writeFileAtomic(assertInsideRoot(this.root, file), `${JSON.stringify(document)}\n`, {
					mode: MEDIA_STORE_FILE_MODE,
					dirMode: MEDIA_STORE_DIR_MODE,
				});
			}
			liveDigests.add(document.sha256);
		}
		let removedObjects = 0;
		for (const file of await listRegularFiles(this.root, "objects")) {
			const digest = file.slice(file.lastIndexOf(sep) + 1);
			if (liveDigests.has(digest)) continue;
			const stat = await lstatOrUndefined(file);
			if (stat === undefined) continue;
			if (stat.isSymbolicLink() || stat.isFile()) {
				await unlink(file).catch(() => undefined);
				removedObjects += 1;
			}
		}
		return { expiredArtifacts, removedObjects };
	}

	private async readIndex(artifactId: string): Promise<IndexDocument | undefined> {
		const file = indexPath(this.root, artifactId);
		let bytes: Uint8Array;
		try {
			const stat = await lstatOrUndefined(file);
			if (stat === undefined) return undefined;
			if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
			bytes = await readBoundedFile(file, MEDIA_STORE_INDEX_MAX_BYTES);
		} catch (error) {
			if (isENOENT(error)) return undefined;
			throw error;
		}
		const document = parseIndexDocument(new TextDecoder().decode(bytes));
		if (document.artifactId !== artifactId) {
			throw new MediaStoreError("CORRUPT", "media index id does not match its filename");
		}
		return document;
	}

	private async removeObjectIfUnreferenced(sha256: string): Promise<void> {
		for (const file of await listRegularFiles(this.root, "index")) {
			try {
				const document = parseIndexDocument(
					new TextDecoder().decode(await readBoundedFile(file, MEDIA_STORE_INDEX_MAX_BYTES)),
				);
				if (document.sha256 === sha256 && this.effectiveExpiresAt(document) > this.now()) return;
			} catch {
				// A corrupt sibling does not keep the object alive.
			}
		}
		const object = objectPath(this.root, sha256);
		const stat = await lstatOrUndefined(object);
		if (stat === undefined) return;
		if (stat.isSymbolicLink() || stat.isFile()) await unlink(object).catch(() => undefined);
	}
}

/** Open a trusted same-origin download. Requires an explicit authz token. */
export async function openTrustedMediaDownload(
	store: MediaStore,
	artifactId: string,
	authz: TrustedImagineAuthz,
): Promise<MediaDownloadView> {
	assertTrustedImagineAuthz(authz);
	if (!isSafeMediaArtifactId(artifactId)) {
		throw new MediaStoreError("INVALID_ID", "artifact id is not a safe opaque identifier");
	}
	return store.openDownload(artifactId, authz);
}

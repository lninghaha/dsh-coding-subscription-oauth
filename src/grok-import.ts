/**
 * One-shot import of Grok CLI credentials into the dsh-owned store.
 * The source file is never written. Refresh tokens rotate, so later dsh
 * refresh may invalidate ~/.grok/auth.json — that is documented, not a bug.
 * @module dsh-coding-subscription-oauth/grok-import
 */

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { XAI_PI_PROVIDER } from "./ids.ts";
import type { GrokBuildCredentialStore } from "./store.ts";

const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export interface GrokImportProbe {
	available: boolean;
	path: string;
}

function isENOENT(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = nonEmptyString(record[key]);
		if (value !== undefined) return value;
	}
	return undefined;
}

function parseTime(value: string): number {
	const parsed = Date.parse(value);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	const trimmed = value.replace(/(\.\d{3})\d+/, "$1");
	const again = Date.parse(trimmed);
	return Number.isFinite(again) && again > 0 ? again : Number.NaN;
}

function parseExpires(record: Record<string, unknown>): number {
	const expiresAt = record["expires_at"];
	if (typeof expiresAt === "string" && expiresAt.length > 0) {
		const parsed = parseTime(expiresAt);
		if (Number.isFinite(parsed)) return parsed;
	}
	if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
		return expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
	}
	const expires = record["expires"];
	if (typeof expires === "number" && Number.isFinite(expires) && expires > 0) {
		return expires < 1_000_000_000_000 ? expires * 1000 : expires;
	}
	const expiresIn = record["expires_in"];
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
		return Date.now() + expiresIn * 1000;
	}
	return Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
}

interface Candidate {
	credential: OAuthCredential;
	preferred: boolean;
}

function walk(value: unknown, key: string): Candidate[] {
	if (Array.isArray(value)) return value.flatMap((item, index) => walk(item, `${key}[${index}]`));
	if (!isRecord(value)) return [];
	const access = firstString(value, ["key", "access", "access_token"]);
	const refresh = firstString(value, ["refresh_token", "refresh"]);
	if (access !== undefined && refresh !== undefined) {
		const issuer = firstString(value, ["oidc_issuer", "issuer"]);
		const preferred = key.includes("auth.x.ai") || (issuer?.includes("auth.x.ai") ?? false);
		const accountId = firstString(value, ["user_id", "accountId", "principal_id"]);
		const credential: OAuthCredential = {
			type: "oauth",
			access,
			refresh,
			expires: parseExpires(value),
			...(accountId === undefined ? {} : { accountId }),
		};
		return [{ credential, preferred }];
	}
	return Object.entries(value).flatMap(([child, nested]) => walk(nested, child));
}

/** Resolve the Grok CLI auth document. */
export function grokAuthPath(home: string = homedir()): string {
	return resolve(join(home, ".grok", "auth.json"));
}

/** Parse a Grok CLI / generic OAuth document into a pi-ai credential. */
export function parseGrokAuthDocument(text: string, filename: string): OAuthCredential {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`grok-build: ${filename} is not valid JSON`);
	}
	const candidates = walk(value, "");
	if (candidates.length === 0) {
		throw new Error(`grok-build: ${filename} does not contain a Grok OAuth refresh token`);
	}
	const chosen = candidates.find((candidate) => candidate.preferred) ?? candidates[0];
	if (chosen === undefined) {
		throw new Error(`grok-build: ${filename} does not contain a Grok OAuth refresh token`);
	}
	return chosen.credential;
}

/** Whether ~/.grok/auth.json exists and looks importable. Never returns secrets. */
export async function probeGrokAuth(filename: string = grokAuthPath()): Promise<GrokImportProbe> {
	try {
		await stat(filename);
		const text = await readFile(filename, "utf8");
		parseGrokAuthDocument(text, filename);
		return { available: true, path: filename };
	} catch (error) {
		if (isENOENT(error)) return { available: false, path: filename };
		return { available: false, path: filename };
	}
}

/** Copy Grok CLI tokens into the dsh store. Does not write the Grok file. */
export async function importGrokAuth(
	store: GrokBuildCredentialStore,
	filename: string = grokAuthPath(),
): Promise<OAuthCredential> {
	let text: string;
	try {
		text = await readFile(filename, "utf8");
	} catch (error) {
		if (isENOENT(error)) throw new Error(`grok-build: Grok CLI auth file not found at ${filename}`);
		throw error;
	}
	const credential = parseGrokAuthDocument(text, filename);
	const written = await store.modify(XAI_PI_PROVIDER, async () => credential);
	if (written === undefined || written.type !== "oauth") {
		throw new Error("grok-build: failed to persist the imported Grok credential");
	}
	return written;
}

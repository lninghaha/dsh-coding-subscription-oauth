import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_PI_PROVIDER, CODEX_PI_PROVIDER, KIMI_PI_PROVIDER, XAI_PI_PROVIDER } from "../src/ids.ts";
import {
	classifyOAuthImportConflict,
	createOAuthImportSession,
	discoverOAuthSources,
	inspectOAuthDestinationFile,
	isOAuthSourceError,
	isOAuthSourceKind,
	OAUTH_IMPORT_MAX_PREVIEW_TICKETS,
	OAUTH_IMPORT_PREVIEW_TTL_MS,
	OAUTH_SOURCE_KINDS,
	OAUTH_SOURCE_MAX_BYTES,
	OAUTH_SOURCE_SPECS,
	type OAuthSourceCredential,
	OAuthSourceError,
	type OAuthSourceKind,
	type OAuthSourcePathOptions,
	oauthImportRequiresConfirm,
	oauthSourceDisplayPath,
	oauthSourceProviderId,
	parseClaudeCliAuthDocument,
	parseCodexCliAuthDocument,
	parseGrokCliAuthDocument,
	parseKimiCliAuthDocument,
	parseOAuthSourceDocument,
	probeOAuthSource,
	readHardenedOAuthSourceFile,
	resolveOAuthSourcePath,
} from "../src/oauth-sources.ts";

const posix = process.platform !== "win32";
const GROK_ACCESS = "grok-access-token-value";
const GROK_REFRESH = "grok-refresh-token-value";
const CODEX_ACCESS_PAYLOAD = { exp: 1_800_000_000, sub: "codex-user" };
const CODEX_REFRESH = "codex-refresh-token-value";
const KIMI_ACCESS = "kimi-access-token-value";
const KIMI_REFRESH = "kimi-refresh-token-value";
const CLAUDE_ACCESS = "claude-access-token-value";
const CLAUDE_REFRESH = "claude-refresh-token-value";
const ALL_SECRETS = [
	GROK_ACCESS,
	GROK_REFRESH,
	CODEX_REFRESH,
	KIMI_ACCESS,
	KIMI_REFRESH,
	CLAUDE_ACCESS,
	CLAUDE_REFRESH,
];

function sandbox(home: string, env: NodeJS.Dict<string> = {}): OAuthSourcePathOptions {
	return { home, env };
}

async function tempHome(): Promise<string> {
	return mkdtemp(join(tmpdir(), "dsh-oauth-src-"));
}

async function writeOwnerOnly(path: string, body: string | NodeJS.ArrayBufferView): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, body, { mode: 0o600 });
}

function grokDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		"https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
			key: GROK_ACCESS,
			refresh_token: GROK_REFRESH,
			expires_at: "2026-08-14T12:00:00.000000Z",
			oidc_issuer: "https://auth.x.ai",
			user_id: "user-1",
			email: "hidden@example.com",
			...overrides,
		},
	};
}

function unsignedJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

function codexDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		auth_mode: "chatgpt",
		tokens: {
			id_token: unsignedJwt({ exp: 1_800_000_000, email: "hidden@example.com" }),
			access_token: unsignedJwt(CODEX_ACCESS_PAYLOAD),
			refresh_token: CODEX_REFRESH,
			account_id: "acct-codex",
		},
		...overrides,
	};
}

function kimiDocument(): Record<string, unknown> {
	return {
		access_token: KIMI_ACCESS,
		refresh_token: KIMI_REFRESH,
		expires_at: 1_800_000_000,
		user_id: "kimi-user",
	};
}

function claudeDocument(): Record<string, unknown> {
	return {
		claudeAiOauth: {
			accessToken: CLAUDE_ACCESS,
			refreshToken: CLAUDE_REFRESH,
			expiresAt: 1_800_000_000_000,
			scopes: ["user:inference"],
			subscriptionType: "pro",
		},
	};
}

function stored(credential: OAuthSourceCredential): string {
	return `${JSON.stringify({ version: 1, credential }, null, 2)}\n`;
}

function assertNoSecrets(value: unknown, extra: string[] = []): void {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	for (const secret of [...ALL_SECRETS, ...extra]) {
		expect(text).not.toContain(secret);
	}
	expect(text).not.toMatch(/fingerprint/iu);
	expect(text).not.toContain("hidden@example.com");
}

async function writeKind(home: string, kind: OAuthSourceKind, document: unknown): Promise<string> {
	const path = resolveOAuthSourcePath(kind, sandbox(home));
	await writeOwnerOnly(path, `${JSON.stringify(document)}\n`);
	return path;
}

describe("allowlisted source paths", () => {
	it("resolves default homes and env overrides", async () => {
		const home = await tempHome();
		expect(resolveOAuthSourcePath("grok", sandbox(home)).replaceAll("\\", "/")).toBe(
			join(home, ".grok", "auth.json").replaceAll("\\", "/"),
		);
		expect(resolveOAuthSourcePath("codex", sandbox(home)).replaceAll("\\", "/")).toBe(
			join(home, ".codex", "auth.json").replaceAll("\\", "/"),
		);
		expect(resolveOAuthSourcePath("kimi", sandbox(home)).replaceAll("\\", "/")).toBe(
			join(home, ".kimi", "credentials", "kimi-code.json").replaceAll("\\", "/"),
		);
		expect(resolveOAuthSourcePath("claude", sandbox(home)).replaceAll("\\", "/")).toBe(
			join(home, ".claude", ".credentials.json").replaceAll("\\", "/"),
		);

		const env = {
			GROK_HOME: join(home, "g"),
			CODEX_HOME: join(home, "c"),
			KIMI_SHARE_DIR: join(home, "k"),
			CLAUDE_CONFIG_DIR: join(home, "a"),
		};
		expect(resolveOAuthSourcePath("grok", sandbox(home, env)).replaceAll("\\", "/")).toMatch(/\/g\/auth\.json$/);
		expect(resolveOAuthSourcePath("kimi", sandbox(home, env)).replaceAll("\\", "/")).toMatch(
			/\/k\/credentials\/kimi-code\.json$/,
		);
		expect(resolveOAuthSourcePath("claude", sandbox(home, env)).replaceAll("\\", "/")).toMatch(
			/\/a\/\.credentials\.json$/,
		);
	});

	it("renders safe relative display paths instead of absolute locations", async () => {
		const home = await tempHome();
		expect(oauthSourceDisplayPath("grok", sandbox(home))).toBe("~/.grok/auth.json");
		expect(oauthSourceDisplayPath("codex", sandbox(home))).toBe("~/.codex/auth.json");
		expect(oauthSourceDisplayPath("kimi", sandbox(home))).toBe("~/.kimi/credentials/kimi-code.json");
		expect(oauthSourceDisplayPath("claude", sandbox(home))).toBe("~/.claude/.credentials.json");
		expect(oauthSourceDisplayPath("grok", sandbox(home, { GROK_HOME: join(home, "custom") }))).toBe(
			"$GROK_HOME/auth.json",
		);
		expect(oauthSourceDisplayPath("kimi", sandbox(home, { KIMI_SHARE_DIR: join(home, "k") }))).toBe(
			"$KIMI_SHARE_DIR/credentials/kimi-code.json",
		);
		expect(JSON.stringify(oauthSourceDisplayPath("grok", sandbox(home)))).not.toContain(home);
	});

	it("maps kinds onto the existing destination provider ids", () => {
		expect(OAUTH_SOURCE_KINDS).toEqual(["grok", "codex", "kimi", "claude"]);
		expect(OAUTH_SOURCE_SPECS).toHaveLength(4);
		expect(oauthSourceProviderId("grok")).toBe(XAI_PI_PROVIDER);
		expect(oauthSourceProviderId("codex")).toBe(CODEX_PI_PROVIDER);
		expect(oauthSourceProviderId("kimi")).toBe(KIMI_PI_PROVIDER);
		expect(oauthSourceProviderId("claude")).toBe(CLAUDE_PI_PROVIDER);
		expect(isOAuthSourceKind("grok")).toBe(true);
		expect(isOAuthSourceKind("gemini")).toBe(false);
	});
});

describe("hardened source reads", () => {
	it("reads an owner-only regular file and never writes it", async () => {
		const home = await tempHome();
		const path = await writeKind(home, "grok", grokDocument());
		const before = await readFile(path);
		const listed = await lstat(path);
		const read = await readHardenedOAuthSourceFile(path);
		expect(read.path).toBe(path);
		expect(read.text).toContain(GROK_ACCESS);
		expect(read.identity).toMatchObject({
			dev: listed.dev,
			ino: listed.ino,
			uid: listed.uid,
			size: listed.size,
		});
		expect(await readFile(path)).toEqual(before);
		expect((await lstat(path)).mtimeMs).toBe(listed.mtimeMs);
	});

	it.skipIf(!posix)("rejects a symlink even when the target is a valid owner-only file", async () => {
		const home = await tempHome();
		const real = join(home, "real-auth.json");
		await writeOwnerOnly(real, `${JSON.stringify(grokDocument())}\n`);
		const link = join(home, "link-auth.json");
		await symlink(real, link);
		await expect(readHardenedOAuthSourceFile(link)).rejects.toMatchObject({
			name: "OAuthSourceError",
			code: "unsafe_source",
		});
		expect(await readFile(real, "utf8")).toContain(GROK_ACCESS);
	});

	it.skipIf(!posix)("rejects group-or-other readable files", async () => {
		const home = await tempHome();
		const path = await writeKind(home, "grok", grokDocument());
		await chmod(path, 0o644);
		await expect(readHardenedOAuthSourceFile(path)).rejects.toMatchObject({ code: "unsafe_source" });
	});

	it("rejects a directory and a missing path without leaking contents", async () => {
		const home = await tempHome();
		const dir = join(home, "not-a-file");
		await mkdir(dir, { recursive: true });
		await expect(readHardenedOAuthSourceFile(dir)).rejects.toMatchObject({ code: "unsafe_source" });
		await expect(readHardenedOAuthSourceFile(join(home, "missing.json"))).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("rejects a file over the 64KiB cap and accepts a file at the cap", async () => {
		const home = await tempHome();
		const oversized = join(home, "big.json");
		await writeOwnerOnly(oversized, Buffer.alloc(OAUTH_SOURCE_MAX_BYTES + 1, 0x78));
		await expect(readHardenedOAuthSourceFile(oversized)).rejects.toMatchObject({ code: "too_large" });

		const prefix =
			'{"https://auth.x.ai::c":{"key":"a","refresh_token":"r","expires_at":"2026-01-01T00:00:00.000Z","oidc_issuer":"https://auth.x.ai","pad":"';
		const suffix = '"}}';
		const exact = join(home, "exact.json");
		await writeOwnerOnly(
			exact,
			`${prefix}${"x".repeat(OAUTH_SOURCE_MAX_BYTES - prefix.length - suffix.length)}${suffix}`,
		);
		const read = await readHardenedOAuthSourceFile(exact);
		expect(Buffer.byteLength(read.text, "utf8")).toBe(OAUTH_SOURCE_MAX_BYTES);
		expect(parseGrokCliAuthDocument(read.text)).toMatchObject({ access: "a", refresh: "r" });
	});
});

describe("exact Grok parser", () => {
	it("reads the auth.x.ai OIDC scope-map entry with RFC3339 microseconds", () => {
		const credential = parseGrokCliAuthDocument(JSON.stringify(grokDocument()));
		expect(credential).toEqual({
			type: "oauth",
			access: GROK_ACCESS,
			refresh: GROK_REFRESH,
			expires: Date.parse("2026-08-14T12:00:00.000Z"),
			accountId: "user-1",
		});
	});

	it("accepts a top-level auth.x.ai OIDC object without walking wrappers", () => {
		const credential = parseGrokCliAuthDocument(
			JSON.stringify({
				key: GROK_ACCESS,
				refresh_token: GROK_REFRESH,
				expires_at: "2026-08-14T12:00:00.000Z",
				oidc_issuer: "https://auth.x.ai",
				user_id: "user-1",
			}),
		);
		expect(credential.accountId).toBe("user-1");
		expect(credential.access).toBe(GROK_ACCESS);
	});

	it("requires RFC3339 expires_at and ignores other issuers", () => {
		expect(() =>
			parseGrokCliAuthDocument(
				JSON.stringify({
					"https://example.com::other": {
						key: "other-access",
						refresh_token: "other-refresh",
						expires_at: "2028-01-01T00:00:00.000Z",
						oidc_issuer: "https://example.com",
					},
					"https://auth.x.ai::client": {
						key: GROK_ACCESS,
						refresh_token: GROK_REFRESH,
						created_at: "2026-01-01T00:00:00.000Z",
						oidc_issuer: "https://auth.x.ai",
						user_id: "user-1",
					},
				}),
			),
		).toThrow(/RFC3339 expires_at/);
	});

	it("picks the latest valid auth.x.ai expiry among multiple OIDC entries", () => {
		const credential = parseGrokCliAuthDocument(
			JSON.stringify({
				"https://example.com::other": {
					key: "other-access",
					refresh_token: "other-refresh",
					expires_at: "2028-01-01T00:00:00.000Z",
					oidc_issuer: "https://example.com",
				},
				"https://auth.x.ai::older": {
					key: "older-access",
					refresh_token: "older-refresh",
					expires_at: "2026-01-01T00:00:00.000Z",
					oidc_issuer: "https://auth.x.ai",
				},
				"https://auth.x.ai::invalid": {
					key: "invalid-access",
					refresh_token: "invalid-refresh",
					expires_at: "not-an-rfc3339-timestamp",
					oidc_issuer: "https://auth.x.ai",
				},
				"https://auth.x.ai::newer": {
					key: GROK_ACCESS,
					refresh_token: GROK_REFRESH,
					expires_at: "2026-08-14T12:00:00.000Z",
					oidc_issuer: "https://auth.x.ai",
					user_id: "user-1",
				},
			}),
		);
		expect(credential).toEqual({
			type: "oauth",
			access: GROK_ACCESS,
			refresh: GROK_REFRESH,
			expires: Date.parse("2026-08-14T12:00:00.000Z"),
			accountId: "user-1",
		});
		const reversed = parseGrokCliAuthDocument(
			JSON.stringify({
				"https://auth.x.ai::newer": {
					key: GROK_ACCESS,
					refresh_token: GROK_REFRESH,
					expires_at: "2026-08-14T12:00:00.000Z",
					oidc_issuer: "https://auth.x.ai",
					user_id: "user-1",
				},
				"https://auth.x.ai::older": {
					key: "older-access",
					refresh_token: "older-refresh",
					expires_at: "2026-01-01T00:00:00.000Z",
					oidc_issuer: "https://auth.x.ai",
				},
			}),
		);
		expect(reversed.access).toBe(GROK_ACCESS);
		expect(reversed.expires).toBe(Date.parse("2026-08-14T12:00:00.000Z"));
	});

	it("does not recursively guess nested token pairs", () => {
		expect(() =>
			parseGrokCliAuthDocument(
				JSON.stringify({
					wrapper: {
						nested: {
							key: GROK_ACCESS,
							refresh_token: GROK_REFRESH,
							oidc_issuer: "https://auth.x.ai",
							expires_at: "2026-01-01T00:00:00.000Z",
						},
					},
				}),
			),
		).toThrow(/auth\.x\.ai OIDC/);
		expect(() =>
			parseGrokCliAuthDocument(
				JSON.stringify({
					access_token: GROK_ACCESS,
					refresh_token: GROK_REFRESH,
					expires_in: 3600,
				}),
			),
		).toThrow(OAuthSourceError);
	});

	it("keeps parse errors secret-free", () => {
		try {
			parseGrokCliAuthDocument(JSON.stringify({ leak: GROK_REFRESH }));
			throw new Error("expected parse to fail");
		} catch (error) {
			expect(isOAuthSourceError(error)).toBe(true);
			assertNoSecrets(error instanceof Error ? error.message : error);
		}
	});
});

describe("exact Codex, Kimi, and Claude parsers", () => {
	it("reads Codex tokens and JWT exp seconds, and rejects API keys", () => {
		const credential = parseCodexCliAuthDocument(JSON.stringify(codexDocument()));
		expect(credential).toMatchObject({
			type: "oauth",
			refresh: CODEX_REFRESH,
			accountId: "acct-codex",
		});
		expect(credential.expires).toBe(1_800_000_000 * 1000);
		expect(credential.access).toContain("eyJ");

		expect(() => parseCodexCliAuthDocument(JSON.stringify({ OPENAI_API_KEY: "sk-secret-api-key" }))).toThrow(/API key/);
		expect(() =>
			parseCodexCliAuthDocument(
				JSON.stringify({
					auth_mode: "apikey",
					tokens: { id_token: "x", access_token: "y", refresh_token: "z" },
				}),
			),
		).toThrow(/API key/);
		try {
			parseCodexCliAuthDocument(JSON.stringify({ OPENAI_API_KEY: "sk-secret-api-key" }));
		} catch (error) {
			expect(String(error)).not.toContain("sk-secret-api-key");
		}
	});

	it("prefers official tokens.account_id, then top-level, then the full access JWT claim", () => {
		const jwtAccount = "acct_full-account-id-does-not-get-sliced";
		const accessWithClaim = unsignedJwt({
			exp: 1_800_000_000,
			"https://api.openai.com/auth": { chatgpt_account_id: jwtAccount },
		});
		expect(
			parseCodexCliAuthDocument(
				JSON.stringify(
					codexDocument({
						account_id: "acct-top-level",
						tokens: {
							id_token: unsignedJwt({ exp: 1_800_000_000, email: "hidden@example.com" }),
							access_token: accessWithClaim,
							refresh_token: CODEX_REFRESH,
							account_id: "acct-from-tokens",
						},
					}),
				),
			).accountId,
		).toBe("acct-from-tokens");
		expect(
			parseCodexCliAuthDocument(
				JSON.stringify(
					codexDocument({
						account_id: "acct-top-level",
						tokens: {
							id_token: unsignedJwt({ exp: 1_800_000_000, email: "hidden@example.com" }),
							access_token: accessWithClaim,
							refresh_token: CODEX_REFRESH,
						},
					}),
				),
			).accountId,
		).toBe("acct-top-level");
		expect(
			parseCodexCliAuthDocument(
				JSON.stringify({
					auth_mode: "chatgpt",
					tokens: {
						id_token: unsignedJwt({ exp: 1_800_000_000, email: "hidden@example.com" }),
						access_token: accessWithClaim,
						refresh_token: CODEX_REFRESH,
					},
				}),
			).accountId,
		).toBe(jwtAccount);
	});

	it("reads Kimi snake_case expires_at seconds and rejects camelCase", () => {
		const credential = parseKimiCliAuthDocument(JSON.stringify(kimiDocument()));
		expect(credential).toEqual({
			type: "oauth",
			access: KIMI_ACCESS,
			refresh: KIMI_REFRESH,
			expires: 1_800_000_000_000,
			accountId: "kimi-user",
		});
		expect(() =>
			parseKimiCliAuthDocument(
				JSON.stringify({
					accessToken: KIMI_ACCESS,
					refreshToken: KIMI_REFRESH,
					expiresAt: 1_800_000_000_000,
				}),
			),
		).toThrow(/access_token/);
		expect(() =>
			parseKimiCliAuthDocument(
				JSON.stringify({
					access_token: KIMI_ACCESS,
					refresh_token: KIMI_REFRESH,
					expires_at: "2026-01-01T00:00:00Z",
				}),
			),
		).toThrow(/expires_at/);
	});

	it("reads Claude claudeAiOauth camelCase expiresAt milliseconds", () => {
		const credential = parseClaudeCliAuthDocument(JSON.stringify(claudeDocument()));
		expect(credential).toEqual({
			type: "oauth",
			access: CLAUDE_ACCESS,
			refresh: CLAUDE_REFRESH,
			expires: 1_800_000_000_000,
		});
		expect(() =>
			parseClaudeCliAuthDocument(
				JSON.stringify({
					accessToken: CLAUDE_ACCESS,
					refreshToken: CLAUDE_REFRESH,
					expiresAt: 1_800_000_000_000,
				}),
			),
		).toThrow(/claudeAiOauth/);
		expect(() =>
			parseClaudeCliAuthDocument(
				JSON.stringify({
					claudeAiOauth: {
						access_token: CLAUDE_ACCESS,
						refresh_token: CLAUDE_REFRESH,
						expires_at: 1_800_000_000,
					},
				}),
			),
		).toThrow(/accessToken/);
	});

	it("dispatches parseOAuthSourceDocument by kind", () => {
		expect(parseOAuthSourceDocument("kimi", JSON.stringify(kimiDocument())).access).toBe(KIMI_ACCESS);
		expect(parseOAuthSourceDocument("claude", JSON.stringify(claudeDocument())).refresh).toBe(CLAUDE_REFRESH);
	});
});

describe("discovery", () => {
	it("lists only non-secret availability and display paths", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		await writeKind(home, "kimi", kimiDocument());
		const listings = await discoverOAuthSources(sandbox(home));
		expect(listings.map((item) => item.kind)).toEqual([...OAUTH_SOURCE_KINDS]);
		const grok = listings.find((item) => item.kind === "grok");
		const kimi = listings.find((item) => item.kind === "kimi");
		const claude = listings.find((item) => item.kind === "claude");
		expect(grok).toMatchObject({ available: true, displayPath: "~/.grok/auth.json" });
		expect(kimi).toMatchObject({ available: true, displayPath: "~/.kimi/credentials/kimi-code.json" });
		expect(claude).toMatchObject({ available: false, reason: "missing" });
		assertNoSecrets(listings);
		expect(JSON.stringify(listings)).not.toContain(home);
	});

	it.skipIf(!posix)("reports an unsafe source without reading through a symlink", async () => {
		const home = await tempHome();
		const real = join(home, "real.json");
		await writeOwnerOnly(real, `${JSON.stringify(grokDocument())}\n`);
		await mkdir(join(home, ".grok"), { recursive: true, mode: 0o700 });
		await symlink(real, resolveOAuthSourcePath("grok", sandbox(home)));
		const probe = await probeOAuthSource("grok", sandbox(home));
		expect(probe).toMatchObject({ available: false, reason: "unsafe", displayPath: "~/.grok/auth.json" });
		assertNoSecrets(probe);
	});
});

describe("destination inspection and conflict classes", () => {
	it("classifies none, same credential, same account, different account, and unknown", () => {
		const incoming: OAuthSourceCredential = {
			type: "oauth",
			access: "a1",
			refresh: "r1",
			expires: 10,
			accountId: "acct-a",
		};
		expect(classifyOAuthImportConflict(incoming, { status: "missing" })).toBe("none");
		expect(
			classifyOAuthImportConflict(incoming, {
				status: "readable",
				credential: { type: "oauth", access: "a1", refresh: "r1", expires: 99 },
			}),
		).toBe("same_credential");
		expect(
			classifyOAuthImportConflict(incoming, {
				status: "readable",
				credential: { type: "oauth", access: "a2", refresh: "r2", expires: 10, accountId: "acct-a" },
			}),
		).toBe("same_account");
		expect(
			classifyOAuthImportConflict(incoming, {
				status: "readable",
				credential: { type: "oauth", access: "a2", refresh: "r2", expires: 10, accountId: "acct-b" },
			}),
		).toBe("different_account");
		expect(
			classifyOAuthImportConflict(incoming, {
				status: "readable",
				credential: { type: "oauth", access: "a2", refresh: "r2", expires: 10 },
			}),
		).toBe("unknown_account");
		expect(classifyOAuthImportConflict(incoming, { status: "unreadable" })).toBe("unreadable_destination");
		expect(classifyOAuthImportConflict(incoming, { status: "unsafe" })).toBe("unsafe_destination");
		expect(oauthImportRequiresConfirm("same_account")).toBe(true);
		expect(oauthImportRequiresConfirm("none")).toBe(false);
		expect(oauthImportRequiresConfirm("same_credential")).toBe(false);
		expect(oauthImportRequiresConfirm("unsafe_destination")).toBe(false);
	});

	it("inspects a destination store document without following unsafe files", async () => {
		const home = await tempHome();
		const dest = join(home, "dest.json");
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: GROK_ACCESS, refresh: GROK_REFRESH, expires: 20, accountId: "user-1" }),
		);
		const readable = await inspectOAuthDestinationFile(dest);
		expect(readable.status).toBe("readable");
		expect(readable.credential).toMatchObject({ access: GROK_ACCESS, accountId: "user-1" });
		expect((await inspectOAuthDestinationFile(join(home, "missing.json"))).status).toBe("missing");
		await writeOwnerOnly(join(home, "bad.json"), "{not-json");
		const unreadable = await inspectOAuthDestinationFile(join(home, "bad.json"));
		expect(unreadable.status).toBe("unreadable");
		expect(unreadable.payloadMac).toMatch(/^[0-9a-f]{64}$/iu);
		expect(unreadable.payloadMac).not.toContain("{not-json");
		expect(JSON.stringify(unreadable)).not.toContain("{not-json");
	});
});

describe("two-phase preview and commit", () => {
	it("imports a new credential and returns persist material only internally", async () => {
		const home = await tempHome();
		const sourcePath = await writeKind(home, "grok", grokDocument());
		const original = await readFile(sourcePath, "utf8");
		const session = createOAuthImportSession();
		const preview = await session.preview({ kind: "grok", ...sandbox(home) });
		expect(preview).toMatchObject({
			kind: "grok",
			displayPath: "~/.grok/auth.json",
			conflict: "none",
			action: "import",
			confirmOverwriteRequired: false,
		});
		expect(preview.previewId.length).toBeGreaterThan(16);
		expect(Object.keys(preview).sort()).toEqual([
			"action",
			"confirmOverwriteRequired",
			"conflict",
			"displayPath",
			"expiresAt",
			"kind",
			"previewId",
			"ticketExpiresAt",
			"warnings",
		]);
		assertNoSecrets(preview);
		expect(JSON.stringify(preview)).not.toContain(sourcePath);

		const outcome = await session.commit({ previewId: preview.previewId, ...sandbox(home) });
		expect(outcome.result).toMatchObject({
			action: "imported",
			displayPath: "~/.grok/auth.json",
			expiresAt: Date.parse("2026-08-14T12:00:00.000Z"),
		});
		assertNoSecrets(outcome);
		assertNoSecrets(outcome.result);
		expect(JSON.stringify(outcome)).not.toContain(GROK_ACCESS);
		expect(outcome.takePersist()).toEqual({
			type: "oauth",
			access: GROK_ACCESS,
			refresh: GROK_REFRESH,
			expires: Date.parse("2026-08-14T12:00:00.000Z"),
			accountId: "user-1",
		});
		expect(await readFile(sourcePath, "utf8")).toBe(original);
	});

	it("keeps the destination store canonical when the credential is unchanged", async () => {
		const home = await tempHome();
		await writeKind(home, "codex", codexDocument());
		const existing: OAuthSourceCredential = {
			type: "oauth",
			access: unsignedJwt(CODEX_ACCESS_PAYLOAD),
			refresh: CODEX_REFRESH,
			expires: 99,
			accountId: "acct-codex",
		};
		const dest = join(home, "codex-dest.json");
		const destBody = stored(existing);
		await writeOwnerOnly(dest, destBody);
		const session = createOAuthImportSession();
		const preview = await session.preview({
			kind: "codex",
			...sandbox(home),
			destination: { path: dest },
		});
		expect(preview.conflict).toBe("same_credential");
		expect(preview.action).toBe("reuse");
		expect(preview.confirmOverwriteRequired).toBe(false);
		const outcome = await session.commit({
			previewId: preview.previewId,
			...sandbox(home),
			destination: { path: dest },
		});
		expect(outcome.result.action).toBe("unchanged");
		expect(outcome.takePersist()).toBeUndefined();
		expect(await readFile(dest, "utf8")).toBe(destBody);
	});

	it("requires confirmOverwrite for a changed credential and then returns overwrite material", async () => {
		const home = await tempHome();
		await writeKind(home, "kimi", kimiDocument());
		const dest = join(home, "kimi-dest.json");
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: "old-access", refresh: "old-refresh", expires: 10, accountId: "kimi-user" }),
		);
		const session = createOAuthImportSession();
		const preview = await session.preview({ kind: "kimi", ...sandbox(home), destination: { path: dest } });
		expect(preview).toMatchObject({
			conflict: "same_account",
			action: "overwrite",
			confirmOverwriteRequired: true,
		});
		expect(preview.warnings).toContain("Stored credential for this account will be replaced");
		assertNoSecrets(preview, ["old-access", "old-refresh"]);

		await expect(
			session.commit({ previewId: preview.previewId, ...sandbox(home), destination: { path: dest } }),
		).rejects.toMatchObject({ code: "confirm_required" });

		const preview2 = await session.preview({ kind: "kimi", ...sandbox(home), destination: { path: dest } });
		const outcome = await session.commit({
			previewId: preview2.previewId,
			confirmOverwrite: true,
			...sandbox(home),
			destination: { path: dest },
		});
		expect(outcome.result.action).toBe("overwritten");
		expect(outcome.takePersist()).toMatchObject({ access: KIMI_ACCESS, refresh: KIMI_REFRESH, accountId: "kimi-user" });
	});

	it("peeks a live ticket without consuming it and rejects a kind mismatch without consume", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const session = createOAuthImportSession();
		const preview = await session.preview({ kind: "grok", ...sandbox(home) });
		const claim = session.peekPreview(preview.previewId);
		expect(claim).toEqual({ kind: "grok", ticketExpiresAt: preview.ticketExpiresAt });
		expect(Object.keys(claim).sort()).toEqual(["kind", "ticketExpiresAt"]);
		await expect(
			session.commit({ previewId: preview.previewId, kind: "claude", ...sandbox(home) }),
		).rejects.toMatchObject({ code: "unsupported" });
		expect(session.peekPreview(preview.previewId).kind).toBe("grok");
		const outcome = await session.commit({ previewId: preview.previewId, kind: "grok", ...sandbox(home) });
		expect(outcome.result.action).toBe("imported");
		try {
			session.peekPreview(preview.previewId);
			throw new Error("expected peekPreview to reject a consumed ticket");
		} catch (error) {
			expect(error).toMatchObject({ code: "preview_invalid" });
		}
	});

	it("reports an expired peek once as preview_expired then as preview_invalid", async () => {
		const home = await tempHome();
		await writeKind(home, "claude", claudeDocument());
		let now = 1_700_000_000_000;
		const session = createOAuthImportSession({ now: () => now });
		const preview = await session.preview({ kind: "claude", ...sandbox(home) });
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		try {
			session.peekPreview(preview.previewId);
			throw new Error("expected peekPreview to reject an expired ticket");
		} catch (error) {
			expect(error).toMatchObject({ code: "preview_expired" });
		}
		try {
			session.peekPreview(preview.previewId);
			throw new Error("expected peekPreview to reject a consumed expired ticket");
		} catch (error) {
			expect(error).toMatchObject({ code: "preview_invalid" });
		}
	});

	it("treats preview ids as one-use and expires them after five minutes", async () => {
		const home = await tempHome();
		await writeKind(home, "claude", claudeDocument());
		let now = 1_700_000_000_000;
		const session = createOAuthImportSession({ now: () => now });
		const first = await session.preview({ kind: "claude", ...sandbox(home) });
		const used = await session.commit({ previewId: first.previewId, ...sandbox(home) });
		expect(used.result.action).toBe("imported");
		await expect(session.commit({ previewId: first.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});

		const second = await session.preview({ kind: "claude", ...sandbox(home) });
		expect(second.ticketExpiresAt).toBe(now + OAUTH_IMPORT_PREVIEW_TTL_MS);
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		await expect(session.commit({ previewId: second.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_expired",
		});
		await expect(session.commit({ previewId: second.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});
	});

	it("bounds credential-bearing previews and evicts the oldest ticket", async () => {
		const home = await tempHome();
		await writeKind(home, "claude", claudeDocument());
		const session = createOAuthImportSession();
		const previews = [];
		for (let index = 0; index <= OAUTH_IMPORT_MAX_PREVIEW_TICKETS; index += 1) {
			previews.push(await session.preview({ kind: "claude", ...sandbox(home) }));
		}
		expect(previews).toHaveLength(OAUTH_IMPORT_MAX_PREVIEW_TICKETS + 1);
		await expect(session.commit({ previewId: previews[0]?.previewId ?? "", ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});
		const newest = previews.at(-1);
		if (newest === undefined) throw new Error("newest preview missing");
		expect((await session.commit({ previewId: newest.previewId, ...sandbox(home) })).result.action).toBe("imported");
	});

	it("purges abandoned expired tickets during discover, preview, and cancel", async () => {
		const home = await tempHome();
		await writeKind(home, "claude", claudeDocument());
		let now = 1_700_000_000_000;
		const session = createOAuthImportSession({ now: () => now });

		const discovered = await session.preview({ kind: "claude", ...sandbox(home) });
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		await session.discover(sandbox(home));
		await expect(session.commit({ previewId: discovered.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});

		now = 1_700_000_100_000;
		const previewed = await session.preview({ kind: "claude", ...sandbox(home) });
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		await session.preview({ kind: "claude", ...sandbox(home) });
		await expect(session.commit({ previewId: previewed.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});

		now = 1_700_000_200_000;
		const abandoned = await session.preview({ kind: "claude", ...sandbox(home) });
		const cancellable = await session.preview({ kind: "claude", ...sandbox(home) });
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		expect(session.cancel(cancellable.previewId)).toBe(true);
		await expect(session.commit({ previewId: abandoned.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});
	});

	it("reopens the source and rejects a changed source or destination revision", async () => {
		const home = await tempHome();
		const sourcePath = await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: "old", refresh: "old-r", expires: 10, accountId: "other" }),
		);
		const session = createOAuthImportSession();
		const sourceChanged = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { path: dest },
		});
		await writeOwnerOnly(sourcePath, `${JSON.stringify(grokDocument({ key: "rotated-access", user_id: "user-1" }))}\n`);
		await expect(
			session.commit({
				previewId: sourceChanged.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: { path: dest },
			}),
		).rejects.toMatchObject({ code: "source_changed" });

		await writeKind(home, "grok", grokDocument());
		const destChanged = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { path: dest },
		});
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: "newer", refresh: "newer-r", expires: 11, accountId: "other" }),
		);
		await expect(
			session.commit({
				previewId: destChanged.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: { path: dest },
			}),
		).rejects.toMatchObject({ code: "destination_changed" });
	});

	it("reports an unsafe destination as blocked and refuses commit", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		await writeOwnerOnly(dest, stored({ type: "oauth", access: "old", refresh: "old-r", expires: 10 }));
		if (posix) await chmod(dest, 0o644);
		const session = createOAuthImportSession();
		const preview = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: posix ? { path: dest } : { status: "unsafe" },
		});
		expect(preview).toMatchObject({
			conflict: "unsafe_destination",
			action: "blocked",
			confirmOverwriteRequired: false,
		});
		assertNoSecrets(preview);
		await expect(
			session.commit({
				previewId: preview.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: posix ? { path: dest } : { status: "unsafe" },
			}),
		).rejects.toMatchObject({ code: "unsafe_destination" });
	});

	it("classifies an unreadable destination and still overwrites after confirm", async () => {
		const home = await tempHome();
		const sourcePath = await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		await writeOwnerOnly(dest, "{not-json");
		const session = createOAuthImportSession();
		const preview = await session.preview({ kind: "grok", ...sandbox(home), destination: { path: dest } });
		expect(preview.conflict).toBe("unreadable_destination");
		expect(preview.action).toBe("overwrite");
		expect(preview.confirmOverwriteRequired).toBe(true);
		assertNoSecrets(preview);
		expect(JSON.stringify(preview)).not.toContain("{not-json");
		expect(JSON.stringify(preview)).not.toContain(dest);
		expect(JSON.stringify(preview)).not.toContain(sourcePath);
		await expect(
			session.commit({
				previewId: preview.previewId,
				...sandbox(home),
				destination: { path: dest },
			}),
		).rejects.toMatchObject({ code: "confirm_required" });

		const previewAgain = await session.preview({ kind: "grok", ...sandbox(home), destination: { path: dest } });
		const outcome = await session.commit({
			previewId: previewAgain.previewId,
			confirmOverwrite: true,
			...sandbox(home),
			destination: { path: dest },
		});
		expect(outcome.result.action).toBe("overwritten");
		assertNoSecrets(outcome.result);
		expect(JSON.stringify(outcome)).not.toContain("{not-json");
		expect(outcome.takePersist()?.access).toBe(GROK_ACCESS);
	});

	it("treats same-size unreadable destination garbage as a CAS change", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		await writeOwnerOnly(dest, "{not-json");
		const session = createOAuthImportSession();
		const preview = await session.preview({ kind: "grok", ...sandbox(home), destination: { path: dest } });
		expect(preview.conflict).toBe("unreadable_destination");
		await writeOwnerOnly(dest, "{bad-json");
		await expect(
			session.commit({
				previewId: preview.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: { path: dest },
			}),
		).rejects.toMatchObject({ code: "destination_changed" });
		expect(await readFile(dest, "utf8")).toBe("{bad-json");
		assertNoSecrets(preview);
	});

	it("honors a parent-supplied destination revision and cancel()", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const session = createOAuthImportSession();
		const destCredential: OAuthSourceCredential = { type: "oauth", access: "x", refresh: "y", expires: 1 };
		const preview = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { status: "readable", revision: "rev-1", credential: destCredential },
		});
		expect(preview.conflict).toBe("unknown_account");
		await expect(
			session.commit({
				previewId: preview.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: { status: "readable", revision: "rev-2", credential: destCredential },
			}),
		).rejects.toMatchObject({ code: "destination_changed" });

		const cancelled = await session.preview({ kind: "grok", ...sandbox(home) });
		expect(session.cancel(cancelled.previewId)).toBe(true);
		await expect(session.commit({ previewId: cancelled.previewId, ...sandbox(home) })).rejects.toMatchObject({
			code: "preview_invalid",
		});
	});

	it("treats on-disk destination inspection as authoritative over a caller credential", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		const onDisk = parseGrokCliAuthDocument(JSON.stringify(grokDocument()));
		await writeOwnerOnly(dest, stored(onDisk));
		const stale: OAuthSourceCredential = {
			type: "oauth",
			access: "stale-access",
			refresh: "stale-refresh",
			expires: 10,
			accountId: "other-user",
		};
		const session = createOAuthImportSession();
		const preview = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { path: dest, status: "readable", credential: stale },
		});
		expect(preview.conflict).toBe("same_credential");
		expect(preview.action).toBe("reuse");
		assertNoSecrets(preview, ["stale-access", "stale-refresh"]);
		const outcome = await session.commit({
			previewId: preview.previewId,
			...sandbox(home),
			destination: { path: dest, status: "readable", credential: stale },
		});
		expect(outcome.result.action).toBe("unchanged");
		expect(outcome.takePersist()).toBeUndefined();
	});

	it("rechecks destination fingerprint inside commit when the on-disk file changes", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const dest = join(home, "dest.json");
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: "old", refresh: "old-r", expires: 10, accountId: "other" }),
		);
		const stale: OAuthSourceCredential = {
			type: "oauth",
			access: "stale-access",
			refresh: "stale-refresh",
			expires: 1,
		};
		const session = createOAuthImportSession();
		const preview = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { path: dest, credential: stale },
		});
		expect(preview.conflict).toBe("different_account");
		await writeOwnerOnly(
			dest,
			stored({ type: "oauth", access: "newer", refresh: "newer-r", expires: 11, accountId: "other" }),
		);
		await expect(
			session.commit({
				previewId: preview.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: { path: dest, credential: stale },
			}),
		).rejects.toMatchObject({ code: "destination_changed" });
	});

	it("rechecks destination fingerprint when the caller credential changes under the same revision", async () => {
		const home = await tempHome();
		await writeKind(home, "grok", grokDocument());
		const session = createOAuthImportSession();
		const destCredential: OAuthSourceCredential = { type: "oauth", access: "x", refresh: "y", expires: 1 };
		const preview = await session.preview({
			kind: "grok",
			...sandbox(home),
			destination: { status: "readable", revision: "rev-1", credential: destCredential },
		});
		await expect(
			session.commit({
				previewId: preview.previewId,
				confirmOverwrite: true,
				...sandbox(home),
				destination: {
					status: "readable",
					revision: "rev-1",
					credential: { type: "oauth", access: "changed", refresh: "y", expires: 1 },
				},
			}),
		).rejects.toMatchObject({ code: "destination_changed" });
	});
});

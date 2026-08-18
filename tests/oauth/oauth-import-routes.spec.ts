import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_PI_PROVIDER, CODEX_PI_PROVIDER, KIMI_PI_PROVIDER, XAI_PI_PROVIDER } from "../../src/core/ids.ts";
import {
	OAUTH_IMPORT_CANCEL_PATH,
	OAUTH_IMPORT_COMMIT_PATH,
	OAUTH_IMPORT_PREVIEW_PATH,
	OAUTH_IMPORT_SOURCES_PATH,
	type OAuthImportAppliedEvent,
	type OAuthImportDestinationStore,
	type OAuthImportDestinations,
	type OAuthImportRouteContext,
	registerOAuthImportRoutes,
} from "../../src/oauth/oauth-import-routes.ts";
import {
	OAUTH_IMPORT_MAX_PREVIEW_TICKETS,
	OAUTH_IMPORT_PREVIEW_TTL_MS,
	type OAuthSourceCredential,
	type OAuthSourceKind,
	resolveOAuthSourcePath,
} from "../../src/oauth/oauth-sources.ts";

const GROK_ACCESS = "grok-access-token-value";
const GROK_REFRESH = "grok-refresh-token-value";
const ALL_SECRETS = [GROK_ACCESS, GROK_REFRESH];

interface RegisteredRoute {
	path: string;
	handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

class TestResponse {
	status = 0;
	headers: Record<string, string> = {};
	body = "";

	writeHead(status: number, headers?: Record<string, string>): this {
		this.status = status;
		this.headers = headers ?? {};
		return this;
	}

	end(value?: string): this {
		this.body += value ?? "";
		return this;
	}
}

class FakeStore implements OAuthImportDestinationStore {
	current: OAuthSourceCredential | undefined;
	modifyCount = 0;
	locked = false;
	commitInsideLock = false;

	constructor(readonly filename: string) {}

	async modify(
		_providerId: string,
		fn: (current: OAuthSourceCredential | undefined) => Promise<OAuthSourceCredential | undefined>,
	): Promise<OAuthSourceCredential | undefined> {
		this.modifyCount += 1;
		this.locked = true;
		try {
			const next = await fn(this.current);
			this.commitInsideLock = this.locked;
			if (next !== undefined) {
				this.current = {
					type: "oauth",
					access: next.access,
					refresh: next.refresh,
					expires: next.expires,
					...(next.accountId === undefined ? {} : { accountId: next.accountId }),
				};
				await writeOwnerOnly(this.filename, stored(this.current));
			}
			return this.current;
		} finally {
			this.locked = false;
		}
	}
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function tempHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "dsh-oauth-import-"));
	temporaryDirectories.push(home);
	return home;
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

function request(
	method: string,
	body = "",
	headers: IncomingMessage["headers"] = {},
	remoteAddress = "127.0.0.1",
): IncomingMessage {
	const stream = Readable.from([body]) as unknown as IncomingMessage;
	Object.defineProperties(stream, {
		method: { value: method, configurable: true },
		headers: { value: { host: "127.0.0.1:3080", ...headers }, configurable: true },
		socket: { value: { remoteAddress }, configurable: true },
	});
	return stream;
}

async function invoke(
	handler: RegisteredRoute["handler"],
	req: IncomingMessage,
): Promise<{ status: number; body: unknown; raw: string }> {
	const response = new TestResponse();
	await handler(req, response as unknown as ServerResponse);
	return {
		status: response.status,
		body: response.body.length === 0 ? undefined : JSON.parse(response.body),
		raw: response.body,
	};
}

async function writeGrokSource(home: string): Promise<string> {
	const path = resolveOAuthSourcePath("grok", { home });
	await writeOwnerOnly(path, `${JSON.stringify(grokDocument())}\n`);
	return path;
}

function emptyDestinations(home: string): {
	destinations: OAuthImportDestinations;
	stores: Record<OAuthSourceKind, FakeStore>;
} {
	const stores = {
		grok: new FakeStore(join(home, "dest-grok.json")),
		codex: new FakeStore(join(home, "dest-codex.json")),
		kimi: new FakeStore(join(home, "dest-kimi.json")),
		claude: new FakeStore(join(home, "dest-claude.json")),
	};
	return {
		stores,
		destinations: {
			grok: { providerId: XAI_PI_PROVIDER, store: stores.grok },
			codex: { providerId: CODEX_PI_PROVIDER, store: stores.codex },
			kimi: { providerId: KIMI_PI_PROVIDER, store: stores.kimi },
			claude: { providerId: CLAUDE_PI_PROVIDER, store: stores.claude },
		},
	};
}

function registerRoutes(
	home: string,
	options: {
		now?: () => number;
		ttlMs?: number;
		onImported?: (event: OAuthImportAppliedEvent) => void;
		destinations?: OAuthImportDestinations;
		stores?: Record<OAuthSourceKind, FakeStore>;
	} = {},
): {
	handlers: Map<string, RegisteredRoute["handler"]>;
	stores: Record<OAuthSourceKind, FakeStore>;
} {
	const prepared = options.destinations === undefined ? emptyDestinations(home) : undefined;
	const destinations = options.destinations ?? prepared?.destinations;
	const stores = options.stores ?? prepared?.stores;
	if (destinations === undefined || stores === undefined) throw new Error("destinations required");
	const handlers = new Map<string, RegisteredRoute["handler"]>();
	const context: OAuthImportRouteContext = {
		webServer: {
			register(route) {
				handlers.set(route.path, route.handler);
				return () => handlers.delete(route.path);
			},
		},
		effect(setup) {
			setup();
		},
	};
	registerOAuthImportRoutes(context, destinations, {
		home,
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
		...(options.onImported === undefined ? {} : { onImported: options.onImported }),
	});
	return { handlers, stores };
}

function requireHandler(handlers: Map<string, RegisteredRoute["handler"]>, path: string): RegisteredRoute["handler"] {
	const handler = handlers.get(path);
	if (handler === undefined) throw new Error(`route ${path} was not registered`);
	return handler;
}

describe("oauth import route trust", () => {
	it("rejects non-loopback, cross-site, and Origin/Host mismatch before parsing a body", async () => {
		const home = await tempHome();
		const { handlers } = registerRoutes(home);
		const preview = requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH);

		const remote = await invoke(preview, request("POST", '{"kind":"grok"}', {}, "8.8.8.8"));
		expect(remote.status).toBe(403);
		expect(remote.body).toEqual({ error: "forbidden" });

		const crossSite = await invoke(preview, request("POST", '{"kind":"grok"}', { "sec-fetch-site": "cross-site" }));
		expect(crossSite.status).toBe(403);

		const origin = await invoke(preview, request("POST", '{"kind":"grok"}', { origin: "http://evil.example" }));
		expect(origin.status).toBe(403);

		const sources = requireHandler(handlers, OAUTH_IMPORT_SOURCES_PATH);
		const getCross = await invoke(sources, request("GET", "", { "sec-fetch-site": "cross-site" }));
		expect(getCross.status).toBe(403);
	});
});

describe("oauth import discovery and preview", () => {
	it("redacts internal 500 diagnostics", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		const prepared = emptyDestinations(home);
		Object.defineProperty(prepared.stores.grok, "filename", {
			get() {
				throw new Error("failed opening /home/private/oauth.json with token secret");
			},
		});
		const { handlers } = registerRoutes(home, prepared);
		const response = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: "request failed" });
	});

	it("lists secret-free discovery and preview, then imports without rewriting the CLI source", async () => {
		const home = await tempHome();
		const sourcePath = await writeGrokSource(home);
		const original = await readFile(sourcePath);
		const applied: OAuthImportAppliedEvent[] = [];
		const { handlers, stores } = registerRoutes(home, { onImported: (event) => applied.push(event) });

		const listed = await invoke(requireHandler(handlers, OAUTH_IMPORT_SOURCES_PATH), request("GET"));
		expect(listed.status).toBe(200);
		expect(listed.body).toMatchObject({
			sources: expect.arrayContaining([
				expect.objectContaining({ kind: "grok", available: true, displayPath: "~/.grok/auth.json" }),
			]),
		});
		assertNoSecrets(listed.body);
		expect(listed.raw).not.toContain(home);
		expect(listed.raw).not.toContain(sourcePath);

		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		expect(previewed.status).toBe(200);
		expect(previewed.body).toMatchObject({
			kind: "grok",
			displayPath: "~/.grok/auth.json",
			conflict: "none",
			action: "import",
			confirmOverwriteRequired: false,
		});
		assertNoSecrets(previewed.body);
		expect(previewed.raw).not.toContain(home);
		const previewId = (previewed.body as { previewId: string }).previewId;

		const committed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId })),
		);
		expect(committed.status).toBe(200);
		expect(committed.body).toMatchObject({
			action: "imported",
			displayPath: "~/.grok/auth.json",
			expiresAt: Date.parse("2026-08-14T12:00:00.000Z"),
		});
		assertNoSecrets(committed.body);
		expect(stores.grok.modifyCount).toBe(1);
		expect(stores.grok.commitInsideLock).toBe(true);
		expect(stores.grok.current).toMatchObject({
			access: GROK_ACCESS,
			refresh: GROK_REFRESH,
			accountId: "user-1",
		});
		expect(applied).toEqual([{ kind: "grok", action: "imported" }]);
		expect(await readFile(sourcePath)).toEqual(original);
	});

	it("rejects a POST on the discover path and an unknown kind", async () => {
		const home = await tempHome();
		const { handlers } = registerRoutes(home);
		const posted = await invoke(requireHandler(handlers, OAUTH_IMPORT_SOURCES_PATH), request("POST", "{}"));
		expect(posted.status).toBe(405);
		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "gemini" })),
		);
		expect(previewed.status).toBe(400);
	});
});

describe("oauth import overwrite and destination CAS", () => {
	it("requires an explicit confirmOverwrite boolean before replacing a stored credential", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		const { handlers, stores } = registerRoutes(home);
		const destBody = stored({
			type: "oauth",
			access: "old-access",
			refresh: "old-refresh",
			expires: 10,
			accountId: "user-1",
		});
		await writeOwnerOnly(stores.grok.filename, destBody);
		stores.grok.current = {
			type: "oauth",
			access: "old-access",
			refresh: "old-refresh",
			expires: 10,
			accountId: "user-1",
		};

		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		expect(previewed.status).toBe(200);
		expect(previewed.body).toMatchObject({
			conflict: "same_account",
			action: "overwrite",
			confirmOverwriteRequired: true,
		});
		assertNoSecrets(previewed.body, ["old-access", "old-refresh"]);

		const denied = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: (previewed.body as { previewId: string }).previewId })),
		);
		expect(denied.status).toBe(409);
		expect(denied.body).toMatchObject({ code: "confirm_required" });
		assertNoSecrets(denied.body, ["old-access", "old-refresh"]);

		const previewedAgain = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		const invalidFlag = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request(
				"POST",
				JSON.stringify({
					kind: "grok",
					previewId: (previewedAgain.body as { previewId: string }).previewId,
					confirmOverwrite: "yes",
				}),
			),
		);
		expect(invalidFlag.status).toBe(400);

		const previewedFinal = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		const overwritten = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request(
				"POST",
				JSON.stringify({
					kind: "grok",
					previewId: (previewedFinal.body as { previewId: string }).previewId,
					confirmOverwrite: true,
				}),
			),
		);
		expect(overwritten.status).toBe(200);
		expect(overwritten.body).toMatchObject({ action: "overwritten" });
		assertNoSecrets(overwritten.body);
		expect(stores.grok.current?.access).toBe(GROK_ACCESS);
		expect(stores.grok.commitInsideLock).toBe(true);
	});

	it("rejects a destination that changed between preview and commit", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		const { handlers, stores } = registerRoutes(home);
		await writeOwnerOnly(
			stores.grok.filename,
			stored({ type: "oauth", access: "old", refresh: "old-r", expires: 10, accountId: "other" }),
		);
		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		expect(previewed.status).toBe(200);
		expect(previewed.body).toMatchObject({ conflict: "different_account", confirmOverwriteRequired: true });

		await writeOwnerOnly(
			stores.grok.filename,
			stored({ type: "oauth", access: "newer", refresh: "newer-r", expires: 11, accountId: "other" }),
		);
		const committed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request(
				"POST",
				JSON.stringify({
					kind: "grok",
					previewId: (previewed.body as { previewId: string }).previewId,
					confirmOverwrite: true,
				}),
			),
		);
		expect(committed.status).toBe(409);
		expect(committed.body).toMatchObject({ code: "destination_changed" });
		assertNoSecrets(committed.body, ["newer", "newer-r"]);
		expect(stores.grok.current).toBeUndefined();
	});
});

describe("oauth import ticket lifetime", () => {
	it("maps a reused ticket to 404 and an expired ticket to 410", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		let now = 1_700_000_000_000;
		const { handlers, stores } = registerRoutes(home, { now: () => now });

		const first = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		const firstId = (first.body as { previewId: string }).previewId;
		const used = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: firstId })),
		);
		expect(used.status).toBe(200);
		expect(stores.grok.modifyCount).toBe(1);
		const reused = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: firstId })),
		);
		expect(reused.status).toBe(404);
		expect(reused.body).toMatchObject({ code: "preview_invalid" });
		expect(stores.grok.modifyCount).toBe(1);
		assertNoSecrets(reused.body);

		const second = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		now += OAUTH_IMPORT_PREVIEW_TTL_MS + 1;
		const expired = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: (second.body as { previewId: string }).previewId })),
		);
		expect(expired.status).toBe(410);
		expect(expired.body).toMatchObject({ code: "preview_expired" });
		expect(stores.grok.modifyCount).toBe(1);
		assertNoSecrets(expired.body);
	});

	it("rejects a kind mismatch without consuming the ticket or locking destination", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		const { handlers, stores } = registerRoutes(home);
		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		const previewId = (previewed.body as { previewId: string }).previewId;
		const mismatched = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "claude", previewId })),
		);
		expect(mismatched.status).toBe(400);
		expect(mismatched.body).toMatchObject({ code: "unsupported" });
		expect(stores.grok.modifyCount).toBe(0);
		expect(stores.claude.modifyCount).toBe(0);
		assertNoSecrets(mismatched.body);

		const committed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId })),
		);
		expect(committed.status).toBe(200);
		expect(committed.body).toMatchObject({ action: "imported" });
		expect(stores.grok.modifyCount).toBe(1);
		expect(stores.claude.modifyCount).toBe(0);
	});

	it("evicts the oldest ticket at the session cap without leaving a commitable leftover", async () => {
		const home = await tempHome();
		await writeGrokSource(home);
		const { handlers, stores } = registerRoutes(home);
		const previewIds: string[] = [];
		for (let index = 0; index <= OAUTH_IMPORT_MAX_PREVIEW_TICKETS; index += 1) {
			const previewed = await invoke(
				requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
				request("POST", JSON.stringify({ kind: "grok" })),
			);
			expect(previewed.status).toBe(200);
			previewIds.push((previewed.body as { previewId: string }).previewId);
		}
		const oldest = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: previewIds[0] })),
		);
		expect(oldest.status).toBe(404);
		expect(oldest.body).toMatchObject({ code: "preview_invalid" });
		expect(stores.grok.modifyCount).toBe(0);

		const newestId = previewIds.at(-1);
		if (newestId === undefined) throw new Error("newest preview missing");
		const newest = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request("POST", JSON.stringify({ kind: "grok", previewId: newestId })),
		);
		expect(newest.status).toBe(200);
		expect(newest.body).toMatchObject({ action: "imported" });
		expect(stores.grok.modifyCount).toBe(1);
	});

	it("cancels a preview ticket without writing the source or destination", async () => {
		const home = await tempHome();
		const sourcePath = await writeGrokSource(home);
		const original = await readFile(sourcePath);
		const { handlers, stores } = registerRoutes(home);
		const previewed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_PREVIEW_PATH),
			request("POST", JSON.stringify({ kind: "grok" })),
		);
		const cancelled = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_CANCEL_PATH),
			request("POST", JSON.stringify({ previewId: (previewed.body as { previewId: string }).previewId })),
		);
		expect(cancelled.status).toBe(200);
		expect(cancelled.body).toEqual({ ok: true, cancelled: true });
		expect(stores.grok.modifyCount).toBe(0);
		const committed = await invoke(
			requireHandler(handlers, OAUTH_IMPORT_COMMIT_PATH),
			request(
				"POST",
				JSON.stringify({
					kind: "grok",
					previewId: (previewed.body as { previewId: string }).previewId,
				}),
			),
		);
		expect(committed.status).toBe(404);
		expect(committed.body).toMatchObject({ code: "preview_invalid" });
		expect(stores.grok.modifyCount).toBe(0);
		expect(stores.grok.current).toBeUndefined();
		expect(await readFile(sourcePath)).toEqual(original);
	});
});

function dummyImportDestinations(): OAuthImportDestinations {
	const store: OAuthImportDestinationStore = {
		filename: "unused.json",
		modify: async () => undefined,
	};
	return {
		grok: { providerId: XAI_PI_PROVIDER, store },
		codex: { providerId: CODEX_PI_PROVIDER, store },
		kimi: { providerId: KIMI_PI_PROVIDER, store },
		claude: { providerId: CLAUDE_PI_PROVIDER, store },
	};
}

function createImportWebServer(failOnPath?: string): {
	handlers: Map<string, RegisteredRoute["handler"]>;
	webServer: OAuthImportRouteContext["webServer"];
} {
	const handlers = new Map<string, RegisteredRoute["handler"]>();
	return {
		handlers,
		webServer: {
			register(route) {
				if (failOnPath !== undefined && route.path === failOnPath) {
					throw new Error(`webserver: duplicate exact route "${route.path}"`);
				}
				handlers.set(route.path, route.handler);
				return () => {
					handlers.delete(route.path);
				};
			},
		},
	};
}

describe("oauth import route registrar atomic setup", () => {
	it("rolls back earlier import routes when a later register throws", () => {
		const { handlers, webServer } = createImportWebServer(OAUTH_IMPORT_PREVIEW_PATH);
		expect(() =>
			registerOAuthImportRoutes(
				{
					webServer,
					effect(setup) {
						setup();
					},
				},
				dummyImportDestinations(),
			),
		).toThrow(`webserver: duplicate exact route "${OAUTH_IMPORT_PREVIEW_PATH}"`);
		expect(handlers.size).toBe(0);
		expect(handlers.has(OAUTH_IMPORT_SOURCES_PATH)).toBe(false);
	});

	it("returns a disposer that clears routes when ctx.effect is absent", () => {
		const { handlers, webServer } = createImportWebServer();
		const dispose = registerOAuthImportRoutes({ webServer }, dummyImportDestinations());
		expect(handlers.has(OAUTH_IMPORT_SOURCES_PATH)).toBe(true);
		expect(handlers.has(OAUTH_IMPORT_PREVIEW_PATH)).toBe(true);
		expect(handlers.has(OAUTH_IMPORT_COMMIT_PATH)).toBe(true);
		expect(handlers.has(OAUTH_IMPORT_CANCEL_PATH)).toBe(true);
		dispose();
		dispose();
		expect(handlers.size).toBe(0);
	});

	it("rolls back without an effect when a later register throws", () => {
		const { handlers, webServer } = createImportWebServer(OAUTH_IMPORT_COMMIT_PATH);
		expect(() => registerOAuthImportRoutes({ webServer }, dummyImportDestinations())).toThrow(
			`webserver: duplicate exact route "${OAUTH_IMPORT_COMMIT_PATH}"`,
		);
		expect(handlers.size).toBe(0);
	});
});

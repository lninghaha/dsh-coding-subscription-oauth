/** Same-origin Web settings routes for Grok Build OAuth. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-llm";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { grokBuildAuthStatus, importGrokBuildSession, loginGrokBuildSession } from "./auth.ts";
import type { CatalogSource } from "./catalog.ts";
import { probeGrokAuth } from "./grok-import.ts";
import { readJsonRequest, requestErrorStatus } from "./http-json.ts";
import { ANTIGRAVITY_ROUTE, type CodingOAuthProviderSlug, XAI_PI_PROVIDER } from "./ids.ts";
import { loginGrokBuildPkce } from "./oauth.ts";
import type { SubscriptionLoginMethod } from "./oauth-providers.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import { safeMessage } from "./redact.ts";
import type { GrokBuildSession } from "./session.ts";

export const GROK_BUILD_AUTH_STATUS_PATH = "/plugins/dsh-grok-build/auth/status";
export const GROK_BUILD_AUTH_LOGIN_PATH = "/plugins/dsh-grok-build/auth/login";
export const GROK_BUILD_AUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/auth/login/code";
export const GROK_BUILD_AUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/auth/login/cancel";
export const GROK_BUILD_AUTH_IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
export const GROK_BUILD_AUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/auth/logout";
export const GROK_BUILD_AUTH_MODELS_PATH = "/plugins/dsh-grok-build/auth/models";

export const CODING_OAUTH_STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
export const CODING_OAUTH_LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
export const CODING_OAUTH_LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
export const CODING_OAUTH_LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
export const CODING_OAUTH_LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
export const CODING_OAUTH_MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";

export type GrokBuildLoginMethod = "pkce" | "device";

export type GrokBuildWebAuthStatus =
	| { status: "signed-out"; grokImportAvailable: boolean }
	| {
			status: "signing-in";
			method: GrokBuildLoginMethod;
			url?: string;
			userCode?: string;
			grokImportAvailable: boolean;
	  }
	| {
			status: "signed-in";
			models: string[];
			available: string[];
			selected: string[];
			catalogSource: CatalogSource;
			catalogError?: string;
			grokImportAvailable: boolean;
	  }
	| { status: "error"; message: string; grokImportAvailable: boolean };

export interface LoginChallenge {
	method: GrokBuildLoginMethod;
	url: string;
	userCode?: string;
}

function waitForPromptAbort(prompt: AuthPrompt): Promise<string> {
	const signal = prompt.signal;
	if (signal === undefined) return new Promise<string>(() => {});
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<string>((_resolve, reject) => {
		signal.addEventListener(
			"abort",
			() => {
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

async function grokImportAvailable(): Promise<boolean> {
	return (await probeGrokAuth()).available;
}

/**
 * One lifecycle owner for the pending login (PKCE or device), the published
 * challenge, the pasted-code channel, and the public status.
 */
export class GrokBuildWebAuth {
	private state: GrokBuildWebAuthStatus = { status: "signed-out", grokImportAvailable: false };
	private operation: Promise<void> | undefined;
	private cancellation: AbortController | undefined;
	private method: GrokBuildLoginMethod = "pkce";
	private challenge: LoginChallenge | undefined;
	private challengeWaiters: Array<{ resolve(value: LoginChallenge): void; reject(error: unknown): void }> = [];
	private codeResolver: ((code: string) => void) | undefined;

	constructor(private readonly session: GrokBuildSession) {}

	async status(): Promise<GrokBuildWebAuthStatus> {
		if (this.operation !== undefined) return this.state;
		if (this.state.status === "error") {
			return { ...this.state, grokImportAvailable: await grokImportAvailable() };
		}
		return this.readStoredStatus();
	}

	/** Start (or join) a login. A different method aborts and restarts the flow. */
	async signIn(method: GrokBuildLoginMethod): Promise<LoginChallenge> {
		if (this.operation !== undefined && this.method !== method) {
			await this.cancel();
		}
		if (this.operation === undefined) this.start(method);
		if (this.challenge !== undefined) return this.challenge;
		return new Promise<LoginChallenge>((resolve, reject) => {
			this.challengeWaiters.push({ resolve, reject });
		});
	}

	/** Hand a pasted authorization code (or redirect URL) to a pending PKCE login. */
	async submitCode(code: string): Promise<void> {
		const resolver = this.codeResolver;
		if (resolver === undefined) {
			throw new Error("grok-build: no authorization-code login is waiting for a code");
		}
		this.codeResolver = undefined;
		resolver(code);
	}

	/** Abort a pending login without touching any stored credential. */
	async cancel(): Promise<void> {
		this.cancellation?.abort(new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		this.challenge = undefined;
		this.state = await this.readStoredStatus();
	}

	async importGrok(): Promise<void> {
		this.cancellation?.abort(new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		await importGrokBuildSession(this.session);
		this.challenge = undefined;
		this.state = await this.readStoredStatus();
	}

	async setModels(ids: readonly string[]): Promise<void> {
		await this.session.setSelectedModels(ids);
		this.state = await this.readStoredStatus();
	}

	async signOut(): Promise<void> {
		this.cancellation?.abort(new Error("grok-build: sign-in cancelled"));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		await this.session.logout();
		this.state = { status: "signed-out", grokImportAvailable: await grokImportAvailable() };
		this.challenge = undefined;
	}

	async dispose(): Promise<void> {
		this.cancellation?.abort(new Error("grok-build: plugin disposed"));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
	}

	private start(method: GrokBuildLoginMethod): void {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.method = method;
		this.challenge = undefined;
		this.state = { status: "signing-in", method, grokImportAvailable: false };
		const run = method === "pkce" ? this.runPkce(cancellation) : this.runDevice(cancellation);
		this.operation = run
			.then(
				async () => {
					this.state = await this.readStoredStatus();
				},
				(error: unknown) => {
					this.rejectChallenge(error);
					this.state = { status: "error", message: safeMessage(error), grokImportAvailable: false };
				},
			)
			.finally(() => {
				this.operation = undefined;
				this.cancellation = undefined;
				this.codeResolver = undefined;
			});
	}

	private async runPkce(cancellation: AbortController): Promise<void> {
		const credential = await loginGrokBuildPkce({
			signal: cancellation.signal,
			onAuthorizeUrl: (url) => this.acceptChallenge({ method: "pkce", url }),
			awaitCode: (signal) =>
				new Promise<string>((resolve, reject) => {
					this.codeResolver = resolve;
					const onAbort = (): void => {
						this.codeResolver = undefined;
						reject(new Error("grok-build: sign-in cancelled"));
					};
					if (signal.aborted) {
						onAbort();
						return;
					}
					signal.addEventListener("abort", onAbort, { once: true });
				}),
		});
		const written = await this.session.store.modify(XAI_PI_PROVIDER, async () => credential);
		if (written === undefined || written.type !== "oauth") {
			throw new Error("grok-build: failed to persist the login credential");
		}
		await this.session.refreshLiveCatalog();
	}

	private async runDevice(cancellation: AbortController): Promise<void> {
		await loginGrokBuildSession(
			{
				signal: cancellation.signal,
				prompt: (prompt) =>
					prompt.type === "select"
						? Promise.resolve(
								prompt.options.some((option) => option.id === "oauth") ? "oauth" : (prompt.options[0]?.id ?? "oauth"),
							)
						: waitForPromptAbort(prompt),
				notify: (event) => {
					this.onEvent(event);
				},
			},
			this.session,
		);
	}

	private onEvent(event: AuthEvent): void {
		if (event.type === "device_code") {
			this.acceptChallenge({
				method: "device",
				url: event.verificationUri,
				...(event.userCode.length > 0 ? { userCode: event.userCode } : {}),
			});
			return;
		}
		if (event.type === "auth_url") {
			this.acceptChallenge({ method: this.method, url: event.url });
		}
	}

	private acceptChallenge(challenge: LoginChallenge): void {
		try {
			const url = new URL(challenge.url);
			if (url.protocol !== "https:") {
				const error = new Error("xAI returned an unsafe authorization URL");
				this.cancellation?.abort(error);
				this.rejectChallenge(error);
				return;
			}
		} catch {
			const error = new Error("xAI returned an invalid authorization URL");
			this.cancellation?.abort(error);
			this.rejectChallenge(error);
			return;
		}
		this.challenge = challenge;
		this.state = {
			status: "signing-in",
			method: challenge.method,
			url: challenge.url,
			grokImportAvailable: false,
			...(challenge.userCode === undefined ? {} : { userCode: challenge.userCode }),
		};
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}

	private async readStoredStatus(): Promise<GrokBuildWebAuthStatus> {
		const [stored, grok] = await Promise.all([grokBuildAuthStatus(this.session.store), grokImportAvailable()]);
		if (!stored.authenticated) return { status: "signed-out", grokImportAvailable: grok };
		const available = this.session.availableModels().map((model) => model.id);
		const selected = this.session.selectedModelIds();
		return {
			status: "signed-in",
			models: this.session.visibleModels().map((model) => model.id),
			available,
			selected: selected ?? available,
			catalogSource: this.session.catalogSource,
			grokImportAvailable: grok,
			...(this.session.catalogError === undefined ? {} : { catalogError: this.session.catalogError }),
		};
	}

	private rejectChallenge(error: unknown): void {
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
}

export type SubscriptionWebAuthStatus = {
	provider: Exclude<CodingOAuthProviderSlug, "grok">;
	route: string;
	displayName: string;
	loginMethods: readonly SubscriptionLoginMethod[];
	recommendedLoginMethod: SubscriptionLoginMethod;
	models: string[];
	available: string[];
	selected: string[];
} & (
	| { status: "signed-out" }
	| { status: "signing-in"; method: SubscriptionLoginMethod; url?: string; userCode?: string }
	| { status: "signed-in"; expiresAt?: number }
	| { status: "error"; message: string }
);

export interface SubscriptionLoginChallenge {
	method: SubscriptionLoginMethod;
	url: string;
	userCode?: string;
}

function optionForLoginMethod(
	prompt: Extract<AuthPrompt, { type: "select" }>,
	method: SubscriptionLoginMethod,
): string {
	const exactIds =
		method === "device" ? ["device_code", "device-code", "device"] : ["browser", "browser_login", "browser-login"];
	for (const id of exactIds) {
		if (prompt.options.some((option) => option.id === id)) return id;
	}
	const label = method === "device" ? /device|headless/iu : /browser|pkce/iu;
	return prompt.options.find((option) => label.test(option.label))?.id ?? prompt.options[0]?.id ?? "";
}

/** Web lifecycle for one pi-ai subscription OAuth provider. */
export class SubscriptionWebAuth {
	private state: SubscriptionWebAuthStatus | undefined;
	private operation: Promise<void> | undefined;
	private cancellation: AbortController | undefined;
	private method: SubscriptionLoginMethod;
	private challenge: SubscriptionLoginChallenge | undefined;
	private challengeWaiters: Array<{ resolve(value: SubscriptionLoginChallenge): void; reject(error: unknown): void }> =
		[];
	private codeResolver: ((code: string) => void) | undefined;

	constructor(
		readonly session: OAuthProviderSession,
		private readonly challengeTimeoutMs = 60_000,
	) {
		this.method = session.definition.recommendedLoginMethod;
	}

	async status(): Promise<SubscriptionWebAuthStatus> {
		if (this.operation !== undefined && this.state !== undefined) return this.state;
		return this.readStoredStatus();
	}

	async signIn(method: SubscriptionLoginMethod): Promise<SubscriptionLoginChallenge> {
		if (!this.session.definition.loginMethods.includes(method)) {
			throw new Error(`${this.session.definition.route}: login method "${method}" is not supported`);
		}
		if (this.operation !== undefined && this.method !== method) await this.cancel();
		if (this.operation === undefined) this.start(method);
		if (this.challenge !== undefined) return this.challenge;
		return new Promise<SubscriptionLoginChallenge>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter = {
				resolve: (challenge: SubscriptionLoginChallenge): void => {
					if (timer !== undefined) clearTimeout(timer);
					resolve(challenge);
				},
				reject: (error: unknown): void => {
					if (timer !== undefined) clearTimeout(timer);
					reject(error);
				},
			};
			this.challengeWaiters.push(waiter);
			timer = setTimeout(() => {
				const index = this.challengeWaiters.indexOf(waiter);
				if (index >= 0) this.challengeWaiters.splice(index, 1);
				const failure = new Error(`${this.session.definition.route}: timed out waiting for an OAuth challenge`);
				this.cancellation?.abort(failure);
				reject(failure);
			}, this.challengeTimeoutMs);
		});
	}

	async submitCode(code: string): Promise<void> {
		const resolver = this.codeResolver;
		if (resolver === undefined) {
			throw new Error(`${this.session.definition.route}: no authorization-code login is waiting for a code`);
		}
		this.codeResolver = undefined;
		resolver(code);
	}

	async cancel(): Promise<void> {
		this.cancellation?.abort(new Error(`${this.session.definition.route}: sign-in cancelled`));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		this.challenge = undefined;
		this.state = await this.readStoredStatus();
	}

	async setModels(ids: readonly string[]): Promise<void> {
		await this.session.setSelectedModels(ids);
		this.state = await this.readStoredStatus();
	}

	async signOut(): Promise<void> {
		this.cancellation?.abort(new Error(`${this.session.definition.route}: sign-in cancelled`));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		await this.session.logout();
		this.challenge = undefined;
		this.state = await this.readStoredStatus();
	}

	async dispose(): Promise<void> {
		this.cancellation?.abort(new Error(`${this.session.definition.route}: plugin disposed`));
		await this.operation?.catch(() => undefined);
		this.codeResolver = undefined;
		this.rejectChallenge(new Error(`${this.session.definition.route}: plugin disposed`));
	}

	private baseStatus(): Omit<
		SubscriptionWebAuthStatus,
		"status" | "method" | "url" | "userCode" | "message" | "expiresAt"
	> {
		const available = this.session.availableModels().map((model) => model.id);
		const selected = this.session.selectedModelIds() ?? available;
		return {
			provider: this.session.definition.slug,
			route: this.session.definition.route,
			displayName: this.session.definition.displayName,
			loginMethods: this.session.definition.loginMethods,
			recommendedLoginMethod: this.session.definition.recommendedLoginMethod,
			models: this.session.visibleModels().map((model) => model.id),
			available,
			selected,
		};
	}

	private async readStoredStatus(): Promise<SubscriptionWebAuthStatus> {
		const base = this.baseStatus();
		try {
			const stored = await this.session.status();
			return stored.authenticated
				? { ...base, status: "signed-in", ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }) }
				: { ...base, status: "signed-out" };
		} catch (error: unknown) {
			return { ...base, status: "error", message: safeMessage(error) };
		}
	}

	private start(method: SubscriptionLoginMethod): void {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.method = method;
		this.challenge = undefined;
		this.state = { ...this.baseStatus(), status: "signing-in", method };
		this.operation = this.run(cancellation)
			.then(
				async () => {
					if (this.challenge === undefined)
						this.rejectChallenge(new Error(`${this.session.definition.route}: login completed without a challenge`));
					this.state = await this.readStoredStatus();
				},
				(error: unknown) => {
					this.rejectChallenge(error);
					this.state = { ...this.baseStatus(), status: "error", message: safeMessage(error) };
				},
			)
			.finally(() => {
				this.operation = undefined;
				this.cancellation = undefined;
				this.codeResolver = undefined;
			});
	}

	private async run(cancellation: AbortController): Promise<void> {
		await this.session.login({
			signal: cancellation.signal,
			prompt: (prompt) => {
				if (prompt.type === "select") return Promise.resolve(optionForLoginMethod(prompt, this.method));
				if (prompt.type === "manual_code") return this.awaitCode(prompt, cancellation.signal);
				return Promise.reject(new Error(`${this.session.definition.route}: unsupported OAuth prompt ${prompt.type}`));
			},
			notify: (event) => {
				this.onEvent(event);
			},
		});
	}

	private awaitCode(prompt: AuthPrompt, cancellation: AbortSignal): Promise<string> {
		const signal = prompt.signal === undefined ? cancellation : AbortSignal.any([prompt.signal, cancellation]);
		return new Promise<string>((resolve, reject) => {
			const resolver = (code: string): void => {
				signal.removeEventListener("abort", onAbort);
				resolve(code);
			};
			const onAbort = (): void => {
				if (this.codeResolver === resolver) this.codeResolver = undefined;
				reject(signal.reason);
			};
			this.codeResolver = resolver;
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private onEvent(event: AuthEvent): void {
		if (event.type === "device_code") {
			this.acceptChallenge({
				method: "device",
				url: event.verificationUri,
				...(event.userCode.length > 0 ? { userCode: event.userCode } : {}),
			});
			return;
		}
		if (event.type === "auth_url") this.acceptChallenge({ method: this.method, url: event.url });
	}

	private acceptChallenge(challenge: SubscriptionLoginChallenge): void {
		try {
			const url = new URL(challenge.url);
			if (url.protocol !== "https:") throw new Error("authorization URL must use HTTPS");
		} catch (error) {
			const failure = new Error(`${this.session.definition.route}: invalid authorization URL`, { cause: error });
			this.cancellation?.abort(failure);
			this.rejectChallenge(failure);
			return;
		}
		this.challenge = challenge;
		this.state = {
			...this.baseStatus(),
			status: "signing-in",
			method: challenge.method,
			url: challenge.url,
			...(challenge.userCode === undefined ? {} : { userCode: challenge.userCode }),
		};
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}

	private rejectChallenge(error: unknown): void {
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
}

function trustedRequest(req: IncomingMessage): boolean {
	const remote = req.socket.remoteAddress;
	if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = req.headers.host;
	if (host === undefined) return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === new URL(`http://${host}`).host;
	} catch {
		return false;
	}
}

function json(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(value));
}

function readLoginMethod(body: unknown): GrokBuildLoginMethod {
	if (typeof body === "object" && body !== null && "method" in body && body.method === "device") return "device";
	return "pkce";
}

/** Register the plugin-owned OAuth routes when the Web server is composed. */
export function registerGrokBuildAuthRoutes(
	ctx: Context,
	session: GrokBuildSession,
	existingAuth?: GrokBuildWebAuth,
): void {
	const auth = existingAuth ?? new GrokBuildWebAuth(session);
	const ownsAuth = existingAuth === undefined;
	ctx.effect(() => {
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					json(res, 200, await auth.status());
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						json(res, 200, await auth.signIn(readLoginMethod(await readJsonRequest(req))));
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_CODE_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
						if (typeof code !== "string" || code.trim().length === 0) {
							return json(res, 400, { error: "code must be a non-empty string" });
						}
						await auth.submitCode(code);
						json(res, 200, { ok: true });
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 409), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					await auth.cancel();
					json(res, 200, await auth.status());
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_IMPORT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						await auth.importGrok();
						json(res, 200, await auth.status());
					} catch (error: unknown) {
						json(res, 500, { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_MODELS_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const selected =
							typeof body === "object" && body !== null && "selected" in body ? body.selected : undefined;
						if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")) {
							return json(res, 400, { error: "selected must be an array of model ids" });
						}
						await auth.setModels(selected);
						json(res, 200, await auth.status());
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: GROK_BUILD_AUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					await auth.signOut();
					json(res, 200, { ok: true });
				},
			}),
		];
		return async () => {
			for (const dispose of routes) dispose();
			if (ownsAuth) await auth.dispose();
		};
	}, "dsh-coding-subscription-oauth: Web OAuth routes");
}

export interface CodingOAuthWebStatus {
	providers: {
		grok: GrokBuildWebAuthStatus;
		codex: SubscriptionWebAuthStatus;
		kimi: SubscriptionWebAuthStatus;
		claude: SubscriptionWebAuthStatus;
	};
	antigravity: {
		installed: boolean;
		route: typeof ANTIGRAVITY_ROUTE;
		management: "cli";
	};
}

function recordBody(body: unknown): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new Error("request body must be an object");
	}
	return body as Record<string, unknown>;
}

function providerSlug(body: unknown): CodingOAuthProviderSlug {
	const provider = recordBody(body)["provider"];
	if (provider === "grok" || provider === "codex" || provider === "kimi" || provider === "claude") return provider;
	throw new Error("provider must be one of grok, codex, kimi, or claude");
}

/** Register the unified Coding OAuth API plus the compatibility Grok routes. */
export function registerCodingOAuthRoutes(
	ctx: Context,
	grokSession: GrokBuildSession,
	subscriptionSessions: readonly OAuthProviderSession[],
): void {
	const grok = new GrokBuildWebAuth(grokSession);
	const subscriptions = new Map(
		subscriptionSessions.map((session) => [session.definition.slug, new SubscriptionWebAuth(session)]),
	);
	const subscription = (slug: Exclude<CodingOAuthProviderSlug, "grok">): SubscriptionWebAuth => {
		const auth = subscriptions.get(slug);
		if (auth === undefined) throw new Error(`OAuth provider "${slug}" is not configured`);
		return auth;
	};

	registerGrokBuildAuthRoutes(ctx, grokSession, grok);

	const allStatus = async (): Promise<CodingOAuthWebStatus> => {
		const [grokStatus, codex, kimi, claude] = await Promise.all([
			grok.status().catch(
				async (error: unknown): Promise<GrokBuildWebAuthStatus> => ({
					status: "error",
					message: safeMessage(error),
					grokImportAvailable: await grokImportAvailable().catch(() => false),
				}),
			),
			subscription("codex").status(),
			subscription("kimi").status(),
			subscription("claude").status(),
		]);
		let antigravityInstalled = false;
		try {
			antigravityInstalled = ctx.llm.listProviders().some((provider) => provider.id === ANTIGRAVITY_ROUTE);
		} catch {
			// Account cards remain usable even when an unrelated adapter list fails.
		}
		return {
			providers: { grok: grokStatus, codex, kimi, claude },
			antigravity: {
				installed: antigravityInstalled,
				route: ANTIGRAVITY_ROUTE,
				management: "cli",
			},
		};
	};

	ctx.effect(() => {
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						json(res, 200, await allStatus());
					} catch (error: unknown) {
						json(res, 500, { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const slug = providerSlug(body);
						const value = recordBody(body);
						if (slug === "grok") {
							const method: GrokBuildLoginMethod = value["method"] === "device" ? "device" : "pkce";
							return json(res, 200, await grok.signIn(method));
						}
						const auth = subscription(slug);
						const requested = value["method"];
						const method: SubscriptionLoginMethod =
							requested === "browser" || requested === "device"
								? requested
								: auth.session.definition.recommendedLoginMethod;
						json(res, 200, await auth.signIn(method));
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_CODE_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const slug = providerSlug(body);
						const code = recordBody(body)["code"];
						if (typeof code !== "string" || code.trim().length === 0) {
							return json(res, 400, { error: "code must be a non-empty string" });
						}
						if (slug === "grok") await grok.submitCode(code);
						else await subscription(slug).submitCode(code);
						json(res, 200, { ok: true });
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 409), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGIN_CANCEL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const slug = providerSlug(body);
						if (slug === "grok") await grok.cancel();
						else await subscription(slug).cancel();
						json(res, 200, await allStatus());
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_MODELS_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const slug = providerSlug(body);
						const selected = recordBody(body)["selected"];
						if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")) {
							return json(res, 400, { error: "selected must be an array of model ids" });
						}
						if (slug === "grok") await grok.setModels(selected);
						else await subscription(slug).setModels(selected);
						json(res, 200, await allStatus());
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
			ctx.webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
					try {
						const body = await readJsonRequest(req);
						const slug = providerSlug(body);
						if (slug === "grok") await grok.signOut();
						else await subscription(slug).signOut();
						json(res, 200, await allStatus());
					} catch (error: unknown) {
						json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
					}
				},
			}),
		];
		return async () => {
			for (const dispose of routes) dispose();
			await Promise.all([grok.dispose(), ...[...subscriptions.values()].map((auth) => auth.dispose())]);
		};
	}, "dsh-coding-subscription-oauth: Coding OAuth routes");
}

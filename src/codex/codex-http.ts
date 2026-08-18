/**
 * Shared ChatGPT Codex backend HTTP client.
 *
 * Token and account identity are injected by the plugin-owned OAuth resolver.
 * The JWT `chatgpt_account_id` claim is used in full (never truncated).
 * Status policy: 401 invalidate+refresh once; 403 entitlement; 429 rate;
 * limited 5xx/transport retries. Only private chatgpt.com backend-api URLs.
 *
 * @module dsh-coding-subscription-oauth/codex-http
 */

import { LlmError } from "@deepseek-ai/dsh-llm";
import { safeMessage } from "../core/redact.ts";

/** First-party ChatGPT host for every Codex optional-capability request. */
export const CODEX_CHATGPT_ORIGIN = "https://chatgpt.com";

/** Path prefix that every Codex backend URL must stay under. */
export const CODEX_BACKEND_API_PREFIX = "/backend-api/";

const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const DEFAULT_MAX_SERVER_RETRIES = 2;
const DEFAULT_JSON_MAX_BYTES = 1_048_576;
export const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_ORIGINATOR = "dsh-coding-subscription-oauth";
const DEFAULT_USER_AGENT = "dsh-coding-subscription-oauth";
const FORBIDDEN_CALLER_HEADERS = new Set(["authorization", "chatgpt-account-id", "accept"]);

export type CodexHttpMethod = "GET" | "POST";

/** One resolved Codex access token plus the full ChatGPT account id. */
export interface CodexAccess {
	readonly accessToken: string;
	readonly accountId: string;
}

/**
 * Plugin-owned OAuth seam. Parent typically wraps `OAuthProviderSession`:
 * `resolve` calls `resolveAccessToken()` (which refreshes under the store lock);
 * `invalidate` calls `invalidateAccessToken()` after an upstream 401.
 */
export interface CodexAuthSession {
	resolve(): Promise<{ accessToken: string; accountId?: string } | undefined>;
	invalidate(): Promise<void>;
}

export interface CodexHttpRequest {
	readonly url: string;
	readonly method?: CodexHttpMethod;
	readonly body?: unknown;
	readonly headers?: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
	readonly maxBytes?: number;
	/** Skip the one-shot 401 invalidate/refresh (used by the retry itself). */
	readonly skipAuthRetry?: boolean;
}

/** Injected fetch. Tests must pass a mock; production defaults to global fetch. */
export type CodexFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CodexHttpClientOptions {
	readonly auth: CodexAuthSession;
	readonly fetchImpl?: CodexFetch;
	readonly originator?: string;
	readonly userAgent?: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	readonly maxServerRetries?: number;
	/** Per-attempt wall-clock ceiling, including response-body streaming. */
	readonly requestTimeoutMs?: number;
}

export interface CodexHttpClient {
	requestJson(request: CodexHttpRequest): Promise<unknown>;
	resolveAccess(): Promise<CodexAccess>;
}

/** Adapt an `OAuthProviderSession`-shaped object without importing that class. */
export function codexAuthFromSession(session: {
	resolveAccessToken(): Promise<string | undefined>;
	invalidateAccessToken(): Promise<void>;
}): CodexAuthSession {
	return {
		resolve: async () => {
			const accessToken = await session.resolveAccessToken();
			return accessToken === undefined || accessToken.length === 0 ? undefined : { accessToken };
		},
		invalidate: () => session.invalidateAccessToken(),
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Decode the full ChatGPT account id from a Codex access JWT. Never truncates. */
export function chatgptAccountIdFromAccessToken(accessToken: string): string | undefined {
	const parts = accessToken.split(".");
	if (parts.length !== 3 || parts[1] === undefined) return undefined;
	try {
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
		if (!isRecord(payload)) return undefined;
		const auth = payload[OPENAI_AUTH_CLAIM];
		if (!isRecord(auth)) return undefined;
		return optionalNonEmptyString(auth["chatgpt_account_id"]);
	} catch {
		return undefined;
	}
}

/** Reject anything that is not a first-party ChatGPT backend-api URL. */
export function assertCodexBackendUrl(url: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new LlmError("Codex backend URL is invalid", "INVALID_ARGS");
	}
	const port = parsed.port;
	if (
		parsed.protocol !== "https:" ||
		parsed.hostname !== "chatgpt.com" ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		(port !== "" && port !== "443")
	) {
		throw new LlmError("Codex optional capabilities may only call the private ChatGPT backend", "INVALID_ARGS");
	}
	if (!parsed.pathname.startsWith(CODEX_BACKEND_API_PREFIX)) {
		throw new LlmError("Codex optional capabilities may only call /backend-api paths", "INVALID_ARGS");
	}
	return parsed;
}

export function parseRetryAfterMs(value: string | null, now: () => number): number | undefined {
	if (value === null || value.length === 0) return undefined;
	if (/^\d+$/u.test(value)) {
		const seconds = Number(value);
		return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : undefined;
	}
	const at = Date.parse(value);
	if (!Number.isFinite(at)) return undefined;
	const delta = at - now();
	return delta > 0 ? delta : undefined;
}

/** Redact every provider error body through {@link safeMessage}. */
export function providerDetail(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length === 0 ? undefined : safeMessage(trimmed);
	}
	if (!isRecord(value)) return undefined;
	const error = value["error"];
	const raw =
		typeof error === "string"
			? error
			: isRecord(error) && typeof error["message"] === "string"
				? error["message"]
				: typeof value["message"] === "string"
					? value["message"]
					: undefined;
	return raw === undefined ? undefined : safeMessage(raw);
}

function callerHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
	if (headers === undefined) return {};
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (FORBIDDEN_CALLER_HEADERS.has(key.toLowerCase())) continue;
		next[key] = value;
	}
	return next;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted === true) return Promise.reject(abortError(signal));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(abortError(signal));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function abortError(signal?: AbortSignal): LlmError {
	return new LlmError("Codex backend request aborted", "TIMEOUT", {
		cause: signal?.reason,
	});
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted === true) throw abortError(signal);
}

async function resolveAccess(auth: CodexAuthSession): Promise<CodexAccess> {
	let resolved: { accessToken: string; accountId?: string } | undefined;
	try {
		resolved = await auth.resolve();
	} catch (error) {
		throw new LlmError(
			`Codex could not refresh its sign-in (${safeMessage(error)}). Open Settings → Coding OAuth and sign in again.`,
			"MISSING_CREDENTIAL",
		);
	}
	const accessToken = resolved?.accessToken.trim();
	if (accessToken === undefined || accessToken.length === 0) {
		throw new LlmError(
			"Codex is not signed in. Open Settings → Coding OAuth and sign in with your ChatGPT subscription.",
			"MISSING_CREDENTIAL",
		);
	}
	const accountId = chatgptAccountIdFromAccessToken(accessToken) ?? optionalNonEmptyString(resolved?.accountId);
	if (accountId === undefined) {
		throw new LlmError(
			"Codex access token has no usable chatgpt_account_id claim. Open Settings → Coding OAuth and sign in again.",
			"INVALID_CREDENTIAL",
		);
	}
	return { accessToken, accountId };
}

async function cancelBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Best-effort: the size cap already rejected the payload.
	}
}

/**
 * Stream the response with a running byte cap. Never buffers via `arrayBuffer()`.
 * A declared Content-Length above `maxBytes` fails closed before any read.
 */
async function readLimitedResponseBody(
	response: Response,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) {
		await cancelBody(response);
		throw new LlmError("Codex backend response exceeded the encoded size limit", "SERVER", {
			status: response.status,
		});
	}
	if (response.body === null) return new Uint8Array(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	const onAbort = (): void => {
		void reader.cancel(signal?.reason).catch(() => undefined);
	};
	if (signal?.aborted === true) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	try {
		for (;;) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			throwIfAborted(signal);
			if (done) break;
			if (value === undefined) continue;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new LlmError("Codex backend response exceeded the encoded size limit", "SERVER", {
					status: response.status,
				});
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof LlmError) throw error;
		throwIfAborted(signal);
		if (isAbortError(error)) throw abortError(signal);
		throw new LlmError(`Codex backend response could not be read (${safeMessage(error)})`, "TRANSPORT", {
			cause: error,
		});
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

async function readJsonBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
	throwIfAborted(signal);
	const bytes = await readLimitedResponseBody(response, maxBytes, signal);
	const text = new TextDecoder().decode(bytes).trim();
	if (text.length === 0) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new LlmError(
			`Codex backend returned an unprocessable JSON response (HTTP ${String(response.status)})`,
			"SERVER",
			{ cause: error, status: response.status },
		);
	}
}

function statusError(status: number, payload: unknown, retryAfterMs?: number): LlmError {
	const detail = providerDetail(payload);
	const suffix = detail === undefined ? "" : `: ${detail}`;
	if (status === 401) {
		return new LlmError(`Codex authorization was rejected (HTTP 401)${suffix}. Sign in again.`, "AUTH", { status });
	}
	if (status === 403) {
		return new LlmError(`Current ChatGPT subscription cannot use this Codex capability (HTTP 403)${suffix}`, "QUOTA", {
			status,
		});
	}
	if (status === 429) {
		return new LlmError(`Codex rate limit reached (HTTP 429)${suffix}`, "RATE_LIMIT", {
			status,
			...(retryAfterMs === undefined ? {} : { providerRetryAfterMs: retryAfterMs }),
		});
	}
	if (status >= 500) {
		return new LlmError(`Codex backend failed (HTTP ${String(status)})${suffix}`, "SERVER", { status });
	}
	if (status === 400 || status === 404 || status === 409 || status === 422) {
		return new LlmError(`Codex backend rejected the request (HTTP ${String(status)})${suffix}`, "INVALID_ARGS", {
			status,
		});
	}
	return new LlmError(`Codex backend request failed (HTTP ${String(status)})${suffix}`, "SERVER", { status });
}

/** Create a ChatGPT-backend-only client with injected OAuth resolve/invalidate. */
export function createCodexHttpClient(options: CodexHttpClientOptions): CodexHttpClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const originator = options.originator ?? DEFAULT_ORIGINATOR;
	const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const maxServerRetries = options.maxServerRetries ?? DEFAULT_MAX_SERVER_RETRIES;
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_CODEX_REQUEST_TIMEOUT_MS;
	if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
		throw new TypeError("Codex requestTimeoutMs must be a positive safe integer");
	}

	const requestOnce = async (
		request: CodexHttpRequest,
		access: CodexAccess,
	): Promise<{ response: Response; payload: unknown }> => {
		const url = assertCodexBackendUrl(request.url);
		throwIfAborted(request.signal);
		const headers: Record<string, string> = {
			...callerHeaders(request.headers),
			authorization: `Bearer ${access.accessToken}`,
			"chatgpt-account-id": access.accountId,
			accept: "application/json",
			originator,
			"user-agent": userAgent,
		};
		const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
		const signal = request.signal === undefined ? timeoutSignal : AbortSignal.any([request.signal, timeoutSignal]);
		const init: RequestInit = {
			method: request.method ?? (request.body === undefined ? "GET" : "POST"),
			redirect: "error",
			headers,
			signal,
		};
		if (request.body !== undefined) {
			headers["content-type"] = headers["content-type"] ?? "application/json";
			init.body = JSON.stringify(request.body);
		}
		let response: Response;
		try {
			response = await fetchImpl(url.toString(), init);
		} catch (error) {
			throwIfAborted(request.signal);
			const name = error instanceof Error ? error.name : "";
			if (timeoutSignal.aborted || isAbortError(error) || name === "TimeoutError") {
				throw abortError(signal);
			}
			throw new LlmError(`Codex backend request failed (${safeMessage(error)})`, "TRANSPORT", { cause: error });
		}
		const payload = await readJsonBody(response, request.maxBytes ?? DEFAULT_JSON_MAX_BYTES, signal);
		return { response, payload };
	};

	const requestJson = async (request: CodexHttpRequest): Promise<unknown> => {
		let access = await resolveAccess(options.auth);
		let current: CodexHttpRequest = request;
		let serverAttempt = 0;
		for (;;) {
			let result: { response: Response; payload: unknown };
			try {
				result = await requestOnce(current, access);
			} catch (error) {
				if (error instanceof LlmError && error.code === "TRANSPORT" && serverAttempt < maxServerRetries) {
					serverAttempt += 1;
					await sleep(250 * serverAttempt, current.signal);
					continue;
				}
				throw error;
			}
			const { response, payload } = result;
			if (response.ok) return payload;
			if (response.status === 401 && current.skipAuthRetry !== true) {
				try {
					await options.auth.invalidate();
				} catch {
					// Still attempt one refresh so a failed backdate cannot skip re-login.
				}
				access = await resolveAccess(options.auth);
				current = { ...current, skipAuthRetry: true };
				continue;
			}
			if (response.status >= 500 && serverAttempt < maxServerRetries) {
				serverAttempt += 1;
				await sleep(250 * serverAttempt, current.signal);
				continue;
			}
			throw statusError(response.status, payload, parseRetryAfterMs(response.headers.get("retry-after"), now));
		}
	};

	return {
		requestJson,
		resolveAccess: () => resolveAccess(options.auth),
	};
}

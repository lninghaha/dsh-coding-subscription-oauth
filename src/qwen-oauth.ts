/**
 * Qwen Code subscription OAuth: RFC 8628 device authorization grant against
 * auth.qwen.ai, mirroring the official Qwen Code CLI (`QwenSubscriptionOAuthClient`).
 *
 * pi-ai ships no Qwen subscription flow, so it is implemented here. The device
 * grant is a public client (`qwen-code-cli`) with no PKCE and no client secret.
 * The access token authenticates OpenAI-compatible requests to
 * https://api.qwen.ai/compatible-mode/v1 as `Authorization: Bearer`.
 * @module dsh-coding-subscription-oauth/qwen-oauth
 */

import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { safeMessage } from "./redact.ts";

export const QWEN_OAUTH_CLIENT_ID = "qwen-code-cli";
export const QWEN_OAUTH_SCOPE = "model:invoke profile:read";
export const QWEN_OAUTH_DEFAULT_HOST = "https://auth.qwen.ai";
/** Web origin that hosts the approval page; the auth host's own verification URI lands on the chat home. */
export const QWEN_WEB_ORIGIN = "https://chat.qwen.ai";
export const QWEN_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** The official CLI refuses accounts below these plans. */
export const QWEN_ALLOWED_PLANS: readonly string[] = ["plus", "pro"];

const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 64 * 1024;
const SLOW_DOWN_STEP_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const REFRESH_MAX_RETRIES = 3;
const CANCEL_MESSAGE = "Qwen Code login cancelled";

/** Override for tests and private mirrors. Must be https (or http on loopback). */
export function qwenOAuthHost(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env["QWEN_CODE_OAUTH_HOST"]?.trim();
	if (raw === undefined || raw.length === 0) return QWEN_OAUTH_DEFAULT_HOST;
	const url = new URL(raw);
	const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
		throw new Error("QWEN_CODE_OAUTH_HOST must be https (http only on loopback)");
	}
	return url.origin;
}

/**
 * Approval page for a device code, built exactly as the official CLI does
 * (`getQwenSubscriptionAuthorizationUrl(userCode, "cli")`). The server-provided
 * `verification_uri_complete` is not used: it opens https://chat.qwen.ai/ without the code.
 */
export function qwenAuthorizationUrl(userCode: string): string {
	const url = new URL("/authorize", QWEN_WEB_ORIGIN);
	url.searchParams.set("user_code", userCode);
	url.searchParams.set("client", "cli");
	url.searchParams.set("entry", "qwen_code");
	url.searchParams.set("paywallScene", "cli");
	return url.href;
}

/** Failure carrying only a stable OAuth code and HTTP status, never a response body. */
class QwenHttpError extends Error {
	constructor(
		readonly code: string,
		readonly status: number | undefined,
		readonly retryAfterMs?: number,
	) {
		super(status === undefined ? code : `${code} (status ${status})`);
	}
}

function trustedHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

function retryAfterMs(value: string | null): number | undefined {
	if (value === null || value.length === 0) return undefined;
	const seconds = Number(value);
	const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
	return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

function wait(ms: number, signal: AbortSignal, message: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new Error(message));
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error(message));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function request(
	host: string,
	path: string,
	signal: AbortSignal,
	form?: Record<string, string>,
	accessToken?: string,
): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetch(`${host}/api/oauth/${path}`, {
			method: form === undefined ? "GET" : "POST",
			headers: {
				Accept: "application/json",
				...(form === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
				...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
			},
			...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }),
			signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]),
			redirect: "error",
		});
	} catch (error) {
		if (signal.aborted) throw error;
		const code = error instanceof Error && error.name === "TimeoutError" ? "request_timeout" : "network_error";
		throw new QwenHttpError(code, undefined);
	}
	let data: unknown;
	try {
		const text = await response.text();
		data = text.length > RESPONSE_MAX_BYTES ? undefined : JSON.parse(text);
	} catch {
		data = undefined;
	}
	const record =
		typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
	if (!response.ok) {
		const code = typeof record?.["error"] === "string" ? record["error"] : "invalid_response";
		throw new QwenHttpError(code, response.status, retryAfterMs(response.headers.get("Retry-After")));
	}
	if (record === undefined) throw new QwenHttpError("invalid_response", response.status);
	return record;
}

export interface QwenDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	intervalSeconds: number;
	expiresAt: number;
}

export async function startQwenDeviceAuthorization(
	host: string,
	signal: AbortSignal,
): Promise<QwenDeviceAuthorization> {
	const issuedAt = Date.now();
	const data = await request(host, "device/code", signal, {
		client_id: QWEN_OAUTH_CLIENT_ID,
		scope: QWEN_OAUTH_SCOPE,
	});
	const verificationUri = trustedHttpUrl(data["verification_uri"]);
	const complete = trustedHttpUrl(data["verification_uri_complete"]);
	const interval = data["interval"];
	const expires = data["expires_in"];
	if (
		typeof data["device_code"] !== "string" ||
		data["device_code"].length === 0 ||
		typeof data["user_code"] !== "string" ||
		data["user_code"].length === 0 ||
		verificationUri === undefined ||
		complete === undefined ||
		typeof interval !== "number" ||
		!Number.isFinite(interval) ||
		interval <= 0 ||
		typeof expires !== "number" ||
		!Number.isFinite(expires) ||
		expires <= 0
	) {
		throw new Error("Invalid Qwen Code device authorization response");
	}
	return {
		deviceCode: data["device_code"],
		userCode: data["user_code"],
		verificationUri,
		verificationUriComplete: complete,
		intervalSeconds: interval,
		expiresAt: issuedAt + expires * 1000,
	};
}

/** Token documents carry secrets: failures name only the operation, never the body. */
function parseTokens(data: Record<string, unknown>, operation: string): OAuthCredential {
	const access = data["access_token"];
	const refresh = data["refresh_token"];
	const expiresIn = data["expires_in"];
	if (
		typeof access !== "string" ||
		access.length === 0 ||
		typeof refresh !== "string" ||
		refresh.length === 0 ||
		data["token_type"] !== "Bearer" ||
		typeof expiresIn !== "number" ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		throw new Error(`Qwen Code token ${operation} response is missing required fields`);
	}
	return { type: "oauth", access, refresh, expires: Date.now() + expiresIn * 1000 };
}

async function pollForToken(
	host: string,
	device: QwenDeviceAuthorization,
	signal: AbortSignal,
): Promise<OAuthCredential> {
	let intervalMs = Math.max(MIN_INTERVAL_MS, Math.floor(device.intervalSeconds * 1000));
	let delayMs = intervalMs;
	const expired = (): Error => new Error("Qwen Code device authorization expired. Please restart login.");
	while (true) {
		const remaining = device.expiresAt - Date.now();
		if (remaining <= 0) throw expired();
		await wait(Math.min(delayMs, remaining), signal, CANCEL_MESSAGE);
		if (Date.now() >= device.expiresAt) throw expired();
		try {
			const data = await request(host, "token", signal, {
				grant_type: QWEN_DEVICE_GRANT,
				client_id: QWEN_OAUTH_CLIENT_ID,
				device_code: device.deviceCode,
			});
			return parseTokens(data, "poll");
		} catch (error) {
			if (signal.aborted) throw new Error(CANCEL_MESSAGE);
			if (!(error instanceof QwenHttpError)) throw error;
			if (error.status === 400 && error.code === "authorization_pending") {
				delayMs = intervalMs;
			} else if (error.status === 400 && error.code === "slow_down") {
				intervalMs += SLOW_DOWN_STEP_MS;
				delayMs = intervalMs;
			} else if (error.code === "expired_token") {
				throw expired();
			} else if (error.code === "access_denied") {
				throw new Error("Qwen Code login was denied.");
			} else if (
				error.status === 429 ||
				(error.status !== undefined && error.status >= 500) ||
				error.code === "network_error" ||
				error.code === "request_timeout"
			) {
				// Transient: back off like the official CLI, honouring Retry-After.
				delayMs = Math.max(intervalMs, delayMs * 2, error.retryAfterMs ?? 0);
			} else {
				throw new Error(`Qwen Code device token request failed: ${error.message}`);
			}
		}
	}
}

/** The official CLI only activates Plus/Pro memberships; reject others before storing a credential. */
async function assertSupportedPlan(host: string, accessToken: string, signal: AbortSignal): Promise<void> {
	const info = await request(host, "userinfo", signal, undefined, accessToken);
	const plan = typeof info["member_type"] === "string" ? info["member_type"].toLowerCase() : undefined;
	if (plan === undefined || !QWEN_ALLOWED_PLANS.includes(plan)) {
		throw new Error("An active Qwen Plus or Pro subscription is required.");
	}
}

async function revokeBestEffort(host: string, token: string, signal: AbortSignal): Promise<void> {
	try {
		await request(host, "revoke", signal, {
			client_id: QWEN_OAUTH_CLIENT_ID,
			token,
			token_type_hint: "refresh_token",
		});
	} catch {
		// The credential was never stored; a failed revoke leaves nothing to clean locally.
	}
}

async function refreshQwenToken(host: string, refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> {
	let last: Error | undefined;
	for (let attempt = 0; attempt <= REFRESH_MAX_RETRIES; attempt += 1) {
		if (attempt > 0) await wait(1_000 * 2 ** (attempt - 1), signal, "Qwen Code token refresh aborted");
		try {
			const data = await request(host, "token", signal, {
				grant_type: "refresh_token",
				client_id: QWEN_OAUTH_CLIENT_ID,
				refresh_token: refreshToken,
			});
			return parseTokens(data, "refresh");
		} catch (error) {
			if (signal.aborted) throw error;
			if (!(error instanceof QwenHttpError)) throw error;
			// Dead credential: Models clears it and prompts for a fresh login.
			if (error.status === 400 || error.status === 401 || error.status === 403) {
				throw new Error(`Qwen Code token refresh unauthorized (${error.message})`);
			}
			last = new Error(`Qwen Code token refresh failed: ${safeMessage(error)}`);
			const transient = error.status === undefined || error.status === 429 || error.status >= 500;
			if (!transient) break;
		}
	}
	throw last ?? new Error("Qwen Code token refresh failed");
}

export const qwenCodeOAuth: OAuthAuth = {
	name: "Qwen Code (subscription)",
	isSubscription: true,
	loginLabel: "Sign in with Qwen",
	async login(interaction) {
		const host = qwenOAuthHost();
		const device = await startQwenDeviceAuthorization(host, interaction.signal);
		interaction.notify({
			type: "device_code",
			userCode: device.userCode,
			verificationUri: qwenAuthorizationUrl(device.userCode),
			intervalSeconds: device.intervalSeconds,
			expiresInSeconds: Math.max(1, Math.floor((device.expiresAt - Date.now()) / 1000)),
		});
		const credential = await pollForToken(host, device, interaction.signal);
		try {
			await assertSupportedPlan(host, credential.access, interaction.signal);
		} catch (error) {
			await revokeBestEffort(host, credential.refresh, interaction.signal);
			throw error;
		}
		return credential;
	},
	refresh: (credential, signal) => refreshQwenToken(qwenOAuthHost(), credential.refresh, signal),
	async toAuth(credential) {
		return { headers: { Authorization: `Bearer ${credential.access}` } };
	},
};

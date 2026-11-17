/**
 * Qwen Code (chat.qwen.ai) OAuth: RFC 8628 device authorization grant with PKCE.
 *
 * pi-ai ships no Qwen subscription flow, so it is implemented here against the
 * public Qwen Code client. The access token authenticates OpenAI-compatible
 * requests to the portal API as `Authorization: Bearer`.
 * @module dsh-coding-subscription-oauth/qwen-oauth
 */

import { createHash, randomBytes } from "node:crypto";
import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { safeMessage } from "./redact.ts";

/** Public Qwen Code client id (no secret; PKCE protects the exchange). */
export const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
export const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
export const QWEN_OAUTH_DEFAULT_HOST = "https://chat.qwen.ai";
export const QWEN_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const DEFAULT_POLL_INTERVAL_SECONDS = 2;
const DEFAULT_DEVICE_TTL_SECONDS = 15 * 60;
const MIN_INTERVAL_MS = 1_000;
const SLOW_DOWN_STEP_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 64 * 1024;
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

export function generateQwenPkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
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

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
	try {
		const text = await response.text();
		if (text.length > RESPONSE_MAX_BYTES) return undefined;
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function requestSignal(signal: AbortSignal): AbortSignal {
	return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);
}

function formPost(url: string, fields: Record<string, string>, signal: AbortSignal): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams(fields).toString(),
		signal: requestSignal(signal),
	});
}

function sleep(ms: number, signal: AbortSignal, message: string): Promise<void> {
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

export interface QwenDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	intervalSeconds: number;
	expiresInSeconds: number;
}

export async function startQwenDeviceAuthorization(
	host: string,
	challenge: string,
	signal: AbortSignal,
): Promise<QwenDeviceAuthorization> {
	const response = await formPost(
		`${host}/api/v1/oauth2/device/code`,
		{
			client_id: QWEN_OAUTH_CLIENT_ID,
			scope: QWEN_OAUTH_SCOPE,
			code_challenge: challenge,
			code_challenge_method: "S256",
		},
		signal,
	);
	const json = await readJson(response);
	if (!response.ok || json === undefined) {
		throw new Error(`Qwen Code device authorization failed with status ${response.status}`);
	}
	const verificationUri = trustedHttpUrl(json["verification_uri"]);
	const complete = trustedHttpUrl(json["verification_uri_complete"]) ?? verificationUri;
	if (
		typeof json["device_code"] !== "string" ||
		typeof json["user_code"] !== "string" ||
		verificationUri === undefined ||
		complete === undefined
	) {
		throw new Error("Invalid Qwen Code device authorization response");
	}
	const interval = json["interval"];
	const expires = json["expires_in"];
	return {
		deviceCode: json["device_code"],
		userCode: json["user_code"],
		verificationUri,
		verificationUriComplete: complete,
		intervalSeconds:
			typeof interval === "number" && Number.isFinite(interval) && interval > 0
				? interval
				: DEFAULT_POLL_INTERVAL_SECONDS,
		expiresInSeconds:
			typeof expires === "number" && Number.isFinite(expires) && expires > 0 ? expires : DEFAULT_DEVICE_TTL_SECONDS,
	};
}

/** Token documents carry secrets: failures name only the operation, never the body. */
function parseTokens(
	json: Record<string, unknown> | undefined,
	operation: string,
	fallbackRefresh?: string,
): OAuthCredential {
	const access = json?.["access_token"];
	const refresh = json?.["refresh_token"] ?? fallbackRefresh;
	const expiresIn = json?.["expires_in"];
	if (
		typeof access !== "string" ||
		access.length === 0 ||
		typeof refresh !== "string" ||
		refresh.length === 0 ||
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
	verifier: string,
	signal: AbortSignal,
): Promise<OAuthCredential> {
	const deadline = Date.now() + device.expiresInSeconds * 1000;
	let intervalMs = Math.max(MIN_INTERVAL_MS, Math.floor(device.intervalSeconds * 1000));
	let slowedDown = false;
	await sleep(Math.min(intervalMs, deadline - Date.now()), signal, CANCEL_MESSAGE);
	while (Date.now() < deadline) {
		if (signal.aborted) throw new Error(CANCEL_MESSAGE);
		const response = await formPost(
			`${host}/api/v1/oauth2/token`,
			{
				grant_type: QWEN_DEVICE_GRANT,
				client_id: QWEN_OAUTH_CLIENT_ID,
				device_code: device.deviceCode,
				code_verifier: verifier,
			},
			signal,
		);
		if (response.status >= 500) {
			throw new Error(`Qwen Code device token request failed with status ${response.status}`);
		}
		const json = await readJson(response);
		if (response.ok && typeof json?.["access_token"] === "string") return parseTokens(json, "poll");
		const error = json?.["error"];
		if (error === "slow_down") {
			slowedDown = true;
			intervalMs += SLOW_DOWN_STEP_MS;
		} else if (error === "expired_token") {
			throw new Error("Qwen Code device authorization expired. Please restart login.");
		} else if (error === "access_denied") {
			throw new Error("Qwen Code login was denied.");
		} else if (error !== "authorization_pending") {
			throw new Error(
				`Qwen Code device token request failed (status ${response.status})${typeof error === "string" ? `: ${error}` : ""}`,
			);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await sleep(Math.min(intervalMs, remaining), signal, CANCEL_MESSAGE);
	}
	throw new Error(
		slowedDown
			? "Qwen Code device flow timed out after slow_down responses; check the system clock and retry."
			: "Qwen Code device flow timed out",
	);
}

async function refreshQwenToken(host: string, refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> {
	let last: Error | undefined;
	for (let attempt = 0; attempt <= REFRESH_MAX_RETRIES; attempt += 1) {
		if (attempt > 0) await sleep(1_000 * 2 ** (attempt - 1), signal, "Qwen Code token refresh aborted");
		let response: Response;
		try {
			response = await formPost(
				`${host}/api/v1/oauth2/token`,
				{ grant_type: "refresh_token", refresh_token: refreshToken, client_id: QWEN_OAUTH_CLIENT_ID },
				signal,
			);
		} catch (error) {
			if (signal.aborted) throw error;
			last = new Error(`Qwen Code token refresh request failed: ${safeMessage(error)}`);
			continue;
		}
		const json = await readJson(response);
		if (response.ok) {
			// Qwen may rotate or omit the refresh token; keep the working one when it is omitted.
			return parseTokens(json, "refresh", refreshToken);
		}
		if (response.status === 400 || response.status === 401 || response.status === 403) {
			// Dead credential: Models clears it and prompts for a fresh login.
			throw new Error(`Qwen Code token refresh unauthorized (status ${response.status})`);
		}
		last = new Error(`Qwen Code token refresh failed with status ${response.status}`);
		if (response.status !== 429 && response.status < 500) break;
	}
	throw last ?? new Error("Qwen Code token refresh failed");
}

export const qwenCodeOAuth: OAuthAuth = {
	name: "Qwen Code (subscription)",
	isSubscription: true,
	loginLabel: "Sign in with Qwen",
	async login(interaction) {
		const host = qwenOAuthHost();
		const { verifier, challenge } = generateQwenPkce();
		const device = await startQwenDeviceAuthorization(host, challenge, interaction.signal);
		interaction.notify({
			type: "device_code",
			userCode: device.userCode,
			verificationUri: device.verificationUriComplete,
			intervalSeconds: device.intervalSeconds,
			expiresInSeconds: device.expiresInSeconds,
		});
		return pollForToken(host, device, verifier, interaction.signal);
	},
	refresh: (credential, signal) => refreshQwenToken(qwenOAuthHost(), credential.refresh, signal),
	async toAuth(credential) {
		return { headers: { Authorization: `Bearer ${credential.access}` } };
	},
};

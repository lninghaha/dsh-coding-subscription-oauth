/**
 * Secret-free subscription limit gauges for the provider behind the active chat model.
 *
 * Sources (all read with the provider's own OAuth token, never exposed to the browser):
 * - codex:  GET https://chatgpt.com/backend-api/wham/usage (existing opt-in reader)
 * - claude: GET https://api.anthropic.com/api/oauth/usage (5h / weekly utilization)
 * - kimi:   GET https://api.kimi.com/coding/v1/usages (weekly summary + windowed limits)
 * - qwen:   sg-entitlement.qwen.com agent/usage (the chat.qwen.ai usage page's own request,
 *           best effort: shape unverified, may reject the OAuth token) + plan from userinfo
 * - grok:   no limit endpoint is known; reported as "no-data"
 *
 * Failures never invent numbers: they yield status "error" with a stable code only.
 * @module dsh-coding-subscription-oauth/limits
 */

import type { CodexUsage } from "./codex-usage.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import { fetchQwenPlan } from "./qwen-oauth.ts";

export type LimitProvider = "codex" | "claude" | "kimi" | "qwen" | "grok";
export const LIMIT_PROVIDERS: readonly LimitProvider[] = ["codex", "claude", "kimi", "qwen", "grok"];

export interface LimitWindow {
	/** Stable id, e.g. `five_hour`, `seven_day`, `kimi-summary`. */
	readonly id: string;
	/** Provider-supplied display name when it has one (Kimi row name, Codex limit name). */
	readonly name?: string;
	readonly usedPercent: number;
	readonly windowSeconds?: number;
	/** Epoch seconds. */
	readonly resetsAt?: number;
}

export type ProviderLimitsStatus = "ok" | "no-data" | "signed-out" | "disabled" | "error";

export interface ProviderLimits {
	readonly provider: LimitProvider;
	readonly status: ProviderLimitsStatus;
	readonly windows: readonly LimitWindow[];
	readonly plan?: string;
	/** Stable machine code for `error` (never a response body). */
	readonly code?: string;
	readonly fetchedAt: number;
}

export type LimitFetch = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 8_000;
const RESPONSE_MAX_BYTES = 256 * 1024;
const SUCCESS_TTL_MS = 60_000;
const ERROR_TTL_MS = 20_000;
/** A forced refresh still never hits the vendor more often than this. */
const FORCE_MIN_AGE_MS = 15_000;
const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 86_400;

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages";
/** Request the chat.qwen.ai "usage & billing" page makes; the query mirrors its fixed params. */
export function qwenEntitlementUsageUrl(timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
	const query = new URLSearchParams({
		biz_id: "ai_qwen",
		chat_client: "h5",
		device: "pc",
		fr: "pc",
		pr: "qwen-i18n",
		la: "en-US",
		tz: timeZone,
		wv: "0.3.46",
	});
	return `https://sg-entitlement.qwen.com/api/entitlement/agent/usage?${query.toString()}`;
}
const QWEN_ENTITLEMENT_HEADERS = {
	Origin: "https://chat.qwen.ai",
	Referer: "https://chat.qwen.ai/settings/usage-billing",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function epochSecondsFromIso(value: unknown): number | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	// Trim nanoseconds to milliseconds so Date.parse accepts them.
	const normalized = value.replace(/(\.\d{3})\d+/u, "$1");
	const ms = Date.parse(normalized);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** Claude `/api/oauth/usage`: `{ five_hour: { utilization, resets_at }, seven_day: {...}, ... }`. */
export function parseClaudeUsage(body: unknown): LimitWindow[] {
	if (!isRecord(body)) throw new Error("malformed");
	const keys: readonly (readonly [string, number | undefined])[] = [
		["five_hour", FIVE_HOURS],
		["seven_day", SEVEN_DAYS],
		["seven_day_opus", SEVEN_DAYS],
		["seven_day_sonnet", SEVEN_DAYS],
	];
	const windows: LimitWindow[] = [];
	for (const [id, windowSeconds] of keys) {
		const entry = body[id];
		if (!isRecord(entry)) continue;
		const utilization = entry["utilization"];
		if (typeof utilization !== "number" || !Number.isFinite(utilization)) continue;
		const resetsAt = epochSecondsFromIso(entry["resets_at"]);
		windows.push({
			id,
			usedPercent: clampPercent(utilization),
			...(windowSeconds === undefined ? {} : { windowSeconds }),
			...(resetsAt === undefined ? {} : { resetsAt }),
		});
	}
	return windows;
}

function toInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && /^-?\d+$/u.test(value.trim())) return Number.parseInt(value, 10);
	return undefined;
}

function kimiWindowSeconds(window: unknown): number | undefined {
	if (!isRecord(window)) return undefined;
	const duration = toInt(window["duration"]);
	if (duration === undefined || duration <= 0) return undefined;
	const unit = String(window["timeUnit"] ?? "").toUpperCase();
	if (unit.includes("MINUTE")) return duration * 60;
	if (unit.includes("HOUR")) return duration * 3600;
	if (unit.includes("DAY")) return duration * 86_400;
	if (unit.includes("SECOND")) return duration;
	return undefined;
}

function kimiRow(id: string, data: unknown, windowSeconds?: number): LimitWindow | undefined {
	if (!isRecord(data)) return undefined;
	const limit = toInt(data["limit"]);
	let used = toInt(data["used"]);
	if (used === undefined) {
		const remaining = toInt(data["remaining"]);
		if (remaining !== undefined && limit !== undefined) used = limit - remaining;
	}
	if (limit === undefined || limit <= 0 || used === undefined) return undefined;
	let resetsAt: number | undefined;
	for (const key of ["reset_at", "resetAt", "reset_time", "resetTime"]) {
		resetsAt = epochSecondsFromIso(data[key]);
		if (resetsAt !== undefined) break;
	}
	if (resetsAt === undefined) {
		for (const key of ["reset_in", "resetIn", "ttl"]) {
			const seconds = toInt(data[key]);
			if (seconds !== undefined && seconds > 0) {
				resetsAt = Math.floor(Date.now() / 1000) + seconds;
				break;
			}
		}
	}
	const name = typeof data["name"] === "string" && data["name"].length > 0 ? data["name"] : undefined;
	return {
		id,
		...(name === undefined ? {} : { name }),
		usedPercent: clampPercent((used / limit) * 100),
		...(windowSeconds === undefined ? {} : { windowSeconds }),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

/** Kimi `/usages`: weekly `usage` summary plus `limits[]` with `{ window, detail }`. */
export function parseKimiUsage(body: unknown): LimitWindow[] {
	if (!isRecord(body)) throw new Error("malformed");
	const windows: LimitWindow[] = [];
	const summary = kimiRow("kimi-summary", body["usage"], SEVEN_DAYS);
	if (summary !== undefined) windows.push(summary);
	const limits = body["limits"];
	if (Array.isArray(limits)) {
		limits.forEach((item, index) => {
			if (!isRecord(item)) return;
			const detail = isRecord(item["detail"]) ? item["detail"] : item;
			const row = kimiRow(`kimi-limit-${String(index)}`, detail, kimiWindowSeconds(item["window"]));
			if (row !== undefined) windows.push(row);
		});
	}
	return windows;
}

const USED_KEYS = ["used", "usage", "usedAmount", "consumed", "usedQuota", "usedCredits"] as const;
const TOTAL_KEYS = ["total", "limit", "quota", "max", "totalQuota", "totalAmount", "allowance"] as const;
const REMAINING_KEYS = ["remaining", "left", "remain", "balance", "remainingQuota", "remainingAmount"] as const;
const NAME_KEYS = ["name", "title", "label", "type", "scene", "feature", "key"] as const;
const PERIOD_KEYS = ["period", "cycle", "window", "interval", "unit", "timeUnit"] as const;
const RESET_KEYS = [
	"resetTime",
	"nextResetTime",
	"resetAt",
	"reset_at",
	"refreshTime",
	"expireTime",
	"expiredAt",
	"endTime",
	"endDate",
] as const;
const QWEN_MAX_WINDOWS = 8;

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value.trim())) return Number(value);
	}
	return undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0 && value.length <= 64) return value;
	}
	return undefined;
}

function periodSeconds(text: string | undefined): number | undefined {
	if (text === undefined) return undefined;
	const value = text.toLowerCase();
	if (/(^|[^a-z])(5h|five_hour|hour5)/u.test(value)) return FIVE_HOURS;
	if (/week/u.test(value)) return SEVEN_DAYS;
	if (/day|daily/u.test(value)) return 86_400;
	if (/month/u.test(value)) return 30 * 86_400;
	return undefined;
}

function resetEpochSeconds(record: Record<string, unknown>): number | undefined {
	for (const key of RESET_KEYS) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return Math.floor(value > 1e11 ? value / 1000 : value);
		}
		const iso = epochSecondsFromIso(value);
		if (iso !== undefined) return iso;
	}
	return undefined;
}

/**
 * Qwen entitlement `agent/usage`. The `data` shape is not documented anywhere public, so this
 * is deliberately tolerant: it walks `data` and keeps objects that carry a usable total plus
 * either `used` or `remaining`. Returns [] (never garbage) when nothing matches.
 */
export function parseQwenEntitlement(body: unknown): LimitWindow[] {
	if (!isRecord(body)) throw new Error("malformed");
	if (body["success"] === false || (typeof body["httpCode"] === "number" && body["httpCode"] >= 400)) {
		const rawCode = typeof body["errorCode"] === "string" ? body["errorCode"] : "";
		throw new LimitsHttpError(
			/^[A-Z0-9_]{1,40}$/u.test(rawCode) ? rawCode : `http_${String(body["httpCode"] ?? "error")}`,
		);
	}
	const windows: LimitWindow[] = [];
	const visit = (value: unknown, path: string, depth: number): void => {
		if (windows.length >= QWEN_MAX_WINDOWS || depth > 4) return;
		if (Array.isArray(value)) {
			value.slice(0, 16).forEach((item, index) => {
				visit(item, `${path}.${String(index)}`, depth + 1);
			});
			return;
		}
		if (!isRecord(value)) return;
		const total = firstNumber(value, TOTAL_KEYS);
		const used = firstNumber(value, USED_KEYS);
		const remaining = firstNumber(value, REMAINING_KEYS);
		const spent = used ?? (remaining !== undefined && total !== undefined ? total - remaining : undefined);
		if (total !== undefined && total > 0 && spent !== undefined) {
			const name = firstString(value, NAME_KEYS);
			const windowSeconds = periodSeconds(firstString(value, PERIOD_KEYS) ?? name);
			const resetsAt = resetEpochSeconds(value);
			windows.push({
				id: `qwen-${String(windows.length)}`,
				...(name === undefined ? {} : { name }),
				usedPercent: clampPercent((spent / total) * 100),
				...(windowSeconds === undefined ? {} : { windowSeconds }),
				...(resetsAt === undefined ? {} : { resetsAt }),
			});
			return;
		}
		for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`, depth + 1);
	};
	visit(body["data"], "data", 0);
	return windows;
}

/** Project the existing Codex reader output onto the shared gauge shape. */
export function codexWindows(usage: CodexUsage): LimitWindow[] {
	return usage.rateLimits.flatMap((limit) =>
		limit.windows.map(
			(window, index): LimitWindow => ({
				id: `${limit.id}:${String(index)}`,
				...(limit.name === undefined || limit.id === "codex" ? {} : { name: limit.name }),
				usedPercent: clampPercent(window.usedPercent),
				windowSeconds: window.windowSeconds,
				...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
			}),
		),
	);
}

class LimitsHttpError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

async function getJson(
	fetchImpl: LimitFetch,
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: { Accept: "application/json", "User-Agent": "dsh-coding-subscription-oauth", ...headers },
			redirect: "error",
			signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]),
		});
	} catch (error) {
		throw new LimitsHttpError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network");
	}
	if (!response.ok) throw new LimitsHttpError(`http_${String(response.status)}`);
	const text = await response.text();
	if (text.length > RESPONSE_MAX_BYTES) throw new LimitsHttpError("too_large");
	try {
		return JSON.parse(text);
	} catch {
		throw new LimitsHttpError("malformed");
	}
}

export interface LimitsReaderOptions {
	readonly sessions: readonly OAuthProviderSession[];
	/** Existing Codex quota reader; absent or disabled → status `disabled`. */
	readonly codex?: { read(): Promise<CodexUsage>; enabled(): boolean };
	readonly fetchImpl?: LimitFetch;
	readonly now?: () => number;
}

export interface LimitsReader {
	read(provider: LimitProvider, options?: { force?: boolean; signal?: AbortSignal }): Promise<ProviderLimits>;
	clear(): void;
}

export function createLimitsReader(options: LimitsReaderOptions): LimitsReader {
	const now = options.now ?? Date.now;
	const fetchImpl: LimitFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const sessionFor = (provider: LimitProvider): OAuthProviderSession | undefined =>
		options.sessions.find((session) => session.definition.slug === provider);
	const cache = new Map<LimitProvider, ProviderLimits>();
	const inFlight = new Map<LimitProvider, Promise<ProviderLimits>>();
	let epoch = 0;

	const load = async (provider: LimitProvider, signal: AbortSignal): Promise<ProviderLimits> => {
		const fetchedAt = now();
		const done = (status: ProviderLimitsStatus, extra: Partial<ProviderLimits> = {}): ProviderLimits => ({
			provider,
			status,
			windows: [],
			fetchedAt,
			...extra,
		});
		if (provider === "grok") return done("no-data");
		if (provider === "codex") {
			if (options.codex === undefined || !options.codex.enabled()) return done("disabled");
			const session = sessionFor("codex");
			if (session !== undefined && !(await session.status()).authenticated) return done("signed-out");
			try {
				return done("ok", { windows: codexWindows(await options.codex.read()) });
			} catch {
				return done("error", { code: "codex_usage" });
			}
		}
		const session = sessionFor(provider);
		if (session === undefined || !(await session.status()).authenticated) return done("signed-out");
		const token = await session.resolveAccessToken().catch(() => undefined);
		if (token === undefined) return done("signed-out");
		const bearer = { Authorization: `Bearer ${token}` };
		try {
			if (provider === "claude") {
				const body = await getJson(
					fetchImpl,
					CLAUDE_USAGE_URL,
					{ ...bearer, "anthropic-beta": "oauth-2025-04-20" },
					signal,
				);
				return done("ok", { windows: parseClaudeUsage(body) });
			}
			if (provider === "kimi") {
				return done("ok", { windows: parseKimiUsage(await getJson(fetchImpl, KIMI_USAGES_URL, bearer, signal)) });
			}
			const plan = await fetchQwenPlan(token, signal).catch(() => undefined);
			const planExtra = plan === undefined ? {} : { plan };
			try {
				const body = await getJson(
					fetchImpl,
					qwenEntitlementUsageUrl(),
					{ ...bearer, ...QWEN_ENTITLEMENT_HEADERS },
					signal,
				);
				const windows = parseQwenEntitlement(body);
				return windows.length > 0 ? done("ok", { windows, ...planExtra }) : done("no-data", planExtra);
			} catch (error) {
				// The usage page's endpoint may reject an OAuth (non web-session) token: keep the plan
				// and report why, instead of a scary hard failure.
				const code = error instanceof LimitsHttpError ? error.code : "failed";
				return done("no-data", { ...planExtra, code });
			}
		} catch (error) {
			if (error instanceof LimitsHttpError && error.code === "http_401") {
				await session.invalidateAccessToken().catch(() => undefined);
			}
			const code = error instanceof LimitsHttpError ? error.code : "failed";
			return done("error", { code });
		}
	};

	return {
		read(provider, { force = false, signal } = {}) {
			const cached = cache.get(provider);
			if (cached !== undefined) {
				const age = now() - cached.fetchedAt;
				const ttl = cached.status === "error" ? ERROR_TTL_MS : SUCCESS_TTL_MS;
				if (age < (force ? FORCE_MIN_AGE_MS : ttl)) return Promise.resolve(cached);
			}
			const pending = inFlight.get(provider);
			if (pending !== undefined) return pending;
			const started = epoch;
			const run = load(provider, signal ?? new AbortController().signal)
				.then((value) => {
					if (started === epoch) cache.set(provider, value);
					return value;
				})
				.finally(() => {
					if (inFlight.get(provider) === run) inFlight.delete(provider);
				});
			inFlight.set(provider, run);
			return run;
		},
		clear() {
			epoch += 1;
			cache.clear();
			inFlight.clear();
		},
	};
}

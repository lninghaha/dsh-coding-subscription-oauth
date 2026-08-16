/**
 * Optional ChatGPT Codex quota reader (`GET /backend-api/wham/usage`).
 * Normalizes unknown/malformed optional fields instead of failing the card.
 *
 * Cache semantics:
 * - A successful `read()` stores the projection until `ttlMs` elapses.
 * - Concurrent non-force `read()` calls share one in-flight GET.
 * - `read({ force: true })` always issues a new GET and never joins an
 *   existing in-flight read (forced or not). A later completion of the
 *   abandoned in-flight GET cannot overwrite the forced result.
 * - `clear()` drops the stored projection and detaches any in-flight GET so
 *   its later completion cannot repopulate the cache.
 *
 * @module dsh-coding-subscription-oauth/codex-usage
 */

import { LlmError } from "@deepseek-ai/dsh-llm";
import {
	type CodexAuthSession,
	type CodexFetch,
	type CodexHttpClient,
	createCodexHttpClient,
	isRecord,
	optionalNonEmptyString,
} from "./codex-http.ts";

/** Official ChatGPT rate-limit usage endpoint used by the Codex client. */
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export interface CodexRateLimitWindow {
	readonly usedPercent: number;
	readonly remainingPercent: number;
	readonly windowSeconds: number;
	readonly resetsAt?: number;
}

export interface CodexRateLimit {
	readonly id: string;
	readonly name?: string;
	readonly windows: readonly CodexRateLimitWindow[];
}

export interface CodexCredits {
	readonly unlimited: boolean;
	readonly balance?: string;
}

export interface CodexIndividualLimit {
	readonly limit: string;
	readonly used: string;
	readonly remaining?: string;
	readonly remainingPercent: number;
	readonly resetsAt?: number;
}

export interface CodexUsage {
	readonly rateLimits: readonly CodexRateLimit[];
	readonly credits?: CodexCredits;
	readonly individualLimit?: CodexIndividualLimit;
	readonly spendControlReached?: boolean;
	readonly resetCredits?: { readonly availableCount: number };
	readonly fetchedAt: number;
}

export interface CodexUsageReaderOptions {
	readonly auth: CodexAuthSession;
	readonly http?: CodexHttpClient;
	readonly fetchImpl?: CodexFetch;
	readonly originator?: string;
	readonly userAgent?: string;
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	readonly now?: () => number;
	readonly ttlMs?: number;
}

export interface CodexUsageReader {
	read(options?: { force?: boolean; signal?: AbortSignal }): Promise<CodexUsage>;
	clear(): void;
}

const DEFAULT_TTL_MS = 60_000;

function finitePercent(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function epochSeconds(value: unknown): number | undefined {
	if (value === undefined || value === null || value === 0) return undefined;
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function decimalAmount(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= 64 && /^-?\d+(?:\.\d+)?$/u.test(value)
		? value
		: undefined;
}

function parseWindow(value: unknown): CodexRateLimitWindow | undefined {
	if (!isRecord(value)) return undefined;
	const usedPercent = finitePercent(value["used_percent"]);
	const windowSeconds = positiveInt(value["limit_window_seconds"]);
	if (usedPercent === undefined || windowSeconds === undefined) return undefined;
	const resetsAt = epochSeconds(value["reset_at"]);
	return {
		usedPercent,
		remainingPercent: 100 - usedPercent,
		windowSeconds,
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function parseLimit(id: string, name: string | undefined, value: unknown): CodexRateLimit | undefined {
	if (!isRecord(value)) return undefined;
	const windows = [parseWindow(value["primary_window"]), parseWindow(value["secondary_window"])].filter(
		(window): window is CodexRateLimitWindow => window !== undefined,
	);
	if (windows.length === 0) return undefined;
	return { id, ...(name === undefined ? {} : { name }), windows };
}

function parseCredits(value: unknown): CodexCredits | undefined {
	if (!isRecord(value) || value["has_credits"] !== true || typeof value["unlimited"] !== "boolean") return undefined;
	const balance = decimalAmount(value["balance"]);
	return {
		unlimited: value["unlimited"],
		...(balance === undefined ? {} : { balance }),
	};
}

function parseIndividualLimit(value: unknown): CodexIndividualLimit | undefined {
	if (!isRecord(value)) return undefined;
	const individual = value["individual_limit"];
	if (!isRecord(individual)) return undefined;
	const remainingPercent = finitePercent(individual["remaining_percent"]);
	const limit = decimalAmount(individual["limit"]);
	const used = decimalAmount(individual["used"]);
	if (remainingPercent === undefined || limit === undefined || used === undefined) return undefined;
	const remaining = decimalAmount(individual["remaining"]);
	const resetsAt = epochSeconds(individual["reset_at"]);
	return {
		limit,
		used,
		remainingPercent,
		...(remaining === undefined ? {} : { remaining }),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function copyUsage(usage: CodexUsage): CodexUsage {
	return { ...usage, rateLimits: [...usage.rateLimits] };
}

/**
 * Reduce an opaque `wham/usage` payload to a secret-free quota projection.
 * Unknown extra fields are ignored; malformed optional buckets are skipped.
 */
export function normalizeCodexUsage(value: unknown, fetchedAt = Date.now()): CodexUsage {
	if (!isRecord(value)) {
		throw new LlmError("Codex returned a malformed usage response", "SERVER");
	}
	const rateLimits: CodexRateLimit[] = [];
	const seen = new Set<string>();
	const add = (limit: CodexRateLimit | undefined): void => {
		if (limit === undefined || seen.has(limit.id)) return;
		seen.add(limit.id);
		rateLimits.push(limit);
	};
	add(parseLimit("codex", "Codex", value["rate_limit"]));
	const additional = value["additional_rate_limits"];
	if (Array.isArray(additional)) {
		for (const entry of additional) {
			if (!isRecord(entry)) continue;
			const id = optionalNonEmptyString(entry["metered_feature"]);
			if (id === undefined) continue;
			const name = optionalNonEmptyString(entry["limit_name"]);
			add(parseLimit(id, name, entry["rate_limit"]));
		}
	}
	add(parseLimit("code_review", "Code review", value["code_review_rate_limit"]));
	const credits = parseCredits(value["credits"]);
	const individualLimit = parseIndividualLimit(value["spend_control"]);
	const spendControlReached =
		isRecord(value["spend_control"]) && typeof value["spend_control"]["reached"] === "boolean"
			? value["spend_control"]["reached"]
			: undefined;
	const resetRaw = value["rate_limit_reset_credits"];
	const resetCount = isRecord(resetRaw) ? resetRaw["available_count"] : undefined;
	const resetCredits =
		typeof resetCount === "number" && Number.isSafeInteger(resetCount) && resetCount >= 0
			? { availableCount: resetCount }
			: undefined;
	return {
		rateLimits,
		fetchedAt,
		...(credits === undefined ? {} : { credits }),
		...(individualLimit === undefined ? {} : { individualLimit }),
		...(spendControlReached === undefined ? {} : { spendControlReached }),
		...(resetCredits === undefined ? {} : { resetCredits }),
	};
}

/**
 * Cached, injectable usage reader. Failures do not invent quota numbers.
 *
 * See the module doc for `force` / `clear` cache semantics.
 */
export function createCodexUsageReader(options: CodexUsageReaderOptions): CodexUsageReader {
	const http =
		options.http ??
		createCodexHttpClient({
			auth: options.auth,
			...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
			...(options.originator === undefined ? {} : { originator: options.originator }),
			...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
			...(options.sleep === undefined ? {} : { sleep: options.sleep }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	let cached: CodexUsage | undefined;
	let inFlight: Promise<CodexUsage> | undefined;
	let epoch = 0;

	const load = async (signal?: AbortSignal): Promise<CodexUsage> => {
		const payload = await http.requestJson({
			url: CODEX_USAGE_URL,
			method: "GET",
			headers: { "cache-control": "no-store" },
			...(signal === undefined ? {} : { signal }),
		});
		return normalizeCodexUsage(payload, now());
	};

	return {
		read({ force = false, signal } = {}) {
			if (!force && cached !== undefined && now() - cached.fetchedAt < ttlMs) {
				return Promise.resolve(copyUsage(cached));
			}
			if (!force && inFlight !== undefined) return inFlight;
			if (force) epoch += 1;
			const started = epoch;
			const current = load(signal)
				.then((value) => {
					if (started === epoch) cached = value;
					return value;
				})
				.finally(() => {
					if (inFlight === current) inFlight = undefined;
				});
			inFlight = current;
			return current;
		},
		clear() {
			epoch += 1;
			cached = undefined;
			inFlight = undefined;
		},
	};
}

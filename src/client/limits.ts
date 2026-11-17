/** Pure helpers for the composer-dock limit gauges. */

import type { LimitsProvider, LimitsWindowView, ProviderLimitsView } from "./types.ts";

const ROUTE_PROVIDER: { readonly [route: string]: LimitsProvider } = {
	"grok-build": "grok",
	"codex-oauth": "codex",
	"codex-oauth-fast": "codex",
	"kimi-code-oauth": "kimi",
	"qwen-code-oauth": "qwen",
	"claude-code-oauth": "claude",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Provider behind the session's most recent subscription route, read from the
 * `tokenUsage` projection (`routes: [{ provider, model }]`). Unknown/absent → undefined.
 */
export function activeLimitsProvider(tokenUsage: unknown): LimitsProvider | undefined {
	if (!isRecord(tokenUsage) || !Array.isArray(tokenUsage["routes"])) return undefined;
	for (let index = tokenUsage["routes"].length - 1; index >= 0; index -= 1) {
		const route: unknown = tokenUsage["routes"][index];
		if (!isRecord(route) || typeof route["provider"] !== "string") continue;
		const provider = ROUTE_PROVIDER[route["provider"]];
		if (provider !== undefined) return provider;
	}
	return undefined;
}

/** A change in this key means a turn consumed tokens, so limits are worth refreshing. */
export function usageFingerprint(tokenUsage: unknown): string {
	if (!isRecord(tokenUsage)) return "";
	const total = tokenUsage["totalTokens"] ?? tokenUsage["outputTokens"];
	return typeof total === "number" ? String(total) : "";
}

export function parseLimitsResponse(value: unknown): ProviderLimitsView | undefined {
	if (!isRecord(value) || !Array.isArray(value["providers"])) return undefined;
	const entry: unknown = value["providers"][0];
	if (!isRecord(entry) || typeof entry["provider"] !== "string" || typeof entry["status"] !== "string")
		return undefined;
	const windows: LimitsWindowView[] = [];
	if (Array.isArray(entry["windows"])) {
		for (const raw of entry["windows"] as unknown[]) {
			if (!isRecord(raw) || typeof raw["id"] !== "string" || typeof raw["usedPercent"] !== "number") continue;
			windows.push({
				id: raw["id"],
				usedPercent: Math.max(0, Math.min(100, raw["usedPercent"])),
				...(typeof raw["name"] === "string" ? { name: raw["name"] } : {}),
				...(typeof raw["windowSeconds"] === "number" ? { windowSeconds: raw["windowSeconds"] } : {}),
				...(typeof raw["resetsAt"] === "number" ? { resetsAt: raw["resetsAt"] } : {}),
			});
		}
	}
	return {
		provider: entry["provider"] as LimitsProvider,
		status: entry["status"] as ProviderLimitsView["status"],
		windows,
		...(typeof entry["plan"] === "string" ? { plan: entry["plan"] } : {}),
		fetchedAt: typeof entry["fetchedAt"] === "number" ? entry["fetchedAt"] : 0,
	};
}

/** `5h`, `3d`, `45m` for an unnamed window length. */
export function formatWindowSeconds(seconds: number): string {
	if (seconds % 86_400 === 0) return `${String(seconds / 86_400)}d`;
	if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
	if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
	return `${String(seconds)}s`;
}

/** Compact countdown (`2d 4h`, `3h 20m`, `12m`); undefined once the reset has passed. */
export function formatResetIn(resetsAtSeconds: number, nowMs = Date.now()): string | undefined {
	const total = Math.floor(resetsAtSeconds - nowMs / 1000);
	if (total <= 0) return undefined;
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	if (days > 0) return `${String(days)}d ${String(hours)}h`;
	if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
	return `${String(Math.max(1, minutes))}m`;
}

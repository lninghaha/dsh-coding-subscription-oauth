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
 * Provider behind the session's most recent assistant message, read from the conversation
 * nodes (`provenance` = completed request identity, else `requestConfig`). Returns a primitive
 * so selector hooks stay referentially stable. Unknown/non-subscription → undefined.
 */
export function lastSubscriptionProvider(nodes: unknown): LimitsProvider | undefined {
	if (!Array.isArray(nodes)) return undefined;
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node: unknown = nodes[index];
		if (!isRecord(node) || node["kind"] !== "assistant") continue;
		for (const key of ["provenance", "requestConfig"] as const) {
			const identity = node[key];
			if (!isRecord(identity) || typeof identity["provider"] !== "string") continue;
			// The latest assistant message decides, even when it is not a subscription route.
			return ROUTE_PROVIDER[identity["provider"]];
		}
	}
	return undefined;
}

/**
 * Provider of the session's most recent model request, from the trajectory seat's `requests`
 * (`prompt.config` is known when the request starts; `providerMetadata` once it completes).
 * Primitive result keeps selector hooks referentially stable.
 */
export function lastRequestProvider(requests: unknown): LimitsProvider | undefined {
	if (!Array.isArray(requests)) return undefined;
	for (let index = requests.length - 1; index >= 0; index -= 1) {
		const request: unknown = requests[index];
		if (!isRecord(request)) continue;
		const prompt = request["prompt"];
		const config = isRecord(prompt) ? prompt["config"] : undefined;
		for (const identity of [config, request["providerMetadata"]]) {
			if (isRecord(identity) && typeof identity["provider"] === "string") {
				return ROUTE_PROVIDER[identity["provider"]];
			}
		}
	}
	return undefined;
}

/** A change in this key means a turn consumed tokens, so limits are worth refreshing. */
export function usageFingerprint(tokenUsage: unknown): string {
	if (!isRecord(tokenUsage)) return "";
	if (typeof tokenUsage["totalTokens"] === "number") return String(tokenUsage["totalTokens"]);
	const parts = ["uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].map(
		(key) => tokenUsage[key],
	);
	const numbers = parts.filter((value): value is number => typeof value === "number");
	return numbers.length === 0 ? "" : String(numbers.reduce((sum, value) => sum + value, 0));
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
		...(typeof entry["code"] === "string" ? { code: entry["code"] } : {}),
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

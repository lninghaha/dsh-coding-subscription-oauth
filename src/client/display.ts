/** Pure display helpers for remote UX and CLI pull noise control. */

import type { GrokBuildSettingsInjected, LoginMethod, ProviderCardDefinition, SourceStatus } from "./types.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True when the Settings page is served from a non-loopback host (typical remote DSH). */
export function isLikelyRemoteHost(hostname: string): boolean {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.length === 0) return false;
	if (LOOPBACK_HOSTS.has(normalized)) return false;
	if (normalized.endsWith(".localhost")) return false;
	return true;
}

export function preferredLoginMethod(definition: ProviderCardDefinition, remote: boolean): LoginMethod {
	if (
		remote &&
		definition.remoteRecommended !== undefined &&
		definition.methods.includes(definition.remoteRecommended)
	) {
		return definition.remoteRecommended;
	}
	return definition.recommended;
}

/** Put the recommended method first so the primary CTA is unambiguous. */
export function orderedLoginMethods(definition: ProviderCardDefinition, remote: boolean): LoginMethod[] {
	const preferred = preferredLoginMethod(definition, remote);
	const rest = definition.methods.filter((method) => method !== preferred);
	return definition.methods.includes(preferred) ? [preferred, ...rest] : [...definition.methods];
}

/** Per-card CLI “missing” copy is noisy on remote hosts; keep only actionable reasons. */
export function shouldShowPerCardSourceReason(source: SourceStatus | undefined): boolean {
	if (source === undefined || source.available) return false;
	if (source.reason === undefined) return false;
	return source.reason !== "missing";
}

export function allOfficialCliMissing(sources: readonly SourceStatus[] | undefined): boolean {
	if (sources === undefined || sources.length === 0) return false;
	return sources.every((source) => !source.available && (source.reason === undefined || source.reason === "missing"));
}

export function anyOfficialCliAvailable(sources: readonly SourceStatus[] | undefined): boolean {
	return sources?.some((source) => source.available) === true;
}

export function methodLabel(
	method: LoginMethod,
	t: GrokBuildSettingsInjected["t"],
	options?: { remote?: boolean; primary?: boolean },
): string {
	if (method === "device") {
		if (options?.remote === true && options.primary === true) return t("deviceLoginRemote");
		return t("deviceLogin");
	}
	if (method === "browser") return t("browserLogin");
	return t("pkceLogin");
}

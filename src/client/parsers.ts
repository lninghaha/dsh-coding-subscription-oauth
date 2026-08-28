/** Response parsers and small formatting helpers for the settings UI. */

import { isRecord } from "./api.ts";
import {
	GATEWAY_PORT_MAX,
	GATEWAY_PORT_MIN,
	GATEWAY_RANDOM_PORT_MAX,
	GATEWAY_RANDOM_PORT_MIN,
	GATEWAY_RANDOM_RESERVED,
	HOUR_MS,
	IMAGINE_SOURCE_KEY,
	SOURCE_COMMIT_ACTIONS,
	SOURCE_CONFLICTS,
	SOURCE_DEFAULT_PATH,
	SOURCE_KINDS,
	SOURCE_PREVIEW_ACTIONS,
	SOURCE_REASONS,
} from "./constants.ts";
import type {
	CapabilitySettingsView,
	CapabilitySnapshot,
	GatewayView,
	GrokBuildSettingsInjected,
	ImagineCredentialView,
	ProviderStatus,
	SourceCommitAction,
	SourceConflict,
	SourceKind,
	SourcePreview,
	SourcePreviewAction,
	SourceReason,
	SourceStatus,
	UsageLimitView,
	UsageView,
	UsageWindowView,
} from "./types.ts";

export function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length < 500 ? value : undefined;
}

export function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function optionalPercent(value: unknown): number | undefined {
	const numeric = optionalFiniteNumber(value);
	return numeric !== undefined && numeric >= 0 && numeric <= 100 ? numeric : undefined;
}

export function isSourceKind(value: string): value is SourceKind {
	return (SOURCE_KINDS as readonly string[]).includes(value);
}

export function isSourceReason(value: string): value is SourceReason {
	return (SOURCE_REASONS as readonly string[]).includes(value);
}

export function isSourceConflict(value: string): value is SourceConflict {
	return (SOURCE_CONFLICTS as readonly string[]).includes(value);
}

export function isSourcePreviewAction(value: string): value is SourcePreviewAction {
	return (SOURCE_PREVIEW_ACTIONS as readonly string[]).includes(value);
}

export function isSourceCommitAction(value: string): value is SourceCommitAction {
	return (SOURCE_COMMIT_ACTIONS as readonly string[]).includes(value);
}

export function looksSecret(value: string): boolean {
	return /eyJ[A-Za-z0-9_-]+\.|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/u.test(value);
}

export function safeDisplayPath(value: unknown, kind: SourceKind): string {
	const text = optionalString(value);
	if (text === undefined || looksSecret(text) || text.length > 180) return SOURCE_DEFAULT_PATH[kind];
	return text;
}

export function safeWarning(value: unknown): string | undefined {
	const text = optionalString(value);
	if (text === undefined || looksSecret(text)) return undefined;
	return text;
}

export function formatEpoch(value: number | undefined): string | undefined {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
	const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : undefined;
	if (ms === undefined) return undefined;
	const formatted = new Date(ms).toLocaleString();
	return formatted.length > 0 ? formatted : undefined;
}

export function parseSource(value: unknown): SourceStatus | undefined {
	if (!isRecord(value) || typeof value["kind"] !== "string" || !isSourceKind(value["kind"])) return undefined;
	const kind = value["kind"];
	const reasonRaw = optionalString(value["reason"]);
	const expiresAt = optionalFiniteNumber(value["expiresAt"]);
	return {
		kind,
		displayPath: safeDisplayPath(value["displayPath"], kind),
		available: value["available"] === true,
		...(expiresAt === undefined ? {} : { expiresAt }),
		...(reasonRaw !== undefined && isSourceReason(reasonRaw) ? { reason: reasonRaw } : {}),
	};
}

export function mergeSources(discovered: readonly SourceStatus[]): SourceStatus[] {
	return SOURCE_KINDS.map((kind) => {
		const found = discovered.find((entry) => entry.kind === kind);
		return found ?? { kind, displayPath: SOURCE_DEFAULT_PATH[kind], available: false, reason: "missing" };
	});
}

export function parseSources(value: unknown): SourceStatus[] {
	const rows = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value["sources"])
			? value["sources"]
			: [];
	return mergeSources(rows.map(parseSource).filter((entry): entry is SourceStatus => entry !== undefined));
}

export function parsePreview(value: unknown): SourcePreview | undefined {
	if (!isRecord(value)) return undefined;
	const previewId = optionalString(value["previewId"]);
	const kindRaw = optionalString(value["kind"]);
	if (previewId === undefined || kindRaw === undefined || !isSourceKind(kindRaw)) return undefined;
	const conflictRaw = optionalString(value["conflict"]);
	const actionRaw = optionalString(value["action"]);
	const expiresAt = optionalFiniteNumber(value["expiresAt"]);
	const ticketExpiresAt = optionalFiniteNumber(value["ticketExpiresAt"]);
	const warnings = Array.isArray(value["warnings"])
		? value["warnings"].map(safeWarning).filter((entry): entry is string => entry !== undefined)
		: [];
	return {
		previewId,
		kind: kindRaw,
		displayPath: safeDisplayPath(value["displayPath"], kindRaw),
		confirmOverwriteRequired: value["confirmOverwriteRequired"] === true,
		warnings,
		...(expiresAt === undefined ? {} : { expiresAt }),
		...(ticketExpiresAt === undefined ? {} : { ticketExpiresAt }),
		...(conflictRaw !== undefined && isSourceConflict(conflictRaw) ? { conflict: conflictRaw } : {}),
		...(actionRaw !== undefined && isSourcePreviewAction(actionRaw) ? { action: actionRaw } : {}),
	};
}

export function parseCommitAction(value: unknown): SourceCommitAction | undefined {
	if (!isRecord(value)) return undefined;
	const action = optionalString(value["action"]);
	return action !== undefined && isSourceCommitAction(action) ? action : undefined;
}

export function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = optionalFiniteNumber(value);
	return numeric !== undefined && Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

export function emptyCapabilitySettings(): CapabilitySettingsView {
	return {
		codexSearch: false,
		codexImages: false,
		codexImageEdits: false,
		codexImagesAnyModel: false,
		codexUsage: false,
		codexFast: false,
		grokImagineImage: false,
		grokImagineVideo: false,
		searchResults: 5,
		imageCount: 1,
		videoArtifactTtlMs: 7 * 24 * HOUR_MS,
	};
}

export function parseCapabilitySettings(value: unknown): CapabilitySettingsView {
	const source = isRecord(value) ? value : {};
	return {
		codexSearch: source["codexSearch"] === true,
		codexImages: source["codexImages"] === true,
		codexImageEdits: source["codexImageEdits"] === true,
		codexImagesAnyModel: source["codexImagesAnyModel"] === true,
		codexUsage: source["codexUsage"] === true,
		codexFast: source["codexFast"] === true,
		grokImagineImage: source["grokImagineImage"] === true,
		grokImagineVideo: source["grokImagineVideo"] === true,
		searchResults: boundedInteger(source["searchResults"], 1, 20, 5),
		imageCount: boundedInteger(source["imageCount"], 1, 4, 1),
		videoArtifactTtlMs: boundedInteger(source["videoArtifactTtlMs"], HOUR_MS, 7 * 24 * HOUR_MS, 7 * 24 * HOUR_MS),
	};
}

export function parseCapabilities(value: unknown): CapabilitySnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const nested = isRecord(value["value"]) ? value["value"] : value;
	const revision = optionalFiniteNumber(value["revision"]);
	if (revision === undefined && !isRecord(value["value"]) && value["writable"] === undefined) return undefined;
	return {
		value: parseCapabilitySettings(nested),
		revision: revision ?? 0,
		writable: value["writable"] === true,
	};
}

function parseUsageWindow(value: unknown): UsageWindowView | undefined {
	if (!isRecord(value)) return undefined;
	const usedPercent = optionalPercent(value["usedPercent"] ?? value["used_percent"]);
	const remainingPercent = optionalPercent(value["remainingPercent"] ?? value["remaining_percent"]);
	const windowSeconds = optionalFiniteNumber(value["windowSeconds"] ?? value["limit_window_seconds"]);
	const resetsAt = optionalFiniteNumber(value["resetsAt"] ?? value["reset_at"]);
	if (
		usedPercent === undefined &&
		remainingPercent === undefined &&
		windowSeconds === undefined &&
		resetsAt === undefined
	) {
		return undefined;
	}
	return {
		...(usedPercent === undefined ? {} : { usedPercent }),
		...(remainingPercent === undefined ? {} : { remainingPercent }),
		...(windowSeconds !== undefined && windowSeconds > 0 ? { windowSeconds } : {}),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function parseUsageLimit(value: unknown, fallbackId: string): UsageLimitView | undefined {
	if (!isRecord(value)) return undefined;
	const id = optionalString(value["id"]) ?? optionalString(value["metered_feature"]) ?? fallbackId;
	const name = optionalString(value["name"]) ?? optionalString(value["limit_name"]);
	const nested = isRecord(value["rate_limit"]) ? value["rate_limit"] : value;
	const windows = Array.isArray(value["windows"])
		? value["windows"].map(parseUsageWindow).filter((entry): entry is UsageWindowView => entry !== undefined)
		: [
				parseUsageWindow(nested["primary_window"]),
				parseUsageWindow(nested["secondary_window"]),
				parseUsageWindow(nested),
			].filter((entry): entry is UsageWindowView => entry !== undefined);
	if (windows.length === 0 && name === undefined && optionalString(value["id"]) === undefined) return undefined;
	return { id, windows, ...(name === undefined ? {} : { name }) };
}

export function parseUsage(value: unknown): UsageView | undefined {
	if (!isRecord(value)) return undefined;
	const payload = isRecord(value["usage"]) ? value["usage"] : value;
	const rateLimits: UsageLimitView[] = [];
	const seen = new Set<string>();
	const add = (limit: UsageLimitView | undefined): void => {
		if (limit === undefined || seen.has(limit.id)) return;
		seen.add(limit.id);
		rateLimits.push(limit);
	};
	if (Array.isArray(payload["rateLimits"])) {
		payload["rateLimits"].forEach((entry, index) => add(parseUsageLimit(entry, `limit-${String(index)}`)));
	} else {
		add(parseUsageLimit(payload["rate_limit"], "codex"));
		if (Array.isArray(payload["additional_rate_limits"])) {
			payload["additional_rate_limits"].forEach((entry, index) =>
				add(parseUsageLimit(entry, `extra-${String(index)}`)),
			);
		}
		add(parseUsageLimit(payload["code_review_rate_limit"], "code_review"));
	}
	const credits = isRecord(payload["credits"]) ? payload["credits"] : undefined;
	const spend = isRecord(payload["individualLimit"])
		? payload["individualLimit"]
		: isRecord(payload["spend_control"])
			? isRecord(payload["spend_control"]["individual_limit"])
				? payload["spend_control"]["individual_limit"]
				: payload["spend_control"]
			: undefined;
	const resetRaw = isRecord(payload["resetCredits"])
		? payload["resetCredits"]["availableCount"]
		: isRecord(payload["rate_limit_reset_credits"])
			? payload["rate_limit_reset_credits"]["available_count"]
			: undefined;
	const resetCredits = optionalFiniteNumber(resetRaw);
	const fetchedAt = optionalFiniteNumber(payload["fetchedAt"]);
	const spendControlReached =
		optionalBoolean(payload["spendControlReached"]) ??
		(isRecord(payload["spend_control"]) ? optionalBoolean(payload["spend_control"]["reached"]) : undefined);
	const creditsBalance = credits === undefined ? undefined : optionalString(credits["balance"]);
	const individualLimit = spend === undefined ? undefined : optionalString(spend["limit"]);
	const individualUsed = spend === undefined ? undefined : optionalString(spend["used"]);
	const individualRemaining = spend === undefined ? undefined : optionalString(spend["remaining"]);
	const individualRemainingPercent =
		spend === undefined ? undefined : optionalPercent(spend["remainingPercent"] ?? spend["remaining_percent"]);
	const individualResetsAt =
		spend === undefined ? undefined : optionalFiniteNumber(spend["resetsAt"] ?? spend["reset_at"]);
	return {
		rateLimits,
		...(credits !== undefined && typeof credits["unlimited"] === "boolean"
			? { creditsUnlimited: credits["unlimited"] }
			: {}),
		...(creditsBalance === undefined ? {} : { creditsBalance }),
		...(individualLimit === undefined ? {} : { individualLimit }),
		...(individualUsed === undefined ? {} : { individualUsed }),
		...(individualRemaining === undefined ? {} : { individualRemaining }),
		...(individualRemainingPercent === undefined ? {} : { individualRemainingPercent }),
		...(individualResetsAt === undefined ? {} : { individualResetsAt }),
		...(spendControlReached === undefined ? {} : { spendControlReached }),
		...(resetCredits !== undefined && resetCredits >= 0 && Number.isSafeInteger(resetCredits) ? { resetCredits } : {}),
		...(fetchedAt === undefined ? {} : { fetchedAt }),
	};
}

export function usageHasVisibleFields(usage: UsageView): boolean {
	return (
		usage.rateLimits.some((limit) => limit.windows.length > 0 || limit.name !== undefined) ||
		usage.creditsUnlimited !== undefined ||
		usage.creditsBalance !== undefined ||
		usage.individualLimit !== undefined ||
		usage.individualUsed !== undefined ||
		usage.individualRemaining !== undefined ||
		usage.individualRemainingPercent !== undefined ||
		usage.spendControlReached === true ||
		usage.resetCredits !== undefined
	);
}

export function parseGateway(value: unknown): GatewayView | undefined {
	if (!isRecord(value)) return undefined;
	const bind = optionalString(value["bind"]);
	const port = optionalFiniteNumber(value["port"]);
	if (bind === undefined || port === undefined) return undefined;
	const models = Array.isArray(value["models"])
		? value["models"].filter((model): model is string => typeof model === "string" && model.length > 0)
		: [];
	const model = optionalString(value["model"]) ?? models[0] ?? null;
	if (models.length === 0 && model !== null) models.push(model);
	const keyAvailable = value["keyAvailable"] === true || value["keyConfigured"] === true;
	return {
		enabled: value["enabled"] === true,
		running: value["running"] === true,
		bind,
		port,
		model,
		keyConfigured: keyAvailable,
		keyAvailable,
		keyHint: optionalString(value["keyHint"]) ?? "",
		models,
		warning: optionalString(value["warning"]) ?? "",
	};
}

export function formatGatewayBaseUrl(bind: string, port: number): string {
	const host = bind.includes(":") && !bind.startsWith("[") ? `[${bind}]` : bind;
	return `http://${host}:${String(port)}`;
}

export function randomGatewayPort(exclude?: number): number {
	for (let attempt = 0; attempt < 32; attempt += 1) {
		const span = GATEWAY_RANDOM_PORT_MAX - GATEWAY_RANDOM_PORT_MIN + 1;
		const candidate = GATEWAY_RANDOM_PORT_MIN + Math.floor(Math.random() * span);
		if (candidate !== exclude && !GATEWAY_RANDOM_RESERVED.has(candidate)) return candidate;
	}
	return exclude === GATEWAY_RANDOM_PORT_MIN ? GATEWAY_RANDOM_PORT_MIN + 1 : GATEWAY_RANDOM_PORT_MIN;
}

export function parseGatewayPort(value: string): number | undefined {
	const port = Number(value);
	if (!Number.isInteger(port) || port < GATEWAY_PORT_MIN || port > GATEWAY_PORT_MAX) return undefined;
	return port;
}

export function parseImagineCredential(value: unknown): ImagineCredentialView | undefined {
	if (!isRecord(value)) return undefined;
	const configured = optionalBoolean(value["configured"]);
	if (configured === undefined && value["source"] === undefined && value["writable"] === undefined) return undefined;
	const source = optionalString(value["source"]);
	const writable = optionalBoolean(value["writable"]);
	return {
		configured: configured === true,
		...(source === undefined || looksSecret(source) ? {} : { source }),
		...(writable === undefined ? {} : { writable }),
	};
}

export function imagineSourceLabel(source: string | undefined, t: GrokBuildSettingsInjected["t"]): string {
	if (source === undefined) return t("imagineSourceUnknown");
	const mapped = IMAGINE_SOURCE_KEY[source] ?? IMAGINE_SOURCE_KEY[source.toLowerCase()];
	if (mapped !== undefined) return t(mapped);
	if (source.length <= 40 && /^[a-z0-9._-]+$/iu.test(source) && !looksSecret(source)) return source;
	return t("imagineSourceUnknown");
}

export function modelFields(status: ProviderStatus): { available: string[]; selected: string[] } {
	if (status.status !== "signed-in") return { available: [], selected: [] };
	return {
		available: "available" in status ? status.available : [],
		selected: "selected" in status ? status.selected : [],
	};
}

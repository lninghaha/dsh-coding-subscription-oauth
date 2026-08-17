/** Plugin-owned coding subscription account section inside the dsh Settings shell. */

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GrokBuildSettingsKey } from "./locales.ts";

const STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
const LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
const LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
const LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
const LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
const MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
const SOURCES_PATH = "/plugins/dsh-grok-build/oauth/sources";
const SOURCES_PREVIEW_PATH = "/plugins/dsh-grok-build/oauth/sources/preview";
const SOURCES_COMMIT_PATH = "/plugins/dsh-grok-build/oauth/sources/commit";
const SOURCES_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/sources/cancel";
const CAPABILITIES_PATH = "/plugins/dsh-grok-build/capabilities";
const CODEX_USAGE_PATH = "/plugins/dsh-grok-build/codex/usage";
const IMAGINE_CREDENTIAL_PATH = "/plugins/dsh-grok-build/imagine/credential-status";
const POLL_INTERVAL_MS = 1_000;

type ProviderSlug = "grok" | "codex" | "kimi" | "claude";
type LoginMethod = "pkce" | "device" | "browser";
type CatalogSource = "live" | "cache" | "fallback";
type SourceKind = ProviderSlug;
type SourceReason = "missing" | "unsafe" | "invalid" | "too_large";
type SourceConflict =
	| "none"
	| "same_credential"
	| "same_account"
	| "different_account"
	| "unknown_account"
	| "unreadable_destination"
	| "unsafe_destination";
type SourcePreviewAction = "import" | "reuse" | "overwrite" | "blocked";
type SourceCommitAction = "imported" | "unchanged" | "overwritten";
type CapabilityFlagKey =
	| "codexSearch"
	| "codexImages"
	| "codexImageEdits"
	| "codexUsage"
	| "codexFast"
	| "grokImagineImage"
	| "grokImagineVideo";
type CapabilityLimitKey = "searchResults" | "imageCount" | "videoArtifactTtlMs";
type CapabilitySettingKey = CapabilityFlagKey | CapabilityLimitKey;

type GrokStatus =
	| { status: "signed-out"; grokImportAvailable: boolean }
	| { status: "signing-in"; method: "pkce" | "device"; url?: string; userCode?: string; grokImportAvailable: boolean }
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

type SubscriptionStatus = {
	provider: Exclude<ProviderSlug, "grok">;
	route: string;
	displayName: string;
	loginMethods: readonly ("browser" | "device")[];
	recommendedLoginMethod: "browser" | "device";
	models: string[];
	available: string[];
	selected: string[];
} & (
	| { status: "signed-out" }
	| { status: "signing-in"; method: "browser" | "device"; url?: string; userCode?: string }
	| { status: "signed-in"; expiresAt?: number }
	| { status: "error"; message: string }
);

type ProviderStatus = GrokStatus | SubscriptionStatus;

interface CodingOAuthStatus {
	providers: {
		grok: GrokStatus;
		codex: SubscriptionStatus;
		kimi: SubscriptionStatus;
		claude: SubscriptionStatus;
	};
	antigravity: { installed: boolean; route: "agy"; management: "cli" };
}

interface LoginChallenge {
	method: LoginMethod;
	url: string;
	userCode?: string;
}

interface ProviderCardDefinition {
	slug: ProviderSlug;
	route: string;
	titleKey: GrokBuildSettingsKey;
	descriptionKey: GrokBuildSettingsKey;
	methods: readonly LoginMethod[];
	recommended: LoginMethod;
}

interface SourceStatus {
	kind: SourceKind;
	displayPath: string;
	available: boolean;
	expiresAt?: number;
	reason?: SourceReason;
}

interface SourcePreview {
	previewId: string;
	kind: SourceKind;
	displayPath: string;
	expiresAt?: number;
	ticketExpiresAt?: number;
	conflict?: SourceConflict;
	action?: SourcePreviewAction;
	warnings: string[];
	confirmOverwriteRequired: boolean;
}

interface CapabilityFlags {
	codexSearch: boolean;
	codexImages: boolean;
	codexImageEdits: boolean;
	codexUsage: boolean;
	codexFast: boolean;
	grokImagineImage: boolean;
	grokImagineVideo: boolean;
}

interface CapabilitySettingsView extends CapabilityFlags {
	searchResults: number;
	imageCount: number;
	videoArtifactTtlMs: number;
}

interface CapabilitySnapshot {
	value: CapabilitySettingsView;
	revision: number;
	writable: boolean;
}

interface UsageWindowView {
	usedPercent?: number;
	remainingPercent?: number;
	windowSeconds?: number;
	resetsAt?: number;
}

interface UsageLimitView {
	id: string;
	name?: string;
	windows: UsageWindowView[];
}

interface UsageView {
	rateLimits: UsageLimitView[];
	creditsUnlimited?: boolean;
	creditsBalance?: string;
	individualLimit?: string;
	individualUsed?: string;
	individualRemaining?: string;
	individualRemainingPercent?: number;
	individualResetsAt?: number;
	spendControlReached?: boolean;
	resetCredits?: number;
	fetchedAt?: number;
}

interface ImagineCredentialView {
	configured: boolean;
	source?: string;
	writable?: boolean;
}

interface PluginRequestError extends Error {
	status: number;
	code?: string;
}

const SOURCE_KINDS: readonly SourceKind[] = ["grok", "codex", "kimi", "claude"];
const SOURCE_REASONS: readonly SourceReason[] = ["missing", "unsafe", "invalid", "too_large"];
const SOURCE_CONFLICTS: readonly SourceConflict[] = [
	"none",
	"same_credential",
	"same_account",
	"different_account",
	"unknown_account",
	"unreadable_destination",
	"unsafe_destination",
];
const SOURCE_PREVIEW_ACTIONS: readonly SourcePreviewAction[] = ["import", "reuse", "overwrite", "blocked"];
const SOURCE_COMMIT_ACTIONS: readonly SourceCommitAction[] = ["imported", "unchanged", "overwritten"];
const SOURCE_DEFAULT_PATH: { readonly [K in SourceKind]: string } = {
	grok: "~/.grok/auth.json",
	codex: "~/.codex/auth.json",
	kimi: "~/.kimi/credentials/kimi-code.json",
	claude: "~/.claude/.credentials.json",
};
const SOURCE_KIND_KEY: { readonly [K in SourceKind]: GrokBuildSettingsKey } = {
	grok: "sourceKindGrok",
	codex: "sourceKindCodex",
	kimi: "sourceKindKimi",
	claude: "sourceKindClaude",
};
const SOURCE_REASON_KEY: { readonly [K in SourceReason]: GrokBuildSettingsKey } = {
	missing: "sourceReasonMissing",
	unsafe: "sourceReasonUnsafe",
	invalid: "sourceReasonInvalid",
	too_large: "sourceReasonTooLarge",
};
const SOURCE_CONFLICT_KEY: { readonly [K in SourceConflict]: GrokBuildSettingsKey } = {
	none: "sourceConflictNone",
	same_credential: "sourceConflictSameCredential",
	same_account: "sourceConflictSameAccount",
	different_account: "sourceConflictDifferentAccount",
	unknown_account: "sourceConflictUnknownAccount",
	unreadable_destination: "sourceConflictUnreadableDestination",
	unsafe_destination: "sourceConflictUnsafeDestination",
};
const SOURCE_PREVIEW_ACTION_KEY: { readonly [K in SourcePreviewAction]: GrokBuildSettingsKey } = {
	import: "sourceActionImport",
	reuse: "sourceActionReuse",
	overwrite: "sourceActionOverwrite",
	blocked: "sourceActionBlocked",
};
const SOURCE_COMMIT_ACTION_KEY: { readonly [K in SourceCommitAction]: GrokBuildSettingsKey } = {
	imported: "sourceCommitImported",
	unchanged: "sourceCommitUnchanged",
	overwritten: "sourceCommitOverwritten",
};
const CAPABILITY_TOGGLES: readonly {
	key: CapabilityFlagKey;
	label: GrokBuildSettingsKey;
	hint: GrokBuildSettingsKey;
	requiresImages?: true;
}[] = [
	{ key: "codexSearch", label: "capCodexSearch", hint: "capCodexSearchHint" },
	{ key: "codexImages", label: "capCodexImages", hint: "capCodexImagesHint" },
	{ key: "codexImageEdits", label: "capCodexImageEdits", hint: "capCodexImageEditsHint", requiresImages: true },
	{ key: "codexUsage", label: "capCodexUsage", hint: "capCodexUsageHint" },
	{ key: "codexFast", label: "capCodexFast", hint: "capCodexFastHint" },
	{ key: "grokImagineImage", label: "capGrokImagineImage", hint: "capGrokImagineImageHint" },
	{ key: "grokImagineVideo", label: "capGrokImagineVideo", hint: "capGrokImagineVideoHint" },
];
const HOUR_MS = 60 * 60 * 1000;
const CAPABILITY_LIMITS: readonly {
	key: CapabilityLimitKey;
	label: GrokBuildSettingsKey;
	hint: GrokBuildSettingsKey;
	min: number;
	max: number;
	scale: number;
}[] = [
	{ key: "searchResults", label: "capSearchResults", hint: "capSearchResultsHint", min: 1, max: 20, scale: 1 },
	{ key: "imageCount", label: "capImageCount", hint: "capImageCountHint", min: 1, max: 4, scale: 1 },
	{
		key: "videoArtifactTtlMs",
		label: "capVideoTtlHours",
		hint: "capVideoTtlHoursHint",
		min: 1,
		max: 168,
		scale: HOUR_MS,
	},
];
const IMAGINE_SOURCE_KEY: { readonly [source: string]: GrokBuildSettingsKey } = {
	none: "imagineSourceNone",
	env: "imagineSourceEnv",
	environment: "imagineSourceEnv",
	"xai-api-key": "imagineSourceEnv",
	xai_api_key: "imagineSourceEnv",
	"api-key": "imagineSourceApiKey",
	api_key: "imagineSourceApiKey",
	apikey: "imagineSourceApiKey",
	key: "imagineSourceApiKey",
	settings: "imagineSourceApiKey",
	oauth: "imagineSourceOAuth",
	"oauth-access": "imagineSourceOAuth",
	"grok-cli-key": "imagineSourceCliKey",
	"cli-key": "imagineSourceCliKey",
};

const PROVIDERS: readonly ProviderCardDefinition[] = [
	{
		slug: "grok",
		route: "grok-build",
		titleKey: "grokTitle",
		descriptionKey: "grokDescription",
		methods: ["pkce", "device"],
		recommended: "pkce",
	},
	{
		slug: "codex",
		route: "codex-oauth",
		titleKey: "codexTitle",
		descriptionKey: "codexDescription",
		methods: ["device", "browser"],
		recommended: "device",
	},
	{
		slug: "kimi",
		route: "kimi-code-oauth",
		titleKey: "kimiTitle",
		descriptionKey: "kimiDescription",
		methods: ["device"],
		recommended: "device",
	},
	{
		slug: "claude",
		route: "claude-code-oauth",
		titleKey: "claudeTitle",
		descriptionKey: "claudeDescription",
		methods: ["browser"],
		recommended: "browser",
	},
];

export interface GrokBuildSettingsInjected {
	t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string;
}

export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>;

const pageStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 18, maxWidth: 780 };
const titleStyle: CSSProperties = {
	margin: 0,
	fontSize: 20,
	lineHeight: "28px",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
const bodyStyle: CSSProperties = {
	margin: 0,
	fontSize: 14,
	lineHeight: "22px",
	color: "var(--dsw-alias-label-secondary)",
};
const cardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 14,
	padding: "18px 20px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 12,
	background: "var(--dsw-alias-bg-module-platform)",
};
const rowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: 12,
};
const statusStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 9,
	fontSize: 14,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary)",
};
const buttonStyle: CSSProperties = {
	boxSizing: "border-box",
	minHeight: 34,
	padding: "6px 14px",
	border: "1px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, 0.4))",
	borderRadius: 18,
	background: "var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-1))",
	color: "var(--dsw-alias-label-primary)",
	boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
	font: "inherit",
	fontSize: 14,
	fontWeight: 500,
	cursor: "pointer",
};
const primaryButtonStyle: CSSProperties = {
	...buttonStyle,
	borderColor: "#315fc7",
	background: "#315fc7",
	color: "#ffffff",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
	fontWeight: 600,
};
const errorStyle: CSSProperties = { ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" };
const warningStyle: CSSProperties = {
	...bodyStyle,
	padding: "10px 12px",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
};
const codeStyle: CSSProperties = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
const monoStyle: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const linkStyle: CSSProperties = { color: "var(--dsw-alias-brand-primary)", wordBreak: "break-all" };
const listStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	margin: 0,
	padding: 0,
	listStyle: "none",
};
const checkRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: 8,
	fontSize: 14,
	color: "var(--dsw-alias-label-primary)",
};
const inputStyle: CSSProperties = {
	boxSizing: "border-box",
	width: "100%",
	minHeight: 34,
	padding: "6px 12px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: 13,
};
const nestedStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	padding: "12px 14px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
};
const hintStyle: CSSProperties = { ...bodyStyle, fontSize: 13 };

function dotStyle(
	status: ProviderStatus["status"] | "loading" | "available" | "unavailable",
	installed = true,
): CSSProperties {
	const color = !installed
		? "var(--dsw-alias-label-dimmed, #9aa0a6)"
		: status === "signed-in" || status === "available"
			? "var(--dsw-alias-state-success-primary, #22a06b)"
			: status === "error"
				? "var(--dsw-alias-state-error-primary, #d92d20)"
				: status === "signing-in" || status === "loading"
					? "var(--dsw-alias-brand-primary, #1677ff)"
					: "var(--dsw-alias-label-dimmed, #9aa0a6)";
	return { width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: color };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length < 500 ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function optionalPercent(value: unknown): number | undefined {
	const numeric = optionalFiniteNumber(value);
	return numeric !== undefined && numeric >= 0 && numeric <= 100 ? numeric : undefined;
}

function isSourceKind(value: string): value is SourceKind {
	return (SOURCE_KINDS as readonly string[]).includes(value);
}

function isSourceReason(value: string): value is SourceReason {
	return (SOURCE_REASONS as readonly string[]).includes(value);
}

function isSourceConflict(value: string): value is SourceConflict {
	return (SOURCE_CONFLICTS as readonly string[]).includes(value);
}

function isSourcePreviewAction(value: string): value is SourcePreviewAction {
	return (SOURCE_PREVIEW_ACTIONS as readonly string[]).includes(value);
}

function isSourceCommitAction(value: string): value is SourceCommitAction {
	return (SOURCE_COMMIT_ACTIONS as readonly string[]).includes(value);
}

function looksSecret(value: string): boolean {
	return /eyJ[A-Za-z0-9_-]+\.|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/u.test(value);
}

function safeDisplayPath(value: unknown, kind: SourceKind): string {
	const text = optionalString(value);
	if (text === undefined || looksSecret(text) || text.length > 180) return SOURCE_DEFAULT_PATH[kind];
	return text;
}

function safeWarning(value: unknown): string | undefined {
	const text = optionalString(value);
	if (text === undefined || looksSecret(text)) return undefined;
	return text;
}

function formatEpoch(value: number | undefined): string | undefined {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
	const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : undefined;
	if (ms === undefined) return undefined;
	const formatted = new Date(ms).toLocaleString();
	return formatted.length > 0 ? formatted : undefined;
}

function isPluginRequestError(error: unknown): error is PluginRequestError {
	return error instanceof Error && error.name === "PluginRequestError" && "status" in error;
}

function isConflictError(error: unknown): boolean {
	if (!isPluginRequestError(error)) {
		return (
			error instanceof Error && /SETTINGS_CONFLICT|settings-conflict|changed since it was read/iu.test(error.message)
		);
	}
	return error.status === 409 || error.code === "SETTINGS_CONFLICT" || /conflict/iu.test(error.message);
}

const CONSUMED_PREVIEW_CODES = new Set([
	"preview_invalid",
	"preview_expired",
	"source_changed",
	"destination_changed",
	"confirm_required",
	"unsafe_destination",
]);

function isConsumedPreviewError(error: unknown): boolean {
	if (!isPluginRequestError(error)) return false;
	if (error.code !== undefined && CONSUMED_PREVIEW_CODES.has(error.code)) return true;
	return error.status === 404 || error.status === 410;
}

function cancelPreviewTicket(previewId: string, keepalive = false): void {
	void fetch(SOURCES_CANCEL_PATH, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ previewId }),
		...(keepalive ? { keepalive: true } : {}),
	}).catch(() => undefined);
}

async function jsonRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
		credentials: "same-origin",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const record = isRecord(value) ? value : undefined;
		const message =
			record !== undefined && typeof record["error"] === "string"
				? record["error"]
				: record !== undefined && typeof record["message"] === "string"
					? record["message"]
					: `HTTP ${response.status}`;
		const code = record !== undefined && typeof record["code"] === "string" ? record["code"] : undefined;
		const error = new Error(message) as PluginRequestError;
		error.name = "PluginRequestError";
		error.status = response.status;
		if (code !== undefined) error.code = code;
		throw error;
	}
	return value as T;
}

function parseSource(value: unknown): SourceStatus | undefined {
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

function mergeSources(discovered: readonly SourceStatus[]): SourceStatus[] {
	return SOURCE_KINDS.map((kind) => {
		const found = discovered.find((entry) => entry.kind === kind);
		return found ?? { kind, displayPath: SOURCE_DEFAULT_PATH[kind], available: false, reason: "missing" };
	});
}

function parseSources(value: unknown): SourceStatus[] {
	const rows = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value["sources"])
			? value["sources"]
			: [];
	return mergeSources(rows.map(parseSource).filter((entry): entry is SourceStatus => entry !== undefined));
}

function parsePreview(value: unknown): SourcePreview | undefined {
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

function parseCommitAction(value: unknown): SourceCommitAction | undefined {
	if (!isRecord(value)) return undefined;
	const action = optionalString(value["action"]);
	return action !== undefined && isSourceCommitAction(action) ? action : undefined;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = optionalFiniteNumber(value);
	return numeric !== undefined && Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

function emptyCapabilitySettings(): CapabilitySettingsView {
	return {
		codexSearch: false,
		codexImages: false,
		codexImageEdits: false,
		codexUsage: false,
		codexFast: false,
		grokImagineImage: false,
		grokImagineVideo: false,
		searchResults: 5,
		imageCount: 1,
		videoArtifactTtlMs: 7 * 24 * HOUR_MS,
	};
}

function parseCapabilitySettings(value: unknown): CapabilitySettingsView {
	const source = isRecord(value) ? value : {};
	return {
		codexSearch: source["codexSearch"] === true,
		codexImages: source["codexImages"] === true,
		codexImageEdits: source["codexImageEdits"] === true,
		codexUsage: source["codexUsage"] === true,
		codexFast: source["codexFast"] === true,
		grokImagineImage: source["grokImagineImage"] === true,
		grokImagineVideo: source["grokImagineVideo"] === true,
		searchResults: boundedInteger(source["searchResults"], 1, 20, 5),
		imageCount: boundedInteger(source["imageCount"], 1, 4, 1),
		videoArtifactTtlMs: boundedInteger(source["videoArtifactTtlMs"], HOUR_MS, 7 * 24 * HOUR_MS, 7 * 24 * HOUR_MS),
	};
}

function parseCapabilities(value: unknown): CapabilitySnapshot | undefined {
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

function parseUsage(value: unknown): UsageView | undefined {
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

function usageHasVisibleFields(usage: UsageView): boolean {
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

function parseImagineCredential(value: unknown): ImagineCredentialView | undefined {
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

function imagineSourceLabel(source: string | undefined, t: GrokBuildSettingsInjected["t"]): string {
	if (source === undefined) return t("imagineSourceUnknown");
	const mapped = IMAGINE_SOURCE_KEY[source] ?? IMAGINE_SOURCE_KEY[source.toLowerCase()];
	if (mapped !== undefined) return t(mapped);
	if (source.length <= 40 && /^[a-z0-9._-]+$/iu.test(source) && !looksSecret(source)) return source;
	return t("imagineSourceUnknown");
}

function methodLabel(method: LoginMethod, t: GrokBuildSettingsInjected["t"]): string {
	if (method === "device") return t("deviceLogin");
	if (method === "browser") return t("browserLogin");
	return t("pkceLogin");
}

function modelFields(status: ProviderStatus): { available: string[]; selected: string[] } {
	if (status.status !== "signed-in") return { available: [], selected: [] };
	return {
		available: "available" in status ? status.available : [],
		selected: "selected" in status ? status.selected : [],
	};
}

/** Multi-provider coding subscription status and OAuth actions. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
	if (t === undefined) throw new Error("Coding OAuth settings requires its translation function");
	const [status, setStatus] = useState<CodingOAuthStatus | undefined>(undefined);
	const [requestError, setRequestError] = useState<string | undefined>(undefined);
	const [busyProvider, setBusyProvider] = useState<ProviderSlug | undefined>(undefined);
	const [codeInputs, setCodeInputs] = useState<Partial<Record<ProviderSlug, string>>>({});
	const [popupBlocked, setPopupBlocked] = useState<Partial<Record<ProviderSlug, boolean>>>({});
	const [sources, setSources] = useState<SourceStatus[] | undefined>(undefined);
	const [sourcesError, setSourcesError] = useState<string | undefined>(undefined);
	const [sourcesBusy, setSourcesBusy] = useState(false);
	const [preview, setPreview] = useState<SourcePreview | undefined>(undefined);
	const previewRef = useRef<SourcePreview | undefined>(undefined);
	const previewEpochRef = useRef(0);
	const mountedRef = useRef(true);
	const [confirmOverwrite, setConfirmOverwrite] = useState(false);
	const [sourcesNotice, setSourcesNotice] = useState<string | undefined>(undefined);
	const [capabilities, setCapabilities] = useState<CapabilitySnapshot | undefined>(undefined);
	const [capabilitiesError, setCapabilitiesError] = useState<string | undefined>(undefined);
	const [capabilitiesBusy, setCapabilitiesBusy] = useState(false);
	const [usage, setUsage] = useState<UsageView | undefined>(undefined);
	const [usageError, setUsageError] = useState<string | undefined>(undefined);
	const [usageLoading, setUsageLoading] = useState(false);
	const [imagine, setImagine] = useState<ImagineCredentialView | undefined>(undefined);
	const [imagineError, setImagineError] = useState<string | undefined>(undefined);

	const refresh = useCallback(async () => {
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(STATUS_PATH));
			setRequestError(undefined);
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		}
	}, [t]);

	const refreshSources = useCallback(async () => {
		try {
			setSources(parseSources(await jsonRequest<unknown>(SOURCES_PATH)));
			setSourcesError(undefined);
		} catch (error: unknown) {
			setSources(mergeSources([]));
			setSourcesError(error instanceof Error ? error.message : t("sourcesLoadFailed"));
		}
	}, [t]);

	const refreshCapabilities = useCallback(async () => {
		try {
			const parsed = parseCapabilities(await jsonRequest<unknown>(CAPABILITIES_PATH));
			setCapabilities(parsed ?? { value: emptyCapabilitySettings(), revision: 0, writable: false });
			setCapabilitiesError(undefined);
			return parsed;
		} catch (error: unknown) {
			setCapabilities({ value: emptyCapabilitySettings(), revision: 0, writable: false });
			setCapabilitiesError(error instanceof Error ? error.message : t("capabilitiesLoadFailed"));
			return undefined;
		}
	}, [t]);

	const refreshImagine = useCallback(async () => {
		try {
			setImagine(parseImagineCredential(await jsonRequest<unknown>(IMAGINE_CREDENTIAL_PATH)));
			setImagineError(undefined);
		} catch (error: unknown) {
			setImagineError(error instanceof Error ? error.message : t("imagineLoadFailed"));
		}
	}, [t]);

	const refreshUsage = useCallback(async () => {
		setUsageLoading(true);
		try {
			setUsage(parseUsage(await jsonRequest<unknown>(CODEX_USAGE_PATH)));
			setUsageError(undefined);
		} catch (error: unknown) {
			setUsage(undefined);
			setUsageError(error instanceof Error ? error.message : t("usageUnavailable"));
		} finally {
			setUsageLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void refresh();
		void refreshSources();
		void refreshCapabilities();
		void refreshImagine();
	}, [refresh, refreshSources, refreshCapabilities, refreshImagine]);
	useEffect(() => {
		previewRef.current = preview;
	}, [preview]);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			previewEpochRef.current += 1;
			const active = previewRef.current;
			if (active !== undefined) cancelPreviewTicket(active.previewId, true);
		};
	}, []);
	useEffect(() => {
		const signingIn =
			status !== undefined && Object.values(status.providers).some((provider) => provider.status === "signing-in");
		if (!signingIn) return;
		const timer = window.setInterval(() => {
			void refresh();
		}, POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, status]);
	useEffect(() => {
		const signedIn = status?.providers.codex.status === "signed-in";
		if (capabilities?.value.codexUsage === true && signedIn) {
			void refreshUsage();
			return;
		}
		setUsage(undefined);
		setUsageError(undefined);
		setUsageLoading(false);
	}, [capabilities?.value.codexUsage, refreshUsage, status?.providers.codex.status]);

	const signIn = async (provider: ProviderSlug, method: LoginMethod): Promise<void> => {
		const popup = window.open("about:blank", "_blank");
		if (popup !== null) popup.opener = null;
		setBusyProvider(provider);
		setRequestError(undefined);
		setPopupBlocked((current) => ({ ...current, [provider]: popup === null }));
		try {
			const challenge = await jsonRequest<LoginChallenge>(LOGIN_PATH, "POST", { provider, method });
			if (popup !== null) popup.location.replace(challenge.url);
			await refresh();
		} catch (error: unknown) {
			popup?.close();
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
			await refresh();
		} finally {
			setBusyProvider(undefined);
		}
	};

	const submitCode = async (provider: ProviderSlug): Promise<void> => {
		const code = codeInputs[provider]?.trim() ?? "";
		if (code.length === 0) return;
		setBusyProvider(provider);
		try {
			await jsonRequest<{ ok: true }>(LOGIN_CODE_PATH, "POST", { provider, code });
			setCodeInputs((current) => ({ ...current, [provider]: "" }));
			await refresh();
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const cancelLogin = async (provider: ProviderSlug): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(LOGIN_CANCEL_PATH, "POST", { provider }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const signOut = async (provider: ProviderSlug): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(LOGOUT_PATH, "POST", { provider }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const saveModels = async (provider: ProviderSlug, selected: string[]): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(MODELS_PATH, "POST", { provider, selected }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const previewSource = async (kind: SourceKind): Promise<void> => {
		const epoch = ++previewEpochRef.current;
		const previous = previewRef.current;
		if (previous !== undefined) {
			previewRef.current = undefined;
			setPreview(undefined);
			cancelPreviewTicket(previous.previewId);
		}
		setSourcesBusy(true);
		setSourcesNotice(undefined);
		setConfirmOverwrite(false);
		try {
			const next = parsePreview(await jsonRequest<unknown>(SOURCES_PREVIEW_PATH, "POST", { kind }));
			if (next === undefined) throw new Error(t("sourcesPreviewFailed"));
			if (!mountedRef.current || epoch !== previewEpochRef.current) {
				cancelPreviewTicket(next.previewId, !mountedRef.current);
				return;
			}
			previewRef.current = next;
			setPreview(next);
			setSourcesError(undefined);
		} catch (error: unknown) {
			if (!mountedRef.current || epoch !== previewEpochRef.current) return;
			setPreview(undefined);
			setSourcesError(error instanceof Error ? error.message : t("sourcesPreviewFailed"));
		} finally {
			if (mountedRef.current && epoch === previewEpochRef.current) setSourcesBusy(false);
		}
	};

	const commitSource = async (): Promise<void> => {
		if (preview === undefined) return;
		if (preview.action === "blocked") return;
		if (preview.confirmOverwriteRequired && !confirmOverwrite) return;
		setSourcesBusy(true);
		try {
			const result = await jsonRequest<unknown>(SOURCES_COMMIT_PATH, "POST", {
				kind: preview.kind,
				previewId: preview.previewId,
				confirmOverwrite,
			});
			const action = parseCommitAction(result);
			previewRef.current = undefined;
			setPreview(undefined);
			setConfirmOverwrite(false);
			setSourcesNotice(
				t("sourcesCommitSuccess", { action: action === undefined ? "" : t(SOURCE_COMMIT_ACTION_KEY[action]) }),
			);
			setSourcesError(undefined);
			await refreshSources();
			await refresh();
		} catch (error: unknown) {
			if (isConsumedPreviewError(error)) {
				previewRef.current = undefined;
				setPreview(undefined);
				setConfirmOverwrite(false);
			}
			setSourcesError(error instanceof Error ? error.message : t("sourcesCommitFailed"));
			await refreshSources();
		} finally {
			setSourcesBusy(false);
		}
	};

	const cancelSourcePreview = async (): Promise<void> => {
		if (preview === undefined) return;
		const previewId = preview.previewId;
		previewEpochRef.current += 1;
		previewRef.current = undefined;
		setPreview(undefined);
		setConfirmOverwrite(false);
		setSourcesBusy(true);
		try {
			await jsonRequest<unknown>(SOURCES_CANCEL_PATH, "POST", { previewId });
			setSourcesError(undefined);
		} catch (error: unknown) {
			setSourcesError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setSourcesBusy(false);
		}
	};

	const patchCapability = async (key: CapabilitySettingKey, value: boolean | number): Promise<boolean> => {
		if (capabilities === undefined || !capabilities.writable) return false;
		if (key === "codexImageEdits" && value === true && !capabilities.value.codexImages) return false;
		const patch: Partial<CapabilitySettingsView> =
			key === "codexImages" && value === false && capabilities.value.codexImageEdits
				? { codexImages: false, codexImageEdits: false }
				: ({ [key]: value } as Partial<CapabilitySettingsView>);
		setCapabilitiesBusy(true);
		try {
			const updated = parseCapabilities(
				await jsonRequest<unknown>(CAPABILITIES_PATH, "PATCH", {
					expectedRevision: capabilities.revision,
					patch,
				}),
			);
			if (updated !== undefined) setCapabilities(updated);
			else await refreshCapabilities();
			setCapabilitiesError(undefined);
			return true;
		} catch (error: unknown) {
			await refreshCapabilities();
			setCapabilitiesError(
				isConflictError(error)
					? t("capabilitiesConflictRefreshed")
					: error instanceof Error
						? error.message
						: t("capabilitiesSaveFailed"),
			);
			return false;
		} finally {
			setCapabilitiesBusy(false);
		}
	};

	const showUsage = capabilities?.value.codexUsage === true && status?.providers.codex.status === "signed-in";

	return (
		<section style={pageStyle} aria-labelledby="coding-oauth-settings-title">
			<div>
				<h2 id="coding-oauth-settings-title" style={titleStyle}>
					{t("title")}
				</h2>
				<p style={{ ...bodyStyle, marginTop: 6 }}>{t("intro")}</p>
			</div>
			<p style={warningStyle}>{t("termsWarning")}</p>
			{requestError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{requestError}
				</p>
			)}
			<section style={cardStyle} aria-labelledby="coding-oauth-sources-title">
				<div style={rowStyle}>
					<div>
						<h3 id="coding-oauth-sources-title" style={{ ...titleStyle, fontSize: 16 }}>
							{t("sourcesTitle")}
						</h3>
						<p style={{ ...bodyStyle, marginTop: 4 }}>{t("sourcesIntro")}</p>
					</div>
					<button
						type="button"
						style={buttonStyle}
						disabled={sourcesBusy}
						aria-label={t("sourcesCheckAgain")}
						onClick={() => {
							void refreshSources();
						}}
					>
						{sourcesBusy ? t("working") : t("sourcesCheckAgain")}
					</button>
				</div>
				<p style={hintStyle}>{t("sourcesReadOnlyHint")}</p>
				{sourcesError === undefined ? null : (
					<p style={errorStyle} role="alert">
						{sourcesError}
					</p>
				)}
				{sourcesNotice === undefined ? null : (
					<p style={bodyStyle} role="status">
						{sourcesNotice}
					</p>
				)}
				{sources === undefined ? (
					<div style={statusStyle} role="status">
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("sourcesLoading")}
					</div>
				) : (
					<ul style={listStyle}>
						{sources.map((source) => {
							const expiry = formatEpoch(source.expiresAt);
							const active = preview?.kind === source.kind ? preview : undefined;
							return (
								<li key={source.kind} style={nestedStyle}>
									<div style={rowStyle}>
										<div>
											<p style={{ ...statusStyle, margin: 0 }}>
												<span aria-hidden="true" style={dotStyle(source.available ? "available" : "unavailable")} />
												<span>{t(SOURCE_KIND_KEY[source.kind])}</span>
											</p>
											<p style={{ ...hintStyle, marginTop: 4 }}>
												<span style={monoStyle}>{source.displayPath}</span>
											</p>
											<p style={hintStyle} role="status">
												{source.available
													? t("sourcesAvailable")
													: source.reason !== undefined
														? t(SOURCE_REASON_KEY[source.reason])
														: t("sourcesUnavailable")}
												{expiry === undefined ? "" : ` · ${expiry}`}
											</p>
										</div>
										{source.available ? (
											<button
												type="button"
												style={primaryButtonStyle}
												disabled={sourcesBusy}
												aria-label={`${t("sourcesPullCopy")} (${t(SOURCE_KIND_KEY[source.kind])})`}
												onClick={() => {
													void previewSource(source.kind);
												}}
											>
												{t("sourcesPullCopy")}
											</button>
										) : null}
									</div>
									{active === undefined ? null : (
										<div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
											<p style={bodyStyle}>{t("sourcesPreviewTitle")}</p>
											<p style={hintStyle}>
												<span style={monoStyle}>{active.displayPath}</span>
											</p>
											<p style={bodyStyle}>
												{t("sourcesConflict", {
													detail: t(
														active.conflict === undefined
															? "sourceConflictUnrecognized"
															: SOURCE_CONFLICT_KEY[active.conflict],
													),
												})}
											</p>
											<p style={bodyStyle}>
												{t("sourcesAction", {
													detail: t(
														active.action === undefined
															? "sourceActionUnrecognized"
															: SOURCE_PREVIEW_ACTION_KEY[active.action],
													),
												})}
											</p>
											{formatEpoch(active.expiresAt) === undefined ? null : (
												<p style={hintStyle}>{t("sourcesPreviewExpires", { time: formatEpoch(active.expiresAt) })}</p>
											)}
											{formatEpoch(active.ticketExpiresAt) === undefined ? null : (
												<p style={hintStyle}>
													{t("sourcesTicketExpires", { time: formatEpoch(active.ticketExpiresAt) })}
												</p>
											)}
											{active.warnings.length === 0 ? null : (
												<ul style={{ ...listStyle, gap: 4 }} aria-label={t("sourcesWarnings")}>
													{active.warnings.map((warning) => (
														<li key={warning} style={hintStyle}>
															{warning}
														</li>
													))}
												</ul>
											)}
											{active.confirmOverwriteRequired ? (
												<label style={checkRowStyle}>
													<input
														type="checkbox"
														checked={confirmOverwrite}
														disabled={sourcesBusy || active.action === "blocked"}
														onChange={(event) => setConfirmOverwrite(event.target.checked)}
													/>
													<span>
														{t("sourcesConfirmOverwrite")}
														<span style={{ display: "block", ...hintStyle }}>{t("sourcesConfirmOverwriteHint")}</span>
													</span>
												</label>
											) : null}
											<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
												<button
													type="button"
													style={primaryButtonStyle}
													disabled={
														sourcesBusy ||
														active.action === "blocked" ||
														(active.confirmOverwriteRequired && !confirmOverwrite)
													}
													onClick={() => {
														void commitSource();
													}}
												>
													{t("sourcesCommit")}
												</button>
												<button
													type="button"
													style={buttonStyle}
													disabled={sourcesBusy}
													onClick={() => {
														void cancelSourcePreview();
													}}
												>
													{t("sourcesCancelPreview")}
												</button>
											</div>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</section>
			{status === undefined ? (
				<div style={cardStyle}>
					<div style={statusStyle}>
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("loadingAccount")}
					</div>
				</div>
			) : (
				PROVIDERS.map((definition) => {
					const providerStatus = status.providers[definition.slug];
					const grokProviderStatus = definition.slug === "grok" ? (providerStatus as GrokStatus) : undefined;
					const busy = busyProvider === definition.slug;
					const statusLabel =
						providerStatus.status === "signed-in"
							? t("signedIn")
							: providerStatus.status === "signing-in"
								? t("signingIn")
								: providerStatus.status === "error"
									? t("requestFailed")
									: t("signedOut");
					const activeMethod = providerStatus.status === "signing-in" ? providerStatus.method : definition.recommended;
					const { available, selected } = modelFields(providerStatus);
					const localCode = codeInputs[definition.slug] ?? "";
					return (
						<div key={definition.slug} style={cardStyle}>
							<div style={rowStyle}>
								<div>
									<h3 style={{ ...titleStyle, fontSize: 16 }}>{t(definition.titleKey)}</h3>
									<p style={{ ...bodyStyle, marginTop: 4 }}>{t(definition.descriptionKey)}</p>
									<p style={{ ...bodyStyle, marginTop: 4 }}>
										<span style={monoStyle}>{definition.route}</span>
									</p>
								</div>
								<div style={statusStyle} role="status">
									<span aria-hidden="true" style={dotStyle(providerStatus.status)} />
									<span>{statusLabel}</span>
								</div>
							</div>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								{providerStatus.status === "signed-in" ? (
									<button
										type="button"
										style={buttonStyle}
										disabled={busy}
										onClick={() => {
											void signOut(definition.slug);
										}}
									>
										{busy ? t("working") : t("logout")}
									</button>
								) : providerStatus.status === "signing-in" ? (
									<>
										{definition.methods
											.filter((method) => method !== activeMethod)
											.map((method) => (
												<button
													key={method}
													type="button"
													style={buttonStyle}
													disabled={busy}
													onClick={() => {
														void signIn(definition.slug, method);
													}}
												>
													{methodLabel(method, t)}
												</button>
											))}
										<button
											type="button"
											style={buttonStyle}
											disabled={busy}
											onClick={() => {
												void cancelLogin(definition.slug);
											}}
										>
											{t("cancelLogin")}
										</button>
									</>
								) : (
									definition.methods.map((method, index) => (
										<button
											key={method}
											type="button"
											style={index === 0 ? primaryButtonStyle : buttonStyle}
											disabled={busy}
											onClick={() => {
												void signIn(definition.slug, method);
											}}
										>
											{busy ? t("working") : methodLabel(method, t)}
										</button>
									))
								)}
							</div>
							{providerStatus.status === "error" ? <p style={errorStyle}>{providerStatus.message}</p> : null}
							{providerStatus.status === "signing-in" && providerStatus.userCode !== undefined ? (
								<p style={bodyStyle}>
									{t("userCode")} <span style={codeStyle}>{providerStatus.userCode}</span>
								</p>
							) : null}
							{providerStatus.status === "signing-in" && providerStatus.url !== undefined ? (
								<p style={bodyStyle}>
									{popupBlocked[definition.slug] === true ? t("popupBlocked") : t("openUrl")}{" "}
									<a href={providerStatus.url} target="_blank" rel="noreferrer" style={linkStyle}>
										{providerStatus.url}
									</a>
								</p>
							) : null}
							{providerStatus.status === "signing-in" && activeMethod !== "device" ? (
								<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
									<p style={bodyStyle}>{t(activeMethod === "browser" ? "pasteBrowserCodeHint" : "pasteCodeHint")}</p>
									<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
										<input
											style={{ ...inputStyle, flex: "1 1 360px" }}
											value={localCode}
											placeholder={t("pasteCodePlaceholder")}
											disabled={busy}
											onChange={(event) =>
												setCodeInputs((current) => ({ ...current, [definition.slug]: event.target.value }))
											}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													void submitCode(definition.slug);
												}
											}}
										/>
										<button
											type="button"
											style={primaryButtonStyle}
											disabled={busy || localCode.trim().length === 0}
											onClick={() => {
												void submitCode(definition.slug);
											}}
										>
											{t("submitCode")}
										</button>
									</div>
								</div>
							) : null}
							{providerStatus.status === "signed-in" ? (
								<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
									<div style={rowStyle}>
										<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("models")}</h4>
										<button
											type="button"
											style={buttonStyle}
											disabled={busy}
											onClick={() => {
												void saveModels(definition.slug, []);
											}}
										>
											{t("selectAll")}
										</button>
									</div>
									{grokProviderStatus?.status === "signed-in" ? (
										<p style={bodyStyle}>
											{grokProviderStatus.catalogSource === "live"
												? t("catalogLive")
												: grokProviderStatus.catalogSource === "cache"
													? t("catalogCache")
													: t("catalogFallback")}
										</p>
									) : null}
									<p style={bodyStyle}>
										{t("modelHint")} <span style={monoStyle}>{definition.route}/&lt;id&gt;</span>
									</p>
									<ul style={listStyle}>
										{available.map((id) => {
											const checked = selected.includes(id);
											return (
												<li key={id}>
													<label style={checkRowStyle}>
														<input
															type="checkbox"
															checked={checked}
															disabled={busy}
															onChange={() => {
																const current = new Set(selected);
																if (checked) current.delete(id);
																else current.add(id);
																void saveModels(definition.slug, [...current]);
															}}
														/>
														<span style={monoStyle}>{id}</span>
													</label>
												</li>
											);
										})}
									</ul>
									{grokProviderStatus?.status === "signed-in" && grokProviderStatus.catalogError !== undefined ? (
										<p style={errorStyle}>{t("catalogError")}</p>
									) : null}
								</div>
							) : null}
						</div>
					);
				})
			)}
			<section style={cardStyle} aria-labelledby="coding-oauth-capabilities-title">
				<div>
					<h3 id="coding-oauth-capabilities-title" style={{ ...titleStyle, fontSize: 16 }}>
						{t("capabilitiesTitle")}
					</h3>
					<p style={{ ...bodyStyle, marginTop: 4 }}>{t("capabilitiesIntro")}</p>
					<p style={{ ...hintStyle, marginTop: 4 }}>{t("capabilitiesQuotaHint")}</p>
				</div>
				{capabilitiesError === undefined ? null : (
					<p style={errorStyle} role="alert">
						{capabilitiesError}
					</p>
				)}
				{capabilities === undefined ? (
					<div style={statusStyle} role="status">
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("capabilitiesLoading")}
					</div>
				) : (
					<fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
						<legend style={{ ...bodyStyle, position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
							{t("capabilitiesTitle")}
						</legend>
						{capabilities.writable ? null : <p style={hintStyle}>{t("capabilitiesReadOnly")}</p>}
						<ul style={listStyle}>
							{CAPABILITY_TOGGLES.map((item) => {
								const checked = capabilities.value[item.key];
								const imagesOff = item.requiresImages === true && !capabilities.value.codexImages;
								const disabled = capabilitiesBusy || !capabilities.writable || imagesOff;
								return (
									<li key={item.key}>
										<label style={checkRowStyle}>
											<input
												type="checkbox"
												checked={checked}
												disabled={disabled}
												aria-describedby={`cap-hint-${item.key}`}
												onChange={(event) => {
													void patchCapability(item.key, event.target.checked);
												}}
											/>
											<span>
												<span style={{ display: "block" }}>{t(item.label)}</span>
												<span id={`cap-hint-${item.key}`} style={{ display: "block", ...hintStyle }}>
													{t(item.hint)}
												</span>
											</span>
										</label>
									</li>
								);
							})}
						</ul>
						<div style={nestedStyle}>
							<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("capabilityLimitsTitle")}</h4>
							<p style={hintStyle}>{t("capabilityLimitsHint")}</p>
							<ul style={listStyle}>
								{CAPABILITY_LIMITS.map((item) => {
									const displayValue = capabilities.value[item.key] / item.scale;
									const inputId = `cap-limit-${item.key}`;
									return (
										<li key={item.key} style={rowStyle}>
											<label htmlFor={inputId} style={{ ...bodyStyle, flex: "1 1 360px" }}>
												<span style={{ display: "block", color: "var(--dsw-alias-label-primary)" }}>
													{t(item.label)}
												</span>
												<span id={`${inputId}-hint`} style={{ display: "block", ...hintStyle }}>
													{t(item.hint)}
												</span>
											</label>
											<input
												key={`${item.key}-${String(capabilities.revision)}-${String(displayValue)}`}
												id={inputId}
												type="number"
												inputMode="numeric"
												min={item.min}
												max={item.max}
												step={1}
												defaultValue={displayValue}
												disabled={capabilitiesBusy || !capabilities.writable}
												aria-describedby={`${inputId}-hint`}
												style={{ ...inputStyle, width: 112, flex: "0 0 112px" }}
												onInput={(event) => event.currentTarget.setCustomValidity("")}
												onKeyDown={(event) => {
													if (event.key === "Enter") event.currentTarget.blur();
													if (event.key === "Escape") {
														event.currentTarget.value = String(displayValue);
														event.currentTarget.setCustomValidity("");
													}
												}}
												onBlur={(event) => {
													const target = event.currentTarget;
													const next = Number(target.value);
													if (!Number.isInteger(next) || next < item.min || next > item.max) {
														target.setCustomValidity(t("capabilityLimitInvalid", { min: item.min, max: item.max }));
														target.reportValidity();
														return;
													}
													target.setCustomValidity("");
													const apiValue = next * item.scale;
													if (apiValue === capabilities.value[item.key]) return;
													void patchCapability(item.key, apiValue).then((saved) => {
														if (!saved && target.isConnected) target.value = String(displayValue);
													});
												}}
											/>
										</li>
									);
								})}
							</ul>
						</div>
					</fieldset>
				)}
			</section>
			{showUsage ? (
				<section style={cardStyle} aria-labelledby="coding-oauth-usage-title">
					<h3 id="coding-oauth-usage-title" style={{ ...titleStyle, fontSize: 16 }}>
						{t("usageTitle")}
					</h3>
					{usageError === undefined ? null : (
						<p style={errorStyle} role="alert">
							{usageError}
						</p>
					)}
					{usageLoading && usage === undefined ? (
						<div style={statusStyle} role="status">
							<span aria-hidden="true" style={dotStyle("loading")} />
							{t("usageLoading")}
						</div>
					) : usageError !== undefined ? null : usage === undefined || !usageHasVisibleFields(usage) ? (
						<p style={bodyStyle}>{t("usageEmpty")}</p>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							{formatEpoch(usage.fetchedAt) === undefined ? null : (
								<p style={hintStyle}>{t("usageFetchedAt", { time: formatEpoch(usage.fetchedAt) })}</p>
							)}
							{usage.rateLimits.map((limit) => (
								<div key={limit.id} style={nestedStyle}>
									<p style={{ ...bodyStyle, color: "var(--dsw-alias-label-primary)" }}>
										{limit.name ?? t("usageRateLimit")}
									</p>
									{limit.windows.map((window, index) => {
										const reset = formatEpoch(window.resetsAt);
										return (
											<p key={`${limit.id}-${String(index)}`} style={hintStyle}>
												{window.windowSeconds === undefined
													? null
													: `${t("usageWindow", { seconds: window.windowSeconds })} · `}
												{window.usedPercent === undefined
													? null
													: `${t("usageUsed", { value: `${String(window.usedPercent)}%` })} · `}
												{window.remainingPercent === undefined
													? null
													: `${t("usageRemaining", { value: `${String(window.remainingPercent)}%` })}`}
												{reset === undefined ? null : ` · ${t("usageResets", { time: reset })}`}
											</p>
										);
									})}
								</div>
							))}
							{usage.creditsUnlimited === undefined && usage.creditsBalance === undefined ? null : (
								<p style={bodyStyle}>
									{usage.creditsUnlimited === true ? t("usageCreditsUnlimited") : t("usageCreditsLimited")}
									{usage.creditsBalance === undefined ? "" : ` · ${t("usageBalance", { value: usage.creditsBalance })}`}
								</p>
							)}
							{usage.individualLimit === undefined &&
							usage.individualUsed === undefined &&
							usage.individualRemaining === undefined &&
							usage.individualRemainingPercent === undefined ? null : (
								<p style={bodyStyle}>
									{t("usageIndividualLimit")}
									{usage.individualLimit === undefined ? "" : ` · ${t("usageLimit", { value: usage.individualLimit })}`}
									{usage.individualUsed === undefined
										? ""
										: ` · ${t("usageUsedAmount", { value: usage.individualUsed })}`}
									{usage.individualRemaining === undefined
										? ""
										: ` · ${t("usageRemainingAmount", { value: usage.individualRemaining })}`}
									{usage.individualRemainingPercent === undefined
										? ""
										: ` · ${t("usageRemaining", { value: `${String(usage.individualRemainingPercent)}%` })}`}
									{formatEpoch(usage.individualResetsAt) === undefined
										? ""
										: ` · ${t("usageResets", { time: formatEpoch(usage.individualResetsAt) })}`}
								</p>
							)}
							{usage.spendControlReached === true ? <p style={bodyStyle}>{t("usageSpendControlReached")}</p> : null}
							{usage.resetCredits === undefined ? null : (
								<p style={bodyStyle}>{t("usageResetCredits", { value: usage.resetCredits })}</p>
							)}
						</div>
					)}
				</section>
			) : null}
			<section style={cardStyle} aria-labelledby="coding-oauth-imagine-title">
				<div>
					<h3 id="coding-oauth-imagine-title" style={{ ...titleStyle, fontSize: 16 }}>
						{t("imagineTitle")}
					</h3>
					<p style={{ ...bodyStyle, marginTop: 4 }}>{t("imagineIntro")}</p>
				</div>
				{imagineError === undefined ? null : (
					<p style={errorStyle} role="alert">
						{imagineError}
					</p>
				)}
				{imagine === undefined && imagineError === undefined ? (
					<div style={statusStyle} role="status">
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("imagineLoading")}
					</div>
				) : imagine === undefined ? null : (
					<div style={nestedStyle}>
						<p style={statusStyle} role="status">
							<span aria-hidden="true" style={dotStyle(imagine.configured ? "available" : "unavailable")} />
							<span>{imagine.configured ? t("imagineConfigured") : t("imagineNotConfigured")}</span>
						</p>
						<p style={hintStyle}>{t("imagineSource", { source: imagineSourceLabel(imagine.source, t) })}</p>
						<p style={hintStyle}>{imagine.writable === true ? t("imagineWritable") : t("imagineReadOnly")}</p>
					</div>
				)}
			</section>
			{status === undefined ? null : (
				<div style={cardStyle}>
					<div style={rowStyle}>
						<div>
							<h3 style={{ ...titleStyle, fontSize: 16 }}>{t("antigravityTitle")}</h3>
							<p style={{ ...bodyStyle, marginTop: 4 }}>{t("antigravityDescription")}</p>
							<p style={{ ...bodyStyle, marginTop: 4 }}>
								<span style={monoStyle}>{status.antigravity.route}</span>
							</p>
						</div>
						<div style={statusStyle} role="status">
							<span aria-hidden="true" style={dotStyle("signed-out", status.antigravity.installed)} />
							<span>{status.antigravity.installed ? t("antigravityInstalled") : t("antigravityMissing")}</span>
						</div>
					</div>
					<p style={bodyStyle}>{t("antigravityCliHint")}</p>
					<code style={{ ...monoStyle, fontSize: 12, overflowWrap: "anywhere" }}>{t("antigravityCliCommand")}</code>
				</div>
			)}
		</section>
	);
}

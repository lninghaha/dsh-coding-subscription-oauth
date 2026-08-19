/** Shared client types for the Coding OAuth settings UI. */

import type { GrokBuildSettingsKey } from "./locales.ts";

export type ProviderSlug = "grok" | "codex" | "kimi" | "claude";
export type LoginMethod = "pkce" | "device" | "browser";
export type CatalogSource = "live" | "cache" | "fallback";
export type SourceKind = ProviderSlug;
export type SourceReason = "missing" | "unsafe" | "invalid" | "too_large";
export type SourceConflict =
	| "none"
	| "same_credential"
	| "same_account"
	| "different_account"
	| "unknown_account"
	| "unreadable_destination"
	| "unsafe_destination";
export type SourcePreviewAction = "import" | "reuse" | "overwrite" | "blocked";
export type SourceCommitAction = "imported" | "unchanged" | "overwritten";
export type CapabilityFlagKey =
	| "codexSearch"
	| "codexImages"
	| "codexImageEdits"
	| "codexUsage"
	| "codexFast"
	| "grokImagineImage"
	| "grokImagineVideo";
export type CapabilityLimitKey = "searchResults" | "imageCount" | "videoArtifactTtlMs";
export type CapabilitySettingKey = CapabilityFlagKey | CapabilityLimitKey;
export type SettingsTabId = "accounts" | "capabilities" | "gateway" | "about";
export type CopyField = "openai" | "anthropic" | "key";

export type GrokStatus =
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

export type SubscriptionStatus = {
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

export type ProviderStatus = GrokStatus | SubscriptionStatus;

export interface CodingOAuthStatus {
	providers: {
		grok: GrokStatus;
		codex: SubscriptionStatus;
		kimi: SubscriptionStatus;
		claude: SubscriptionStatus;
	};
	antigravity: { installed: boolean; route: "agy"; management: "cli" };
}

export interface LoginChallenge {
	method: LoginMethod;
	url: string;
	userCode?: string;
}

export interface ProviderCardDefinition {
	slug: ProviderSlug;
	route: string;
	titleKey: GrokBuildSettingsKey;
	descriptionKey: GrokBuildSettingsKey;
	methods: readonly LoginMethod[];
	recommended: LoginMethod;
	/** Preferred method when the Settings UI is opened on a remote / non-loopback host. */
	remoteRecommended?: LoginMethod;
}

export interface SourceStatus {
	kind: SourceKind;
	displayPath: string;
	available: boolean;
	expiresAt?: number;
	reason?: SourceReason;
}

export interface SourcePreview {
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

export interface CapabilityFlags {
	codexSearch: boolean;
	codexImages: boolean;
	codexImageEdits: boolean;
	codexUsage: boolean;
	codexFast: boolean;
	grokImagineImage: boolean;
	grokImagineVideo: boolean;
}

export interface CapabilitySettingsView extends CapabilityFlags {
	searchResults: number;
	imageCount: number;
	videoArtifactTtlMs: number;
}

export interface CapabilitySnapshot {
	value: CapabilitySettingsView;
	revision: number;
	writable: boolean;
}

export interface UsageWindowView {
	usedPercent?: number;
	remainingPercent?: number;
	windowSeconds?: number;
	resetsAt?: number;
}

export interface UsageLimitView {
	id: string;
	name?: string;
	windows: UsageWindowView[];
}

export interface UsageView {
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

export interface ImagineCredentialView {
	configured: boolean;
	source?: string;
	writable?: boolean;
}

export interface PluginRequestError extends Error {
	status: number;
	code?: string;
}

export interface GatewayView {
	enabled: boolean;
	running: boolean;
	bind: string;
	port: number;
	keyHint: string;
	warning: string;
}

export interface GrokBuildSettingsInjected {
	t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string;
}

export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>;

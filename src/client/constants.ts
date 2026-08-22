/** Static tables for the Coding OAuth settings UI. */

import type { GrokBuildSettingsKey } from "./locales.ts";
import type {
	CapabilityFlagKey,
	CapabilityLimitKey,
	ProviderCardDefinition,
	SettingsTabId,
	SourceCommitAction,
	SourceConflict,
	SourceKind,
	SourcePreviewAction,
	SourceReason,
} from "./types.ts";

export const STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
export const LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
export const LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
export const LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
export const LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
export const MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
export const SOURCES_PATH = "/plugins/dsh-grok-build/oauth/sources";
export const SOURCES_PREVIEW_PATH = "/plugins/dsh-grok-build/oauth/sources/preview";
export const SOURCES_COMMIT_PATH = "/plugins/dsh-grok-build/oauth/sources/commit";
export const SOURCES_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/sources/cancel";
export const CAPABILITIES_PATH = "/plugins/dsh-grok-build/capabilities";
export const CODEX_USAGE_PATH = "/plugins/dsh-grok-build/codex/usage";
export const IMAGINE_CREDENTIAL_PATH = "/plugins/dsh-grok-build/imagine/credential-status";
export const GATEWAY_PATH = "/plugins/dsh-grok-build/gateway";
export const GATEWAY_REVEAL_PATH = "/plugins/dsh-grok-build/gateway/reveal";
export const GATEWAY_ROTATE_PATH = "/plugins/dsh-grok-build/gateway/rotate";
export const POLL_INTERVAL_MS = 1_000;
export const HOUR_MS = 60 * 60 * 1000;

export const SOURCE_KINDS: readonly SourceKind[] = ["grok", "codex", "kimi", "claude"];
export const SOURCE_REASONS: readonly SourceReason[] = ["missing", "unsafe", "invalid", "too_large"];
export const SOURCE_CONFLICTS: readonly SourceConflict[] = [
	"none",
	"same_credential",
	"same_account",
	"different_account",
	"unknown_account",
	"unreadable_destination",
	"unsafe_destination",
];
export const SOURCE_PREVIEW_ACTIONS: readonly SourcePreviewAction[] = ["import", "reuse", "overwrite", "blocked"];
export const SOURCE_COMMIT_ACTIONS: readonly SourceCommitAction[] = ["imported", "unchanged", "overwritten"];

export const SOURCE_DEFAULT_PATH: { readonly [K in SourceKind]: string } = {
	grok: "~/.grok/auth.json",
	codex: "~/.codex/auth.json",
	kimi: "~/.kimi/credentials/kimi-code.json",
	claude: "~/.claude/.credentials.json",
};

export const SOURCE_KIND_KEY: { readonly [K in SourceKind]: GrokBuildSettingsKey } = {
	grok: "sourceKindGrok",
	codex: "sourceKindCodex",
	kimi: "sourceKindKimi",
	claude: "sourceKindClaude",
};

export const SOURCE_REASON_KEY: { readonly [K in SourceReason]: GrokBuildSettingsKey } = {
	missing: "sourceReasonMissing",
	unsafe: "sourceReasonUnsafe",
	invalid: "sourceReasonInvalid",
	too_large: "sourceReasonTooLarge",
};

export const SOURCE_CONFLICT_KEY: { readonly [K in SourceConflict]: GrokBuildSettingsKey } = {
	none: "sourceConflictNone",
	same_credential: "sourceConflictSameCredential",
	same_account: "sourceConflictSameAccount",
	different_account: "sourceConflictDifferentAccount",
	unknown_account: "sourceConflictUnknownAccount",
	unreadable_destination: "sourceConflictUnreadableDestination",
	unsafe_destination: "sourceConflictUnsafeDestination",
};

export const SOURCE_PREVIEW_ACTION_KEY: { readonly [K in SourcePreviewAction]: GrokBuildSettingsKey } = {
	import: "sourceActionImport",
	reuse: "sourceActionReuse",
	overwrite: "sourceActionOverwrite",
	blocked: "sourceActionBlocked",
};

export const SOURCE_COMMIT_ACTION_KEY: { readonly [K in SourceCommitAction]: GrokBuildSettingsKey } = {
	imported: "sourceCommitImported",
	unchanged: "sourceCommitUnchanged",
	overwritten: "sourceCommitOverwritten",
};

export const CAPABILITY_TOGGLES: readonly {
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

export const CAPABILITY_LIMITS: readonly {
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

export const IMAGINE_SOURCE_KEY: { readonly [source: string]: GrokBuildSettingsKey } = {
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

export const PROVIDERS: readonly ProviderCardDefinition[] = [
	{
		slug: "grok",
		route: "grok-build",
		titleKey: "grokTitle",
		descriptionKey: "grokDescription",
		methods: ["pkce", "device"],
		recommended: "pkce",
		remoteRecommended: "device",
	},
	{
		slug: "codex",
		route: "codex-oauth",
		titleKey: "codexTitle",
		descriptionKey: "codexDescription",
		methods: ["device", "browser"],
		recommended: "device",
		remoteRecommended: "device",
	},
	{
		slug: "kimi",
		route: "kimi-code-oauth",
		titleKey: "kimiTitle",
		descriptionKey: "kimiDescription",
		methods: ["device"],
		recommended: "device",
		remoteRecommended: "device",
	},
	{
		slug: "claude",
		route: "claude-code-oauth",
		titleKey: "claudeTitle",
		descriptionKey: "claudeDescription",
		methods: ["browser"],
		recommended: "browser",
		remoteRecommended: "browser",
	},
];

export const SETTINGS_TABS: readonly { id: SettingsTabId; label: GrokBuildSettingsKey }[] = [
	{ id: "accounts", label: "tabAccounts" },
	{ id: "gateway", label: "tabGateway" },
	{ id: "capabilities", label: "tabCapabilities" },
	{ id: "about", label: "tabAbout" },
];

export const GATEWAY_PORT_MIN = 1024;
export const GATEWAY_PORT_MAX = 65_535;
export const GATEWAY_RANDOM_PORT_MIN = 18_100;
export const GATEWAY_RANDOM_PORT_MAX = 18_999;
export const GATEWAY_RANDOM_RESERVED = new Set([22, 53, 3080, 7890, 9090, 18_080]);

export const CONSUMED_PREVIEW_CODES = new Set([
	"preview_invalid",
	"preview_expired",
	"source_changed",
	"destination_changed",
	"confirm_required",
	"unsafe_destination",
]);

export const PLUGIN_VERSION = "0.5.7";

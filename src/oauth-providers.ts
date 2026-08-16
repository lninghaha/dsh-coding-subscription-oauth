/**
 * Native pi-ai OAuth providers and their stable Harness route aliases.
 * @module dsh-coding-subscription-oauth/oauth-providers
 */

import type { Api, ApiKeyAuth, Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
	CLAUDE_CODE_OAUTH_AUTH_FILENAME,
	CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
	CLAUDE_CODE_OAUTH_ROUTE,
	CLAUDE_PI_PROVIDER,
	CODEX_OAUTH_AUTH_FILENAME,
	CODEX_OAUTH_MODELS_CACHE_FILENAME,
	CODEX_OAUTH_ROUTE,
	CODEX_PI_PROVIDER,
	type CodingOAuthProviderSlug,
	KIMI_CODE_OAUTH_AUTH_FILENAME,
	KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME,
	KIMI_CODE_OAUTH_ROUTE,
	KIMI_PI_PROVIDER,
} from "./ids.ts";

export type SubscriptionProviderSlug = Exclude<CodingOAuthProviderSlug, "grok">;
export type SubscriptionLoginMethod = "browser" | "device";

export interface OAuthProviderDefinition {
	slug: SubscriptionProviderSlug;
	route: string;
	nativeProviderId: string;
	displayName: string;
	authFilename: string;
	modelsCacheFilename: string;
	loginMethods: readonly SubscriptionLoginMethod[];
	recommendedLoginMethod: SubscriptionLoginMethod;
	providerFactory(): Provider<Api>;
	requestProvider(selectedIds?: readonly string[]): Provider<Api>;
}

function requestTokenAuth(name: string, bearerHeader: boolean): ApiKeyAuth {
	return {
		name,
		resolve: async ({ credential }) => {
			const token = credential?.key?.trim();
			if (token === undefined || token.length === 0) return undefined;
			return bearerHeader
				? { auth: { headers: { Authorization: `Bearer ${token}` } }, source: "OAuth bridge" }
				: { auth: { apiKey: token }, source: "OAuth bridge" };
		},
	};
}

function selectedProvider(
	base: Provider<Api>,
	selectedIds: readonly string[] | undefined,
	apiKey: ApiKeyAuth | undefined,
): Provider<Api> {
	const selected = selectedIds === undefined || selectedIds.length === 0 ? undefined : new Set(selectedIds);
	return {
		...base,
		auth: apiKey === undefined ? base.auth : { ...base.auth, apiKey },
		getModels: () => {
			const models = base.getModels();
			return selected === undefined ? models : models.filter((model) => selected.has(model.id));
		},
	};
}

/** Remove the transport-only `apiKey` carrier without reintroducing it as an explicit undefined. */
function withoutApiKey<T extends { apiKey?: unknown }>(options: T): T {
	const { apiKey: _dropped, ...rest } = options;
	return rest as T;
}

/**
 * PiAiAdapter's api-key resolver seam necessarily populates `options.apiKey`.
 * Kimi OAuth is header-owned Bearer auth, so remove that transport-only carrier
 * after Models has derived Authorization and before the Anthropic client sees
 * it (otherwise the SDK also emits an invalid x-api-key header).
 */
function stripApiKeyBeforeStream(provider: Provider<Api>): Provider<Api> {
	return {
		...provider,
		stream: (model, context, options) =>
			provider.stream(model, context, options === undefined ? undefined : withoutApiKey(options)),
		streamSimple: (model, context, options) =>
			provider.streamSimple(model, context, options === undefined ? undefined : withoutApiKey(options)),
	};
}

function asProvider(factory: () => Provider): () => Provider<Api> {
	return factory as () => Provider<Api>;
}

const createCodexProvider = asProvider(openaiCodexProvider);
const createKimiProvider = asProvider(kimiCodingProvider);
const createClaudeProvider = asProvider(anthropicProvider);

export const CODEX_OAUTH_PROVIDER: OAuthProviderDefinition = {
	slug: "codex",
	route: CODEX_OAUTH_ROUTE,
	nativeProviderId: CODEX_PI_PROVIDER,
	displayName: "OpenAI Codex (ChatGPT Plus/Pro)",
	authFilename: CODEX_OAUTH_AUTH_FILENAME,
	modelsCacheFilename: CODEX_OAUTH_MODELS_CACHE_FILENAME,
	loginMethods: ["device", "browser"],
	recommendedLoginMethod: "device",
	providerFactory: createCodexProvider,
	requestProvider: (selectedIds) =>
		selectedProvider(createCodexProvider(), selectedIds, requestTokenAuth("OpenAI Codex OAuth token", false)),
};

export const KIMI_CODE_OAUTH_PROVIDER: OAuthProviderDefinition = {
	slug: "kimi",
	route: KIMI_CODE_OAUTH_ROUTE,
	nativeProviderId: KIMI_PI_PROVIDER,
	displayName: "Kimi Code (subscription)",
	authFilename: KIMI_CODE_OAUTH_AUTH_FILENAME,
	modelsCacheFilename: KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME,
	loginMethods: ["device"],
	recommendedLoginMethod: "device",
	providerFactory: createKimiProvider,
	requestProvider: (selectedIds) =>
		stripApiKeyBeforeStream(
			selectedProvider(createKimiProvider(), selectedIds, requestTokenAuth("Kimi Code OAuth token", true)),
		),
};

export const CLAUDE_CODE_OAUTH_PROVIDER: OAuthProviderDefinition = {
	slug: "claude",
	route: CLAUDE_CODE_OAUTH_ROUTE,
	nativeProviderId: CLAUDE_PI_PROVIDER,
	displayName: "Claude Code (Pro/Max)",
	authFilename: CLAUDE_CODE_OAUTH_AUTH_FILENAME,
	modelsCacheFilename: CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
	loginMethods: ["browser"],
	recommendedLoginMethod: "browser",
	providerFactory: createClaudeProvider,
	requestProvider: (selectedIds) => selectedProvider(createClaudeProvider(), selectedIds, undefined),
};

export const OAUTH_PROVIDER_DEFINITIONS = [
	CODEX_OAUTH_PROVIDER,
	KIMI_CODE_OAUTH_PROVIDER,
	CLAUDE_CODE_OAUTH_PROVIDER,
] as const;

export function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined {
	return OAUTH_PROVIDER_DEFINITIONS.find((provider) => provider.slug === slug);
}

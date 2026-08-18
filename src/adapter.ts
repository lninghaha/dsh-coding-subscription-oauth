/** Coding-subscription adapter assembled from public dsh-llm-pi-ai extension points. */

import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { RetryPolicyConfig } from "@deepseek-ai/dsh-llm";
import { type LlmAdapter, LlmError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type { ResolvedPiAiProviderProfile } from "@deepseek-ai/dsh-llm-pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import type { AliasLlmRoutePolicy } from "./alias-adapter.ts";
import { AliasLlmAdapter } from "./alias-adapter.ts";
import { preferredGrokBuildModelFrom } from "./catalog.ts";
import { withCodexFastRouting } from "./codex-model-capabilities.ts";
import {
	CLAUDE_CODE_OAUTH_ROUTE,
	CLAUDE_PI_PROVIDER,
	CODEX_OAUTH_FAST_ROUTE,
	CODEX_OAUTH_ROUTE,
	CODEX_PI_PROVIDER,
	DEFAULT_GROK_BUILD_MODEL,
	GROK_BUILD_ROUTE,
	GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
	KIMI_CODE_OAUTH_ROUTE,
	KIMI_PI_PROVIDER,
	XAI_PI_PROVIDER,
} from "./ids.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import { grokBuildBaselineModels, grokBuildFingerprintHeaders } from "./provider.ts";
import { safeMessage } from "./redact.ts";
import type { GrokBuildSession } from "./session.ts";

/** Prefer grok-4.6 when the current (live or baseline) list has it. */
export function preferredGrokBuildModel(models: readonly { id: string }[] = grokBuildBaselineModels()): string {
	return preferredGrokBuildModelFrom(models.length === 0 ? [{ id: DEFAULT_GROK_BUILD_MODEL }] : models);
}

function missingCredential(name: string): never {
	throw new LlmError(
		`${name} is not signed in. Open Settings → Coding OAuth and sign in with your subscription.`,
		"MISSING_CREDENTIAL",
	);
}

/**
 * Minimum remaining validity demanded of an exported OAuth access token.
 * pi-ai 0.84+ already refreshes five minutes before the stored expiry; this
 * explicit floor documents the plugin contract and hard-fails a refresh that
 * returns an even-shorter-lived token instead of handing it to a request.
 */
const MIN_OAUTH_VALIDITY_MS = 60_000;

/**
 * Provider retry policy for the coding-subscription routes. The harness
 * default retryable set (EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT)
 * deliberately excludes AUTH, so an upstream 401 — e.g. an access token the
 * server revoked before its local expiry — used to kill the turn outright.
 * AUTH is added here because {@link AliasLlmAdapter} invalidates the stored
 * credential on every AUTH finish, so the retried step refreshes first and
 * does not repeat the same rejected token. Quota exhaustion stays outside the
 * set: retrying a billing-limit 403 cannot succeed and only delays the real
 * message. Genuine credential death is converted to MISSING_CREDENTIAL (not
 * retryable) by the resolver below, so it cannot loop either.
 */
const CODING_OAUTH_RETRY_POLICY = {
	mode: "normal" as const,
	maxRetries: 2,
	retryableCodes: ["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "AUTH"],
	backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 },
};

function profile(
	provider: string,
	displayName: string,
	piProvider: ResolvedPiAiProviderProfile["piProvider"],
	retryPolicy?: RetryPolicyConfig | undefined,
	headers?: Record<string, string> | undefined,
): ResolvedPiAiProviderProfile {
	return {
		provider,
		displayName,
		streamIdleTimeoutMs: GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(
			retryPolicy ?? CODING_OAUTH_RETRY_POLICY,
			"dsh-coding-subscription-oauth retryPolicy",
		),
		configuredMaxTokens: new Map(),
		...(headers === undefined ? {} : { headers }),
		piProvider,
	};
}

/** Dedicated Grok Build adapter for hosts that only compose that route. */
export function createGrokBuildAdapter(
	session: GrokBuildSession,
	resolveAttachments: () => AttachmentStore | undefined,
): PiAiAdapter {
	return new PiAiAdapter({
		profiles: () =>
			new Map<string, ResolvedPiAiProviderProfile>([
				[
					GROK_BUILD_ROUTE,
					profile(GROK_BUILD_ROUTE, "xAI Grok Build", session.provider(), undefined, grokBuildFingerprintHeaders()),
				],
			]),
		resolveApiKey: async () =>
			resolveOAuthToken("Grok Build", async () => {
				const auth = await session.models.getAuth(XAI_PI_PROVIDER, { minOAuthValidityMs: MIN_OAUTH_VALIDITY_MS });
				return auth?.auth.apiKey;
			}),
		resolveAttachments,
	});
}

/** Opt-in Codex Fast wiring; ordinary `codex-oauth` is unchanged when this is omitted. */
export interface CodingOAuthAdapterOptions {
	retryPolicy?: RetryPolicyConfig;
	codexFast?: { isEligible(modelId: string): boolean };
}

function isRetryPolicyConfig(value: object): value is RetryPolicyConfig {
	return "mode" in value;
}

function splitCodingOAuthAdapterArgs(
	fourth?: RetryPolicyConfig | CodingOAuthAdapterOptions,
	fifth?: CodingOAuthAdapterOptions,
): CodingOAuthAdapterOptions {
	if (fifth !== undefined) {
		return {
			...(fourth !== undefined && isRetryPolicyConfig(fourth) ? { retryPolicy: fourth } : {}),
			...fifth,
		};
	}
	if (fourth === undefined) return {};
	if (isRetryPolicyConfig(fourth)) return { retryPolicy: fourth };
	return {
		...(fourth.retryPolicy === undefined ? {} : { retryPolicy: fourth.retryPolicy }),
		...(fourth.codexFast === undefined ? {} : { codexFast: fourth.codexFast }),
	};
}

/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
export function createCodingOAuthAdapter(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
	resolveAttachments: () => AttachmentStore | undefined,
	retryPolicy?: RetryPolicyConfig,
	options?: CodingOAuthAdapterOptions,
): LlmAdapter;
export function createCodingOAuthAdapter(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
	resolveAttachments: () => AttachmentStore | undefined,
	options?: CodingOAuthAdapterOptions,
): LlmAdapter;
export function createCodingOAuthAdapter(
	grok: GrokBuildSession,
	subscriptions: readonly OAuthProviderSession[],
	resolveAttachments: () => AttachmentStore | undefined,
	retryPolicyOrOptions?: RetryPolicyConfig | CodingOAuthAdapterOptions,
	options?: CodingOAuthAdapterOptions,
): LlmAdapter {
	const { retryPolicy, codexFast } = splitCodingOAuthAdapterArgs(retryPolicyOrOptions, options);
	const byNativeId = new Map(subscriptions.map((session) => [session.definition.nativeProviderId, session]));
	const codexSession = byNativeId.get(CODEX_PI_PROVIDER);
	const aliases = new Map<string, string>([
		[GROK_BUILD_ROUTE, GROK_BUILD_ROUTE],
		[CODEX_OAUTH_ROUTE, CODEX_PI_PROVIDER],
		[KIMI_CODE_OAUTH_ROUTE, KIMI_PI_PROVIDER],
		[CLAUDE_CODE_OAUTH_ROUTE, CLAUDE_PI_PROVIDER],
	]);
	if (codexFast !== undefined && codexSession !== undefined) {
		aliases.set(CODEX_OAUTH_FAST_ROUTE, CODEX_OAUTH_FAST_ROUTE);
	}
	const policies = new Map<string, AliasLlmRoutePolicy>([
		[
			GROK_BUILD_ROUTE,
			{
				displayName: "xAI Grok Build (OAuth)",
				isAuthenticated: async () => (await grok.store.read(XAI_PI_PROVIDER))?.type === "oauth",
				onAuthFailure: () => grok.invalidateAccessToken(),
			},
		],
	]);
	for (const session of subscriptions) {
		policies.set(session.definition.route, {
			displayName: `${session.definition.displayName.replace(/\s*\([^)]*\)$/u, "")} (OAuth)`,
			isAuthenticated: async () => (await session.status()).authenticated,
			onAuthFailure: () => session.invalidateAccessToken(),
		});
	}
	if (codexFast !== undefined && codexSession !== undefined) {
		policies.set(CODEX_OAUTH_FAST_ROUTE, {
			displayName: "OpenAI Codex Fast requested (OAuth)",
			isAuthenticated: async () => (await codexSession.status()).authenticated,
			includeModel: (modelId) => codexFast.isEligible(modelId),
			onAuthFailure: () => codexSession.invalidateAccessToken(),
		});
	}

	const inner = new PiAiAdapter({
		profiles: () => {
			const profiles = new Map<string, ResolvedPiAiProviderProfile>();
			profiles.set(
				GROK_BUILD_ROUTE,
				profile(GROK_BUILD_ROUTE, "xAI Grok Build", grok.provider(), retryPolicy, grokBuildFingerprintHeaders()),
			);
			for (const session of subscriptions) {
				profiles.set(
					session.definition.nativeProviderId,
					profile(session.definition.nativeProviderId, session.definition.displayName, session.provider(), retryPolicy),
				);
			}
			if (codexFast !== undefined && codexSession !== undefined) {
				const wrapped = withCodexFastRouting(codexSession.provider(), {
					isEligible: (modelId) => codexFast.isEligible(modelId),
					profileProviderId: CODEX_OAUTH_FAST_ROUTE,
					nativeProviderId: CODEX_PI_PROVIDER,
				});
				// Models.streamSimple dispatches on model.provider. Advertise the Fast
				// profile id on the catalog so the wrapper runs, then restore native
				// identity inside withCodexFastRouting before the wire call.
				const fastProvider = {
					...wrapped,
					getModels: () =>
						wrapped
							.getModels()
							.map((model) =>
								model.provider === CODEX_OAUTH_FAST_ROUTE ? model : { ...model, provider: CODEX_OAUTH_FAST_ROUTE },
							),
				};
				profiles.set(
					CODEX_OAUTH_FAST_ROUTE,
					profile(
						CODEX_OAUTH_FAST_ROUTE,
						"OpenAI Codex Fast requested",
						fastProvider as unknown as ResolvedPiAiProviderProfile["piProvider"],
						retryPolicy,
					),
				);
			}
			return profiles;
		},
		resolveApiKey: async (provider) => {
			if (provider === GROK_BUILD_ROUTE) {
				return resolveOAuthToken("Grok Build", async () => {
					const auth = await grok.models.getAuth(XAI_PI_PROVIDER, { minOAuthValidityMs: MIN_OAUTH_VALIDITY_MS });
					return auth?.auth.apiKey;
				});
			}
			const session =
				provider === CODEX_OAUTH_FAST_ROUTE ? byNativeId.get(CODEX_PI_PROVIDER) : byNativeId.get(provider);
			if (session === undefined) throw new LlmError(`Unknown OAuth provider "${provider}"`, "NO_ADAPTER");
			return resolveOAuthToken(session.definition.displayName, () => session.resolveAccessToken());
		},
		resolveAttachments,
	});

	return new AliasLlmAdapter(inner, aliases, policies);
}

/**
 * Resolve an OAuth access token for one route, translating a failed refresh
 * (revoked refresh token, dead grant) into MISSING_CREDENTIAL so the failure
 * is not retried and the user is told to sign in again rather than shown a
 * bare upstream 401.
 */
async function resolveOAuthToken(
	displayName: string,
	getAccessToken: () => Promise<string | undefined>,
): Promise<string> {
	let accessToken: string | undefined;
	try {
		accessToken = await getAccessToken();
	} catch (error) {
		throw new LlmError(
			`${displayName} could not refresh its sign-in (${safeMessage(error)}).` +
				" Open Settings → Coding OAuth and sign in again.",
			"MISSING_CREDENTIAL",
		);
	}
	if (accessToken === undefined || accessToken.length === 0) return missingCredential(displayName);
	return accessToken;
}

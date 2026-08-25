/**
 * Harness route aliases over a native-id PiAiAdapter.
 * @module dsh-coding-subscription-oauth/alias-adapter
 */

import type {
	GenerateOptions,
	LlmModelInfo,
	LlmProviderInfo,
	LlmResolvedModelInfo,
	ResolvedRetryPolicy,
	StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import { remapXaiCapacityFailure } from "./grok-errors.ts";
import { remapAuthFailureIfContextOverflow } from "./kimi-errors.ts";

export interface AliasLlmRoutePolicy {
	/** User-facing provider name shown above models in the model selector. */
	displayName?: string;
	/** Return false to hide every model for this route from discovery. */
	isAuthenticated?: () => Promise<boolean>;
	/**
	 * After authentication, keep only models this predicate accepts.
	 * Used by opt-in routes (e.g. Codex Fast) so ineligible ids stay hidden
	 * without hiding the whole authenticated catalog.
	 */
	includeModel?: (modelId: string) => boolean;
	/**
	 * Called once when a stream for this route finishes with an AUTH failure
	 * (upstream rejected a locally-valid token). Implementations backdate the
	 * stored credential's expiry so the retried step refreshes before reuse.
	 * Awaiting it here keeps invalidation ordered before the retry executor
	 * reruns the step; failures are swallowed so the original AUTH surfaces.
	 */
	onAuthFailure?: () => Promise<void>;
}

export function normalizeReplayForRoute(
	message: GenerateOptions["messages"][number],
	route: string,
	nativeReplayProvider: string,
): GenerateOptions["messages"][number] {
	if (message.role !== "assistant" || message.source.kind !== "model") return message;
	if (message.source.provider !== route) {
		if (message.source.replayState === undefined) return message;
		const { replayState: _foreignReplay, ...source } = message.source;
		return { ...message, source };
	}
	// The rc.2 envelope stays entirely opaque. PiAiAdapter only keys replay
	// validation from source.provider, so restore the native provider identity
	// without inspecting or changing replayState.
	return { ...message, source: { ...message.source, provider: nativeReplayProvider } };
}

/**
 * Keeps pi-ai model.provider identities native while exposing collision-free
 * Harness route names. Every public operation translates exactly once.
 */
export class AliasLlmAdapter extends LlmAdapter {
	constructor(
		private readonly inner: LlmAdapter,
		private readonly aliases: ReadonlyMap<string, string>,
		private readonly policies: ReadonlyMap<string, AliasLlmRoutePolicy> = new Map(),
		private readonly replayProviders: ReadonlyMap<string, string> = aliases,
	) {
		super();
	}

	private nativeProvider(route: string): string {
		const provider = this.aliases.get(route);
		if (provider === undefined) throw new LlmError(`OAuth adapter does not own provider "${route}"`, "NO_ADAPTER");
		return provider;
	}

	providerInfo(provider: string): LlmProviderInfo {
		const native = this.nativeProvider(provider);
		const info = this.inner.providerInfo(native);
		const displayName = this.policies.get(provider)?.displayName;
		return { ...info, id: provider, ...(displayName === undefined ? {} : { name: displayName }) };
	}

	providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
		return this.inner.providerRetryPolicy(this.nativeProvider(provider));
	}

	async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
		const native = this.nativeProvider(provider);
		const isAuthenticated = this.policies.get(provider)?.isAuthenticated;
		if (isAuthenticated !== undefined) {
			try {
				if (!(await isAuthenticated())) return [];
			} catch {
				// A corrupt/unreadable credential must hide models instead of breaking
				// the entire model picker or presenting a route that cannot be used.
				return [];
			}
		}
		const listed = (await this.inner.listModels(native)).map((model) => ({ ...model, provider }));
		const includeModel = this.policies.get(provider)?.includeModel;
		return includeModel === undefined ? listed : listed.filter((model) => includeModel(model.id));
	}

	async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
		const native = this.nativeProvider(provider);
		return { ...(await this.inner.resolveModel(native, model, signal)), provider };
	}

	async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
		const route = options.provider;
		const native = this.nativeProvider(route);
		const messages = options.messages.map((message) =>
			normalizeReplayForRoute(message, route, this.replayProviders.get(route) ?? native),
		);
		let authFailureNotified = false;
		for await (const raw of this.inner.stream({ ...options, provider: native, messages })) {
			const chunk =
				raw.type === "finish" && raw.reason.kind === "error"
					? {
							...raw,
							reason: {
								...raw.reason,
								failure: remapXaiCapacityFailure(remapAuthFailureIfContextOverflow(raw.reason.failure)),
							},
						}
					: raw;
			if (
				!authFailureNotified &&
				chunk.type === "finish" &&
				chunk.reason.kind === "error" &&
				chunk.reason.failure.code === "AUTH"
			) {
				authFailureNotified = true;
				const onAuthFailure = this.policies.get(route)?.onAuthFailure;
				if (onAuthFailure !== undefined) {
					try {
						await onAuthFailure();
					} catch {
						// Invalidation is best-effort: the original AUTH failure must
						// surface unchanged even when the credential store is unreadable.
					}
				}
			}
			yield chunk;
		}
	}
}

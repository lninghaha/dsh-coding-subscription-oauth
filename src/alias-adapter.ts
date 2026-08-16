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

export interface AliasLlmRoutePolicy {
	/** User-facing provider name shown above models in the model selector. */
	displayName?: string;
	/** Return false to hide every model for this route from discovery. */
	isAuthenticated?: () => Promise<boolean>;
	/**
	 * Called once when a stream for this route finishes with an AUTH failure
	 * (upstream rejected a locally-valid token). Implementations backdate the
	 * stored credential's expiry so the retried step refreshes before reuse.
	 * Awaiting it here keeps invalidation ordered before the retry executor
	 * reruns the step; failures are swallowed so the original AUTH surfaces.
	 */
	onAuthFailure?: () => Promise<void>;
}

function routePiAiReplayState(value: unknown, route: string): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const state = value as Record<string, unknown>;
	if (state["kind"] !== "pi-ai" || state["provider"] === route) return value;
	return { ...state, provider: route };
}

function normalizeReplayForRoute(
	message: GenerateOptions["messages"][number],
	route: string,
): GenerateOptions["messages"][number] {
	if (message.role !== "assistant" || message.source.kind !== "model") return message;
	if (message.source.provider !== route) {
		if (message.source.replayState === undefined) return message;
		const { replayState: _foreignReplay, ...source } = message.source;
		return { ...message, source };
	}
	const replayState = routePiAiReplayState(message.source.replayState, route);
	if (replayState === message.source.replayState) return message;
	return { ...message, source: { ...message.source, replayState } };
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
		return (await this.inner.listModels(native)).map((model) => ({ ...model, provider }));
	}

	async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
		const native = this.nativeProvider(provider);
		return { ...(await this.inner.resolveModel(native, model, signal)), provider };
	}

	async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
		const route = options.provider;
		const native = this.nativeProvider(route);
		const messages = options.messages.map((message) => normalizeReplayForRoute(message, route));
		let authFailureNotified = false;
		for await (const chunk of this.inner.stream({ ...options, provider: native, messages })) {
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
			if (chunk.type === "finish" && chunk.replayState !== undefined) {
				yield { ...chunk, replayState: routePiAiReplayState(chunk.replayState, route) };
			} else {
				yield chunk;
			}
		}
	}
}

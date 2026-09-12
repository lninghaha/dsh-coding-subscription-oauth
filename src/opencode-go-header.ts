import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { type GenerateOptions, LlmError, type StreamChunk } from "@deepseek-ai/dsh-llm";

const GO_PATHS = new Set(["/zen/go/v1/chat/completions", "/zen/go/v1/responses", "/zen/go/v1/messages"]);
export type OpenCodeGoCallResult = "no-call" | "success" | "failure" | "missing-session";
export interface OpenCodeGoStatus {
	active: boolean;
	lastCall: OpenCodeGoCallResult;
	httpStatus: "no-call" | "accepted" | "rejected" | "network-error";
	streamStatus: "no-call" | "completed" | "failed" | "cancelled" | "missing-session";
	updatedAt: number | null;
	pending?: boolean;
	configurationConflict?: boolean;
}

/** 每次 LLM 调用单独关联 HTTP 与流终态，迟到调用不覆盖新的状态。 */
export class OpenCodeGoHeaderState {
	private generation = 0;
	private value: OpenCodeGoStatus = {
		active: false,
		lastCall: "no-call",
		httpStatus: "no-call",
		streamStatus: "no-call",
		updatedAt: null,
		pending: false,
		configurationConflict: false,
	};
	snapshot(): OpenCodeGoStatus {
		return { ...this.value };
	}
	setActive(active: boolean): void {
		this.value.active = active;
		if (!active) this.value.pending = false;
	}
	invalidate(): void {
		this.begin();
		this.value.pending = false;
	}
	begin(): number {
		this.value = {
			active: this.value.active,
			lastCall: "no-call",
			httpStatus: "no-call",
			streamStatus: "no-call",
			updatedAt: Date.now(),
			pending: true,
			configurationConflict: false,
		};
		return ++this.generation;
	}
	recordHttp(result: OpenCodeGoStatus["httpStatus"], call = this.generation): void {
		if (call !== this.generation) return;
		this.value.httpStatus = result;
		if (result !== "accepted") this.value.lastCall = "failure";
		this.value.updatedAt = Date.now();
	}
	recordStream(result: OpenCodeGoStatus["streamStatus"], call = this.generation): void {
		if (call !== this.generation) return;
		this.value.streamStatus = result;
		this.value.pending = false;
		this.value.lastCall =
			result === "completed" && this.value.httpStatus === "accepted"
				? "success"
				: result === "missing-session"
					? "missing-session"
					: "failure";
		this.value.updatedAt = Date.now();
	}
	conflict(call: number): void {
		if (call === this.generation) this.value.configurationConflict = true;
		this.recordStream("failed", call);
	}
}
interface CallContext {
	sessionId: string;
	call: number;
	signal?: AbortSignal;
}
function targetRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
	const method = init?.method ?? (input instanceof Request ? input.method : "GET");
	if (method.toUpperCase() !== "POST") return false;
	try {
		const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
		return url.origin === "https://opencode.ai" && GO_PATHS.has(url.pathname);
	} catch {
		return false;
	}
}
function scopedIterable(
	storage: AsyncLocalStorage<CallContext>,
	context: CallContext,
	iterable: AsyncIterable<StreamChunk>,
	state: OpenCodeGoHeaderState,
): AsyncIterable<StreamChunk> {
	const iterator = storage.run(context, () => iterable[Symbol.asyncIterator]());
	let terminal = false;
	const failed = (error: unknown) => {
		terminal = true;
		state.recordStream(
			context.signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "failed",
			context.call,
		);
	};
	const wrapped: AsyncIterableIterator<StreamChunk> = {
		[Symbol.asyncIterator]() {
			return this;
		},
		async next(value?: unknown) {
			try {
				const result = await storage.run(context, () => iterator.next(value));
				if (!result.done && result.value.type === "finish") {
					terminal = true;
					const kind = result.value.reason.kind;
					state.recordStream(
						kind === "aborted"
							? "cancelled"
							: ["stop", "tool-calls", "max-tokens"].includes(kind)
								? "completed"
								: "failed",
						context.call,
					);
				} else if (result.done && !terminal) {
					terminal = true;
					state.recordStream(context.signal?.aborted ? "cancelled" : "failed", context.call);
				}
				return result;
			} catch (error) {
				failed(error);
				throw error;
			}
		},
		async throw(error?: unknown) {
			failed(error);
			return storage.run(context, () =>
				typeof iterator.throw === "function" ? iterator.throw(error) : Promise.reject(error),
			);
		},
		return(value?: unknown) {
			if (!terminal) {
				terminal = true;
				state.recordStream("cancelled", context.call);
			}
			return storage.run(context, () =>
				typeof iterator.return === "function" ? iterator.return(value) : Promise.resolve({ done: true, value }),
			);
		},
	};
	return wrapped;
}

export function installOpenCodeGoHeaderCompatibility(ctx: Context, state: OpenCodeGoHeaderState): () => void {
	if (typeof (ctx as { on?: unknown }).on !== "function") return () => undefined;
	const storage = new AsyncLocalStorage<CallContext>();
	const previousFetch = globalThis.fetch;
	let disposed = false;
	let releaseListener: (() => unknown) | undefined;
	const wrappedFetch: typeof fetch = async (input, init) => {
		const context = storage.getStore();
		if (disposed || context === undefined || !targetRequest(input, init)) return previousFetch(input, init);
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		const existing = headers.get("x-opencode-session");
		if (existing !== null && existing !== context.sessionId) {
			state.conflict(context.call);
			throw new LlmError(
				"The configured OpenCode Go session header conflicts with this conversation. Remove the static session header in Accounts & Models.",
				"OPENCODE_SESSION_CONFLICT",
			);
		}
		if (existing === null) headers.set("x-opencode-session", context.sessionId);
		try {
			const response = await previousFetch(input, { ...init, headers });
			state.recordHttp(response.ok ? "accepted" : "rejected", context.call);
			return response;
		} catch (error) {
			state.recordHttp("network-error", context.call);
			throw error;
		}
	};
	const release = () => {
		if (disposed) return;
		disposed = true;
		try {
			releaseListener?.();
		} finally {
			if (globalThis.fetch === wrappedFetch) globalThis.fetch = previousFetch;
			storage.disable();
			state.setActive(false);
		}
	};
	try {
		globalThis.fetch = wrappedFetch;
		releaseListener = ctx.on(
			"llm/stream",
			(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
				if (disposed || options.provider !== "opencode-go") return next();
				const call = state.begin();
				if (typeof options.sessionId !== "string" || options.sessionId.length === 0) {
					state.recordStream("missing-session", call);
					throw new LlmError(
						"OpenCode Go requires the DSH session identity. Return to the conversation and retry.",
						"MISSING_SESSION",
					);
				}
				const context: CallContext = {
					sessionId: options.sessionId,
					call,
					...(options.signal === undefined ? {} : { signal: options.signal }),
				};
				try {
					return scopedIterable(storage, context, storage.run(context, next), state);
				} catch (error) {
					state.recordStream(options.signal?.aborted ? "cancelled" : "failed", call);
					throw error;
				}
			},
			{ global: true, prepend: true },
		);
		state.setActive(true);
		return release;
	} catch (error) {
		release();
		throw error;
	}
}

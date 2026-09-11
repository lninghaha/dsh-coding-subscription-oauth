import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { type GenerateOptions, LlmError, type StreamChunk } from "@deepseek-ai/dsh-llm";

const GO_ORIGIN = "https://opencode.ai";
const GO_PATHS = new Set(["/zen/go/v1/chat/completions", "/zen/go/v1/responses", "/zen/go/v1/messages"]);

export type OpenCodeGoCallResult = "no-call" | "success" | "failure" | "missing-session";

export interface OpenCodeGoStatus {
	active: boolean;
	lastCall: OpenCodeGoCallResult;
	httpStatus: "no-call" | "accepted" | "rejected" | "network-error";
	streamStatus: "no-call" | "completed" | "failed" | "cancelled" | "missing-session";
	updatedAt: number | null;
}

/** Owner-private, deliberately secret-free diagnostic state. */
export class OpenCodeGoHeaderState {
	private active = false;
	private lastCall: OpenCodeGoCallResult = "no-call";
	private httpStatus: OpenCodeGoStatus["httpStatus"] = "no-call";
	private streamStatus: OpenCodeGoStatus["streamStatus"] = "no-call";
	private updatedAt: number | null = null;

	snapshot(): OpenCodeGoStatus {
		return {
			active: this.active,
			lastCall: this.lastCall,
			httpStatus: this.httpStatus,
			streamStatus: this.streamStatus,
			updatedAt: this.updatedAt,
		};
	}

	setActive(active: boolean): void {
		this.active = active;
	}

	record(result: Exclude<OpenCodeGoCallResult, "no-call">): void {
		this.lastCall = result;
		this.updatedAt = Date.now();
	}

	recordHttp(result: Exclude<OpenCodeGoStatus["httpStatus"], "no-call">): void {
		this.httpStatus = result;
		if (result !== "accepted") this.lastCall = "failure";
		this.updatedAt = Date.now();
	}

	recordStream(result: Exclude<OpenCodeGoStatus["streamStatus"], "no-call">): void {
		this.streamStatus = result;
		this.lastCall =
			result === "completed" && this.httpStatus === "accepted"
				? "success"
				: result === "missing-session"
					? "missing-session"
					: "failure";
		this.updatedAt = Date.now();
	}
}

function isOpenCodeGo(options: GenerateOptions): boolean {
	return options.provider === "opencode-go";
}

function targetRequest(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
	const method = init?.method ?? (input instanceof Request ? input.method : "GET");
	if (method.toUpperCase() !== "POST") return false;
	const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
	try {
		const url = new URL(rawUrl);
		return url.origin === GO_ORIGIN && GO_PATHS.has(url.pathname);
	} catch {
		return false;
	}
}

function headerValue(sessionId: string, input: RequestInfo | URL, init: RequestInit | undefined): RequestInit {
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	if (!headers.has("x-opencode-session")) headers.set("x-opencode-session", sessionId);
	return { ...init, headers };
}

function scopedIterable(
	storage: AsyncLocalStorage<string>,
	sessionId: string,
	iterable: AsyncIterable<StreamChunk>,
	state: OpenCodeGoHeaderState,
): AsyncIterable<StreamChunk> {
	const iterator = storage.run(sessionId, () => iterable[Symbol.asyncIterator]());
	const wrapped: AsyncIterableIterator<StreamChunk> = {
		[Symbol.asyncIterator]() {
			return this;
		},
		next: async (value?: unknown) => {
			try {
				const result = await storage.run(sessionId, () => iterator.next(value));
				if (result.done || (result.value as { type?: unknown } | undefined)?.type === "finish")
					state.recordStream("completed");
				return result;
			} catch (error) {
				state.recordStream("failed");
				throw error;
			}
		},
		throw: (error?: unknown) =>
			storage.run(sessionId, () =>
				typeof iterator.throw === "function" ? iterator.throw(error) : Promise.reject(error),
			),
		return: (value?: unknown) => {
			state.recordStream("cancelled");
			return storage.run(sessionId, () =>
				typeof iterator.return === "function" ? iterator.return(value) : Promise.resolve({ done: true, value }),
			);
		},
	};
	return wrapped;
}

/**
 * Adds the DSH session id only while an OpenCode Go LLM stream is actually
 * iterated. The fetch wrapper remains inert for every other request.
 */
export function installOpenCodeGoHeaderCompatibility(ctx: Context, state: OpenCodeGoHeaderState): () => void {
	if (typeof (ctx as { on?: unknown }).on !== "function") return () => undefined;
	const storage = new AsyncLocalStorage<string>();
	const previousFetch = globalThis.fetch;
	const wrappedFetch: typeof fetch = async (input, init) => {
		const sessionId = storage.getStore();
		if (sessionId === undefined || !targetRequest(input, init)) return previousFetch(input, init);
		try {
			const response = await previousFetch(input, headerValue(sessionId, input, init));
			state.recordHttp(response.ok ? "accepted" : "rejected");
			return response;
		} catch (error) {
			state.recordHttp("network-error");
			throw error;
		}
	};
	globalThis.fetch = wrappedFetch;
	state.setActive(true);
	const releaseListener = ctx.on(
		"llm/stream",
		(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
			if (!isOpenCodeGo(options)) return next();
			const sessionId = options.sessionId;
			if (typeof sessionId !== "string" || sessionId.length === 0) {
				state.recordStream("missing-session");
				throw new LlmError(
					"OpenCode Go requires the DSH session identity. Return to the conversation and retry.",
					"MISSING_SESSION",
				);
			}
			return scopedIterable(
				storage,
				sessionId,
				storage.run(sessionId, () => next()),
				state,
			);
		},
		{ global: true, prepend: true },
	);
	return () => {
		state.setActive(false);
		releaseListener();
		if (globalThis.fetch === wrappedFetch) globalThis.fetch = previousFetch;
	};
}

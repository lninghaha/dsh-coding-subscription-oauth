import type { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOpenCodeGoHeaderCompatibility, OpenCodeGoHeaderState } from "../src/opencode-go-header.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

function setup() {
	let listener:
		| ((options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>)
		| undefined;
	const ctx = {
		on: (_event: string, candidate: typeof listener) => {
			listener = candidate;
			return () => undefined;
		},
	} as unknown as Context;
	const state = new OpenCodeGoHeaderState();
	const release = installOpenCodeGoHeaderCompatibility(ctx, state);
	return { listener: () => listener!, release, state };
}

function options(sessionId?: string, provider = "opencode-go"): GenerateOptions {
	return {
		provider,
		model: "deepseek-v4.1-flash",
		messages: [],
		...(sessionId === undefined ? {} : { sessionId: sessionId as never }),
	};
}

async function exhaust(iterable: AsyncIterable<StreamChunk>): Promise<void> {
	for await (const _chunk of iterable) {
		// Run the generator until it reaches the test fetch call.
	}
}

describe("OpenCode Go session header compatibility", () => {
	it("does not turn an HTTP 200 stream error into success", async () => {
		globalThis.fetch = vi.fn(async () => new Response("ok"));
		const { listener, release, state } = setup();
		try {
			await exhaust(
				listener()(options("test-session"), async function* () {
					await fetch("https://opencode.ai/zen/go/v1/chat/completions", { method: "POST" });
					yield { type: "finish", reason: { kind: "error", failure: { message: "fixture failure" } } } as StreamChunk;
				}),
			);
			expect(state.snapshot()).toMatchObject({ httpStatus: "accepted", streamStatus: "failed", lastCall: "failure" });
		} finally {
			release();
		}
	});
	it("rolls back fetch installation when registering the stream hook fails", () => {
		const previous = globalThis.fetch;
		const state = new OpenCodeGoHeaderState();
		expect(() =>
			installOpenCodeGoHeaderCompatibility(
				{
					on: () => {
						throw new Error("registration failed");
					},
				} as unknown as Context,
				state,
			),
		).toThrow();
		expect(globalThis.fetch).toBe(previous);
		expect(state.snapshot().active).toBe(false);
	});
	it("injects only on the exact Go POST endpoints and preserves an existing header", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return new Response("ok", { status: 200 });
		});
		const { listener, release, state } = setup();
		async function* stream() {
			await fetch("https://opencode.ai/zen/go/v1/chat/completions", { method: "POST" });
			await fetch("https://opencode.ai/zen/go/v1/responses", {
				method: "POST",
				headers: { "X-OpenCode-Session": "session-a" },
			});
			yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
		}
		await exhaust(listener()(options("session-a"), stream));
		expect(new Headers(calls[0]?.init?.headers).get("x-opencode-session")).toBe("session-a");
		expect(new Headers(calls[1]?.init?.headers).get("x-opencode-session")).toBe("session-a");
		expect(JSON.stringify(state.snapshot())).not.toContain("session-a");
		release();
	});

	it("leaves non-Go methods and paths untouched", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return new Response("ok");
		});
		const { listener, release } = setup();
		async function* stream() {
			await fetch("https://opencode.ai/zen/go/v1/models", { method: "POST" });
			await fetch("https://opencode.ai/zen/go/v1/messages", { method: "GET" });
			yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
		}
		await exhaust(listener()(options("session-a"), stream));
		expect(calls).toHaveLength(2);
		for (const call of calls) expect(new Headers(call.init?.headers).has("x-opencode-session")).toBe(false);
		release();
	});

	it("keeps concurrent and creation-time streams in their own session stores", async () => {
		const seen: string[] = [];
		globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			seen.push(new Headers(init?.headers).get("x-opencode-session") ?? "");
			return new Response("ok");
		});
		const { listener, release } = setup();
		const create = () => {
			const started = fetch("https://opencode.ai/zen/go/v1/responses", { method: "POST" });
			return (async function* () {
				await started;
				await Promise.resolve();
				await fetch("https://opencode.ai/zen/go/v1/messages", { method: "POST" });
				yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
			})();
		};
		await Promise.all([exhaust(listener()(options("one"), create)), exhaust(listener()(options("two"), create))]);
		expect(seen.sort()).toEqual(["one", "one", "two", "two"]);
		release();
	});

	it("keeps the session store while downstream middleware acquires its iterator", async () => {
		const calls: RequestInit[] = [];
		globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(init ?? {});
			return new Response("ok");
		});
		const { listener, release } = setup();
		const downstreamIterable: AsyncIterable<StreamChunk> = {
			[Symbol.asyncIterator]() {
				const started = fetch("https://opencode.ai/zen/go/v1/responses", { method: "POST" });
				return (async function* () {
					await started;
					yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
				})();
			},
		};
		await exhaust(listener()(options("iterator-session"), () => downstreamIterable));
		expect(new Headers(calls[0]?.headers).get("x-opencode-session")).toBe("iterator-session");
		release();
	});

	it("fails at the LLM seam without fetching when the session is absent, and exposes no secret", () => {
		const fetchSpy = vi.fn<typeof fetch>();
		globalThis.fetch = fetchSpy;
		const { listener, release, state } = setup();
		expect(() => listener()(options(), () => ({ [Symbol.asyncIterator]: async function* () {} }))).toThrow(
			/requires the DSH session identity/u,
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(JSON.stringify(state.snapshot())).not.toContain("private-session-id");
		expect(state.snapshot()).toMatchObject({ active: true, lastCall: "missing-session" });
		release();
	});

	it("does not require a session for the ordinary opencode provider", async () => {
		const { listener, release, state } = setup();
		async function* stream() {
			yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
		}
		await exhaust(listener()(options(undefined, "opencode"), stream));
		expect(state.snapshot()).toMatchObject({ lastCall: "no-call" });
		release();
	});

	it("does not restore over a fetch wrapper installed after it", () => {
		const { release } = setup();
		const later = vi.fn();
		globalThis.fetch = later as unknown as typeof fetch;
		release();
		expect(globalThis.fetch).toBe(later);
	});
	it("rejects conflicting static headers without sending the request", async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		globalThis.fetch = fetchSpy;
		const { listener, release, state } = setup();
		try {
			await expect(
				exhaust(
					listener()(options("session-a"), async function* () {
						await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
							method: "POST",
							headers: { "x-opencode-session": "static" },
						});
						yield* [];
					}),
				),
			).rejects.toThrow(/conflicts/);
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(state.snapshot()).toMatchObject({ configurationConflict: true, lastCall: "failure" });
		} finally {
			release();
		}
	});
	it("does not let an older HTTP response supply success evidence for a newer call", async () => {
		let finishOld!: () => void;
		const waitOld = new Promise<void>((resolve) => {
			finishOld = resolve;
		});
		globalThis.fetch = vi.fn(async () => {
			await waitOld;
			return new Response("ok");
		});
		const { listener, release, state } = setup();
		try {
			const older = exhaust(
				listener()(options("older"), async function* () {
					await fetch("https://opencode.ai/zen/go/v1/messages", { method: "POST" });
					yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
				}),
			);
			await exhaust(
				listener()(options("newer"), async function* () {
					yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
				}),
			);
			finishOld();
			await older;
			expect(state.snapshot()).toMatchObject({ lastCall: "failure", httpStatus: "no-call", pending: false });
		} finally {
			finishOld();
			release();
		}
	});
	it("treats abrupt stream termination as unconfirmed and preserves abort outcomes", async () => {
		globalThis.fetch = vi.fn(async () => new Response("ok"));
		const { listener, release, state } = setup();
		try {
			await exhaust(
				listener()(options("abrupt"), async function* () {
					await fetch("https://opencode.ai/zen/go/v1/responses", { method: "POST" });
					yield* [];
				}),
			);
			expect(state.snapshot()).toMatchObject({ lastCall: "failure", streamStatus: "failed" });
			await exhaust(
				listener()(options("abort"), async function* () {
					await fetch("https://opencode.ai/zen/go/v1/responses", { method: "POST" });
					yield { type: "finish", reason: { kind: "aborted", failure: { message: "fixture abort" } } } as StreamChunk;
				}),
			);
			expect(state.snapshot()).toMatchObject({ lastCall: "failure", streamStatus: "cancelled" });
		} finally {
			release();
		}
	});
});

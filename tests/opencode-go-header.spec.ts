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
				headers: { "X-OpenCode-Session": "caller-value" },
			});
			yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
		}
		await exhaust(listener()(options("session-a"), stream));
		expect(new Headers(calls[0]?.init?.headers).get("x-opencode-session")).toBe("session-a");
		expect(new Headers(calls[1]?.init?.headers).get("x-opencode-session")).toBe("caller-value");
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
});

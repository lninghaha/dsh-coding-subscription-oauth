import type { Context } from "@deepseek-ai/cordis";
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENCODE_GO_KNOWN_MODELS } from "../src/opencode-go-catalog.ts";
import { OPENCODE_GO_LEGACY_PROVIDER_ID, OPENCODE_GO_PROVIDER_ID } from "../src/opencode-go-ids.ts";
import {
	createOpenCodeGoConnectionController,
	OPENCODE_GO_API,
	OPENCODE_GO_BASE_URL,
	type OpenCodeGoSettingsProvider,
} from "../src/opencode-go-connection.ts";
import { installOpenCodeGoHeaderCompatibility, OpenCodeGoHeaderState } from "../src/opencode-go-header.ts";

/** Upstream OpenCode Go + plugin catalog DeepSeek ids (wire ids stay unprefixed). */
const PLUGIN_DEEPSEEK_IDS = [
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-v4.1-flash",
	"deepseek-v4-flash-vision-exp",
	"deepseek-flash",
] as const;

/** `@deepseek-ai/dsh-llm-deepseek` default advisory catalog (provider `deepseek-official`). */
const OFFICIAL_DEEPSEEK_DEFAULTS = [
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-v4-flash-vision-exp",
] as const;

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("OpenCode Go DeepSeek model-id isolation", () => {
	it("keeps every DeepSeek catalog id under the isolated provider namespace", () => {
		for (const id of PLUGIN_DEEPSEEK_IDS) {
			expect(OPENCODE_GO_KNOWN_MODELS.has(id)).toBe(true);
		}
		expect(OPENCODE_GO_PROVIDER_ID).toBe("coding-opencode-go");
		expect(OPENCODE_GO_LEGACY_PROVIDER_ID).toBe("opencode-go");
		expect(OPENCODE_GO_PROVIDER_ID).not.toBe("deepseek-official");
		expect(OPENCODE_GO_PROVIDER_ID).not.toBe("deepseek");
	});

	it("shares bare model strings with official DeepSeek without sharing a provider route", () => {
		for (const id of OFFICIAL_DEEPSEEK_DEFAULTS) {
			expect(PLUGIN_DEEPSEEK_IDS).toContain(id);
		}
		expect(OFFICIAL_DEEPSEEK_DEFAULTS).not.toContain("deepseek-v4.1-flash");
		expect(OFFICIAL_DEEPSEEK_DEFAULTS).not.toContain("deepseek-flash");
	});

	it("apply with overlapping DeepSeek ids never mutates official or native Go slots", async () => {
		const mutate = vi.fn(async () => undefined);
		const settings: OpenCodeGoSettingsProvider = {
			writable: true,
			describe: () => [
				{
					ns: "llm-pi-ai",
					revision: 4,
					value: {
						providers: {
							"coding-opencode-go": { models: [] },
							"opencode-go": {
								apiKeyEnv: "NATIVE_GO_KEY",
								models: [{ id: "deepseek-v4-flash" }],
							},
							deepseek: {
								apiKeyEnv: "DEEPSEEK_API_KEY",
								models: [{ id: "deepseek-v4-pro" }],
							},
						},
					},
				},
			],
			mutate,
		};
		const credentials = {
			describe: vi.fn(async () => ({ configured: true, writable: true, source: "store" })),
			resolve: vi.fn(async () => ({ value: "fixture" })),
			set: vi.fn(async () => undefined),
		} as unknown as CredentialProvider;
		const controller = createOpenCodeGoConnectionController({
			credentials,
			settings,
			callStatus: () => ({
				active: true,
				lastCall: "no-call",
				httpStatus: "no-call",
				streamStatus: "no-call",
				updatedAt: null,
			}),
		});
		await controller.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			models: OFFICIAL_DEEPSEEK_DEFAULTS.map((id) => ({ id })),
			api: OPENCODE_GO_API,
			expectedRevision: 4,
			confirmConflicts: false,
		});
		expect(mutate).toHaveBeenCalledOnce();
		const ops = (mutate.mock.calls[0] as unknown as [string, Array<{ path: string[] }>])[1];
		expect(ops.length).toBeGreaterThan(0);
		expect(ops.every((op) => op.path[0] === "providers" && op.path[1] === OPENCODE_GO_PROVIDER_ID)).toBe(true);
		expect(ops.some((op) => op.path.includes("opencode-go"))).toBe(false);
		expect(ops.some((op) => op.path.includes("deepseek"))).toBe(false);
		expect(ops.some((op) => op.path.includes("deepseek-official"))).toBe(false);
		const modelsOp = ops.find((op) => op.path.join(".") === `providers.${OPENCODE_GO_PROVIDER_ID}.models`) as
			| { value: Array<{ id: string }> }
			| undefined;
		expect(modelsOp?.value.map((row) => row.id)).toEqual([...OFFICIAL_DEEPSEEK_DEFAULTS]);
		expect(OPENCODE_GO_BASE_URL).toContain("opencode.ai");
	});

	it("session-header hook ignores deepseek-official and native opencode-go for the same model id", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return new Response("ok", { status: 200 });
		});
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
		async function exhaust(iterable: AsyncIterable<StreamChunk>): Promise<void> {
			for await (const _chunk of iterable) {
				// drain
			}
		}
		async function* stream() {
			await fetch("https://opencode.ai/zen/go/v1/chat/completions", { method: "POST" });
			yield { type: "finish", reason: { kind: "stop" } } as StreamChunk;
		}
		for (const provider of ["deepseek-official", "deepseek", OPENCODE_GO_LEGACY_PROVIDER_ID] as const) {
			calls.length = 0;
			await exhaust(
				listener!(
					{
						provider,
						model: "deepseek-v4.1-flash",
						messages: [],
						sessionId: "session-shared-id" as never,
					},
					stream,
				),
			);
			expect(calls).toHaveLength(1);
			expect(new Headers(calls[0]?.init?.headers).has("x-opencode-session")).toBe(false);
			expect(state.snapshot().lastCall).toBe("no-call");
		}
		release();
	});
});

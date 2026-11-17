import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type OAuthProviderDefinition, QWEN_CODE_OAUTH_PROVIDER } from "../src/oauth-providers.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import {
	fetchQwenModels,
	isTieredEffortQwenModel,
	type LiveModelEntry,
	parseQwenModelsResponse,
	QWEN_CODE_MODELS,
} from "../src/qwen-provider.ts";
import { OAuthCredentialFileStore } from "../src/store.ts";

const LIVE: LiveModelEntry[] = [
	{ id: "qwen3.8-max", name: "qwen3.8-max", input: ["text"], contextWindow: 262_144, maxTokens: 65_536 },
	{ id: "qwen4-plus", name: "qwen4-plus", input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 65_536 },
];

async function makeSession(fetchLiveModels: NonNullable<OAuthProviderDefinition["fetchLiveModels"]>, notify = vi.fn()) {
	const dir = await mkdtemp(join(tmpdir(), "dsh-qwen-models-"));
	const definition: OAuthProviderDefinition = { ...QWEN_CODE_OAUTH_PROVIDER, fetchLiveModels };
	const store = new OAuthCredentialFileStore(definition.nativeProviderId, join(dir, "auth.json"), definition.route);
	await store.modify(definition.nativeProviderId, async () => ({
		type: "oauth",
		access: "qwen-access",
		refresh: "qwen-refresh",
		expires: Date.now() + 3_600_000,
	}));
	const cacheFile = join(dir, "models.json");
	return {
		definition,
		store,
		cacheFile,
		notify,
		session: new OAuthProviderSession(definition, notify, store, cacheFile),
	};
}

describe("Qwen live model list", () => {
	it("parses /models, de-duplicates, rejects bad ids and maps modalities and context", () => {
		const entries = parseQwenModelsResponse({
			data: [
				{ id: "qwen4-plus", input_modalities: ["text", "image"], context_window_tokens: 1_000_000 },
				{ id: "qwen4-plus" },
				{ id: "bad,id" },
				{ id: "  " },
				{ id: "qwen-text" },
			],
		});
		expect(entries.map((entry) => entry.id)).toEqual(["qwen4-plus", "qwen-text"]);
		expect(entries[0]).toMatchObject({ input: ["text", "image"], contextWindow: 1_000_000 });
		expect(entries[1]).toMatchObject({ input: ["text"], contextWindow: 262_144 });
		expect(() => parseQwenModelsResponse({ data: [] })).toThrow(/empty/);
		expect(() => parseQwenModelsResponse({})).toThrow(/malformed/);
	});

	it("fetches with a Bearer token and does not follow redirects", async () => {
		let seen: string | undefined;
		const server = createServer((req, res) => {
			seen = req.headers.authorization;
			if (req.url === "/v1/models") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ data: [{ id: "qwen4-plus" }] }));
			} else {
				res.writeHead(302, { Location: "http://127.0.0.1:1/" });
				res.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		try {
			await expect(fetchQwenModels("tok", new AbortController().signal, `${base}/v1`)).resolves.toHaveLength(1);
			expect(seen).toBe("Bearer tok");
			await expect(fetchQwenModels("tok", new AbortController().signal, `${base}/redirect`)).rejects.toThrow();
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("replaces the baseline with the live catalog and routes requests to live ids", async () => {
		const fetchLive = vi.fn(async () => LIVE);
		const { session, notify } = await makeSession(fetchLive);
		expect(session.availableModels().map((model) => model.id)).toEqual(["qwen3.8-max"]);
		vi.spyOn(session, "resolveAccessToken").mockResolvedValue("qwen-access");

		await session.refreshLiveModels(true);
		expect(fetchLive).toHaveBeenCalledWith("qwen-access", expect.any(AbortSignal));
		expect(session.availableModels().map((model) => model.id)).toEqual(["qwen3.8-max", "qwen4-plus"]);
		expect(session.availableModels()[1]).toMatchObject({ input: ["text", "image"], contextWindow: 1_000_000 });
		expect(
			session
				.provider()
				.getModels()
				.map((model) => model.id),
		).toEqual(["qwen3.8-max", "qwen4-plus"]);
		expect(notify).toHaveBeenCalledOnce();

		await session.setSelectedModels(["qwen4-plus"]);
		expect(
			session
				.provider()
				.getModels()
				.map((model) => model.id),
		).toEqual(["qwen4-plus"]);
	});

	it("keeps the last catalog when listing fails and does not hammer the endpoint", async () => {
		const fetchLive = vi.fn(async () => {
			throw new Error("boom");
		});
		const { session } = await makeSession(fetchLive);
		vi.spyOn(session, "resolveAccessToken").mockResolvedValue("qwen-access");
		await session.refreshLiveModels(true);
		await session.refreshLiveModels();
		expect(fetchLive).toHaveBeenCalledOnce();
		expect(session.availableModels().map((model) => model.id)).toEqual(["qwen3.8-max"]);
	});

	it("persists the live catalog and restores it on restart", async () => {
		const { session, definition, store, cacheFile } = await makeSession(async () => LIVE);
		vi.spyOn(session, "resolveAccessToken").mockResolvedValue("qwen-access");
		await session.refreshLiveModels(true);
		const text = await readFile(`${cacheFile}.live`, "utf8");
		expect(text).not.toContain("qwen-access");

		const restarted = new OAuthProviderSession(definition, undefined, store, cacheFile);
		await restarted.loadCachedModels();
		expect(restarted.availableModels().map((model) => model.id)).toEqual(["qwen3.8-max", "qwen4-plus"]);
		expect(restarted.provider().getModels()[1]?.provider).toBe(definition.nativeProviderId);
	});

	it("resets to the baseline on logout and ignores a listing that finishes afterwards", async () => {
		let release: (() => void) | undefined;
		const { session } = await makeSession(
			() =>
				new Promise<LiveModelEntry[]>((resolve) => {
					release = () => resolve(LIVE);
				}),
		);
		vi.spyOn(session, "resolveAccessToken").mockResolvedValue("qwen-access");
		vi.spyOn(session.models, "logout").mockResolvedValue(undefined);
		const pending = session.refreshLiveModels(true);
		await vi.waitFor(() => expect(release).toBeDefined());
		await session.logout();
		release?.();
		await pending;
		expect(session.availableModels().map((model) => model.id)).toEqual(["qwen3.8-max"]);
	});

	it("gives tiered Qwen models an effort selector and keeps plain models without one", async () => {
		const entries: LiveModelEntry[] = [
			{ id: "qwen4-max", name: "qwen4-max", input: ["text"], contextWindow: 1_000_000, maxTokens: 65_536 },
			{ id: "qwen3.8-max-preview", name: "x", input: ["text"], contextWindow: 262_144, maxTokens: 65_536 },
			{ id: "qwen-plus", name: "qwen-plus", input: ["text"], contextWindow: 131_072, maxTokens: 32_768 },
		];
		const { session } = await makeSession(async () => entries);
		vi.spyOn(session, "resolveAccessToken").mockResolvedValue("qwen-access");
		await session.refreshLiveModels(true);
		const byId = new Map(
			session
				.provider()
				.getModels()
				.map((model) => [model.id, model]),
		);
		const tiered = byId.get("qwen4-max");
		expect(tiered?.reasoning).toBe(true);
		expect(tiered?.thinkingLevelMap).toMatchObject({ low: "low", high: "high", max: "max", minimal: null, off: null });
		expect((tiered?.compat as { thinkingFormat?: string; supportsReasoningEffort?: boolean }) ?? {}).toMatchObject({
			thinkingFormat: "openai",
			supportsReasoningEffort: true,
		});
		expect(byId.get("qwen3.8-max-preview")?.reasoning).toBe(true);
		// Traits must not leak from the first catalog model onto plain ones.
		expect(byId.get("qwen-plus")?.reasoning).toBe(false);
		expect(byId.get("qwen-plus")?.thinkingLevelMap).toBeUndefined();
	});

	it("applies Qwen Code's tiered-family rule to ids and to the baseline", () => {
		for (const id of ["qwen3.8-max", "QWEN4-Turbo", "qwen-latest-series-invite-1"]) {
			expect(isTieredEffortQwenModel(id)).toBe(true);
		}
		for (const id of ["qwen3.7-plus", "coder-model", "qwen-plus"]) expect(isTieredEffortQwenModel(id)).toBe(false);
		expect(QWEN_CODE_MODELS[0]?.reasoning).toBe(true);
	});
});

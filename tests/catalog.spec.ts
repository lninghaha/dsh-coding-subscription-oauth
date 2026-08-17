import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractLiveModels,
	extractModelIds,
	fetchLiveModels,
	materializeLiveModel,
	mergeLiveCatalog,
	preferredGrokBuildModelFrom,
	thinkingLevelMapFromLiveEfforts,
} from "../src/catalog.ts";
import { GROK_BUILD_ROUTE } from "../src/ids.ts";
import { grokBuildBaselineModels } from "../src/provider.ts";

const catalog = grokBuildBaselineModels();

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("extractModelIds", () => {
	it("reads OpenAI-shaped data arrays", () => {
		expect(extractModelIds({ data: [{ id: "grok-4.6" }, { id: "grok-4.5" }, { object: "model" }] })).toEqual([
			"grok-4.6",
			"grok-4.5",
		]);
	});

	it("accepts a bare string list and a models field", () => {
		expect(extractModelIds(["grok-4.6", "grok-4.6"])).toEqual(["grok-4.6"]);
		expect(extractModelIds({ models: [{ id: "grok-4.20-multi-agent" }] })).toEqual(["grok-4.20-multi-agent"]);
	});

	it("returns an empty list for unrecognized envelopes", () => {
		expect(extractModelIds({ unexpected: true })).toEqual([]);
	});
});

describe("mergeLiveCatalog", () => {
	it("keeps the baseline catalog when live ids are missing", () => {
		expect(mergeLiveCatalog(catalog, undefined).map((model) => model.id)).toEqual(catalog.map((model) => model.id));
		expect(mergeLiveCatalog(catalog, []).map((model) => model.id)).toEqual(catalog.map((model) => model.id));
	});

	it("narrows to live ids and inherits baseline metadata", () => {
		const merged = mergeLiveCatalog(catalog, ["grok-4.5", "grok-4.6"]);
		expect(merged.map((model) => model.id)).toEqual(["grok-4.5", "grok-4.6"]);
		const known = merged.find((model) => model.id === "grok-4.5");
		const extra = merged.find((model) => model.id === "grok-4.6");
		expect(known?.api).toBe("openai-responses");
		expect(extra?.api).toBe("openai-responses");
		expect(extra?.name).toBe("Grok 4.6");
		expect(extra?.reasoning).toBe(true);
		expect(extra?.input).toEqual(["text", "image"]);
		expect(extra?.thinkingLevelMap?.off).toBeNull();
		expect(extra?.thinkingLevelMap?.xhigh).toBe("xhigh");
		expect(known?.input).toEqual(["text", "image"]);
		expect(known?.thinkingLevelMap?.xhigh).toBeNull();
	});

	it("applies live reasoning_efforts so xhigh is not inherited from a 4.5 template", () => {
		const thinkingLevelMap = thinkingLevelMapFromLiveEfforts([
			{ id: "xhigh", value: "xhigh" },
			{ id: "high", value: "high" },
			{ id: "medium", value: "medium" },
			{ id: "low", value: "low" },
		]);
		const merged = mergeLiveCatalog(
			catalog,
			["grok-4.6"],
			[
				{
					id: "grok-4.6",
					reasoning: true,
					...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
				},
			],
		);
		expect(merged[0]?.thinkingLevelMap).toMatchObject({
			off: null,
			xhigh: "xhigh",
			high: "high",
			medium: "medium",
			low: "low",
			max: null,
		});
	});
});

describe("materializeLiveModel", () => {
	it("uses the composer template for fast/composer ids", () => {
		const model = materializeLiveModel("grok-composer-2.5-fast", catalog);
		expect(model.reasoning).toBe(false);
		expect(model.contextWindow).toBe(200_000);
	});

	it("defaults unknown ids to the grok-4.6 template on the grok-build route", () => {
		const model = materializeLiveModel("grok-9-future", catalog);
		expect(model.provider).toBe(GROK_BUILD_ROUTE);
		expect(model.api).toBe("openai-responses");
		expect(model.name).toBe("Grok 9 Future");
		expect(model.input).toEqual(["text", "image"]);
		expect(model.thinkingLevelMap?.xhigh).toBe("xhigh");
	});

	it("keeps grok-4.5 descendants on the no-xhigh template", () => {
		const model = materializeLiveModel("grok-4.5-preview", catalog);
		expect(model.thinkingLevelMap?.xhigh).toBeNull();
		expect(model.thinkingLevelMap?.high).toBe("high");
	});
});

describe("thinkingLevelMapFromLiveEfforts", () => {
	it("pins undeclared extended levels to null so xhigh is opt-in", () => {
		expect(
			thinkingLevelMapFromLiveEfforts([
				{ id: "high", value: "high" },
				{ id: "medium", value: "medium" },
				{ id: "low", value: "low" },
			]),
		).toMatchObject({ xhigh: null, max: null, high: "high" });
	});
});

describe("extractLiveModels", () => {
	it("reads reasoning_efforts from a models-v2 row", () => {
		const [model] = extractLiveModels({
			data: [
				{
					id: "grok-4.6",
					name: "Grok 4.6",
					context_window: 500000,
					supports_reasoning_effort: true,
					reasoning_efforts: [
						{ id: "xhigh", value: "xhigh" },
						{ id: "high", value: "high" },
					],
				},
			],
		});
		expect(model).toMatchObject({
			id: "grok-4.6",
			name: "Grok 4.6",
			contextWindow: 500000,
			reasoning: true,
		});
		expect(model?.thinkingLevelMap?.xhigh).toBe("xhigh");
	});
});

describe("fetchLiveModels", () => {
	it("parses a streamed models-v2 response", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"data":[{"id":"grok-4.6",'));
				controller.enqueue(new TextEncoder().encode('"reasoning_efforts":[{"id":"xhigh"}]}]}'));
				controller.close();
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);
		await expect(fetchLiveModels("example-token")).resolves.toMatchObject([
			{ id: "grok-4.6", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
		]);
	});

	it("cancels a streamed body as soon as it crosses the 4 MiB ceiling", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(3 * 1024 * 1024));
				controller.enqueue(new Uint8Array(2 * 1024 * 1024));
			},
			cancel() {
				cancelled = true;
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);
		await expect(fetchLiveModels("example-token")).rejects.toThrow(/4 MiB read ceiling/);
		expect(cancelled).toBe(true);
	});

	it("preserves cancellation when an aborted response stream fails", async () => {
		const cancellation = new AbortController();
		cancellation.abort();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("aborted"));
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);
		await expect(fetchLiveModels("example-token", cancellation.signal)).rejects.toThrow(
			"Live model listing was cancelled",
		);
	});

	it("rejects an oversized content-length before reading the body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("ignored", {
						status: 200,
						headers: { "content-length": String(4 * 1024 * 1024 + 1) },
					}),
			),
		);
		await expect(fetchLiveModels("example-token")).rejects.toThrow(/4 MiB read ceiling/);
	});
});

describe("preferredGrokBuildModelFrom", () => {
	it("prefers grok-4.6, then the first listed model", () => {
		expect(preferredGrokBuildModelFrom([{ id: "grok-4.6" }, { id: "grok-4.5" }])).toBe("grok-4.6");
		expect(preferredGrokBuildModelFrom([{ id: "grok-4.5" }])).toBe("grok-4.5");
	});
});

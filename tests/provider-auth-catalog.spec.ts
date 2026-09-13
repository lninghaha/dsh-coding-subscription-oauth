import { describe, expect, it } from "vitest";
import {
	enrichDirectoryModel,
	mergeEnabledModels,
	normalizeReasoningEfforts,
	planCredentialReinject,
	settingsModelEntry,
} from "../src/provider-auth-catalog.ts";

describe("provider-auth-catalog", () => {
	it("lets directory values win over known metadata", () => {
		expect(
			enrichDirectoryModel(
				{ id: "m1", name: "Live", contextWindow: 10 },
				{
					id: "m1",
					protocol: "openai-completions",
					name: "Known",
					contextWindow: 99,
					reasoningEfforts: { high: "high" },
				},
			),
		).toMatchObject({
			name: "Live",
			contextWindow: 10,
			reasoningEfforts: { high: "high" },
			protocol: "openai-completions",
		});
	});

	it("preserves existing overrides while dropping disabled models", () => {
		const merged = mergeEnabledModels({
			existing: [
				{ id: "keep", name: "Custom", reasoningEfforts: { high: "high" }, compat: { supportsStore: false } },
				{ id: "drop" },
			],
			enabledIds: ["keep", "new"],
			catalog: [{ id: "new", name: "New", reasoningEfforts: { high: "high" } }],
		});
		expect(merged).toEqual([
			expect.objectContaining({
				id: "keep",
				name: "Custom",
				reasoningEfforts: { high: "high" },
				compat: { supportsStore: false },
			}),
			settingsModelEntry({ id: "new", name: "New", reasoningEfforts: { high: "high" } }),
		]);
	});

	it("backfills thin prior { id } entries with catalog reasoningEfforts", () => {
		const merged = mergeEnabledModels({
			existing: [{ id: "glm-5.3" }],
			enabledIds: ["glm-5.3"],
			catalog: [
				{
					id: "glm-5.3",
					name: "GLM-5.3",
					reasoningEfforts: { off: null, high: "high", max: "max" },
					compat: { supportsStore: false },
				},
			],
		});
		expect(merged).toEqual([
			expect.objectContaining({
				id: "glm-5.3",
				name: "GLM-5.3",
				reasoningEfforts: { off: null, high: "high", max: "max" },
				compat: { supportsStore: false },
			}),
		]);
	});

	it("replaces illegal array reasoningEfforts from a prior write with catalog efforts", () => {
		const merged = mergeEnabledModels({
			existing: [{ id: "glm-5.3", name: "Keep label", reasoningEfforts: ["high"] }],
			enabledIds: ["glm-5.3"],
			catalog: [{ id: "glm-5.3", reasoningEfforts: { off: null, high: "high", max: "max" } }],
		});
		expect(merged[0]).toMatchObject({
			id: "glm-5.3",
			name: "Keep label",
			reasoningEfforts: { off: null, high: "high", max: "max" },
		});
	});

	it("plans credential reinjection only when missing", () => {
		expect(
			planCredentialReinject({
				providerId: "opencode-go",
				provider: { models: [{ id: "a" }] },
				credentialRef: "OPENCODE_GO_API_KEY",
				credentialConfigured: true,
			}),
		).toEqual({ path: ["providers", "opencode-go", "apiKeyEnv"], credentialRef: "OPENCODE_GO_API_KEY" });
		expect(
			planCredentialReinject({
				providerId: "opencode-go",
				provider: { apiKeyEnv: "OTHER", models: [{ id: "a" }] },
				credentialRef: "OPENCODE_GO_API_KEY",
				credentialConfigured: true,
			}),
		).toBeUndefined();
		expect(
			planCredentialReinject({
				providerId: "opencode-go",
				provider: {},
				credentialRef: "OPENCODE_GO_API_KEY",
				credentialConfigured: true,
			}),
		).toBeUndefined();
	});
});

describe("normalizeReasoningEfforts", () => {
	it("keeps off:null and non-empty wire strings", () => {
		expect(normalizeReasoningEfforts({ off: null, high: "high", max: "max" })).toEqual({
			off: null,
			high: "high",
			max: "max",
		});
	});

	it("strips illegal null / empty levels that are not off (DSH refuses them)", () => {
		expect(
			normalizeReasoningEfforts({
				off: null,
				minimal: null,
				low: null,
				medium: null,
				high: "high",
				xhigh: null,
				max: "max",
			}),
		).toEqual({ off: null, high: "high", max: "max" });
		expect(normalizeReasoningEfforts({ minimal: null, low: null, medium: null })).toBeUndefined();
		expect(normalizeReasoningEfforts({ off: null })).toBeUndefined();
		expect(normalizeReasoningEfforts({ high: "  " })).toBeUndefined();
		expect(normalizeReasoningEfforts(["high"])).toBeUndefined();
	});

	it("preserves false for non-reasoning models", () => {
		expect(normalizeReasoningEfforts(false)).toBe(false);
	});
});

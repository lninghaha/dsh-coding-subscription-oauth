import { describe, expect, it } from "vitest";
import {
	enrichDirectoryModel,
	mergeEnabledModels,
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
				{ id: "keep", name: "Custom", reasoningEfforts: ["high"], compat: { supportsStore: false } },
				{ id: "drop" },
			],
			enabledIds: ["keep", "new"],
			catalog: [{ id: "new", name: "New", reasoningEfforts: { high: "high" } }],
		});
		expect(merged).toEqual([
			{ id: "keep", name: "Custom", reasoningEfforts: ["high"], compat: { supportsStore: false } },
			settingsModelEntry({ id: "new", name: "New", reasoningEfforts: { high: "high" } }),
		]);
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

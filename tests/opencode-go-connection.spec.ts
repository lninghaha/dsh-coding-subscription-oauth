import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { describe, expect, it, vi } from "vitest";
import {
	createOpenCodeGoConnectionController,
	OPENCODE_GO_API,
	OPENCODE_GO_BASE_URL,
	type OpenCodeGoSettingsProvider,
} from "../src/opencode-go-connection.ts";

function fixture(provider: Record<string, unknown> = {}, revision = 4) {
	const values = new Map<string, string>();
	const credentials = {
		describe: vi.fn(async (ref: string) => ({
			configured: values.has(String(ref)),
			writable: true,
			source: values.has(String(ref)) ? "store" : null,
		})),
		resolve: vi.fn(async (ref: string) => (values.has(String(ref)) ? { value: values.get(String(ref))! } : undefined)),
		set: vi.fn(async (ref: string, value: string) => {
			values.set(String(ref), value);
		}),
	} as unknown as CredentialProvider;
	const mutate = vi.fn(async () => undefined);
	const settings: OpenCodeGoSettingsProvider = {
		writable: true,
		describe: () => [{ ns: "llm-pi-ai", revision, value: { providers: { "coding-opencode-go": provider } } }],
		mutate,
	};
	return { values, credentials, settings, mutate };
}

const callStatus = () => ({
	active: true,
	lastCall: "no-call" as const,
	httpStatus: "no-call" as const,
	streamStatus: "no-call" as const,
	updatedAt: null,
});

describe("OpenCode Go connection controller", () => {
	it("preserves existing model capabilities and user overrides when applying a model", async () => {
		const existing = {
			id: "deepseek-v4.1-flash",
			name: "Custom label",
			contextWindow: 90000,
			input: ["text"],
			reasoningEfforts: { off: null, high: "high", max: "max" },
			compat: { supportsStore: false },
		};
		const other = { id: "other-model", input: ["text", "image"], compat: { supportsDeveloperRole: false } };
		const f = fixture({ models: [existing, other] });
		f.values.set("OPENCODE_GO_API_KEY", "fixture-secret");
		const controller = createOpenCodeGoConnectionController({
			credentials: f.credentials,
			settings: f.settings,
			callStatus,
		});
		await controller.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			model: { id: existing.id, name: "Directory label", contextWindow: 100000 },
			expectedRevision: 4,
			confirmConflicts: false,
		});
		const call = f.mutate.mock.calls[0] as unknown as [string, Array<{ path: string[]; value: unknown }>, number];
		const modelsOp = call[1].find((op) => op.path.join(".") === "providers.coding-opencode-go.models");
		expect(modelsOp?.value).toEqual([
			expect.objectContaining({
				id: "deepseek-v4.1-flash",
				name: "Custom label",
				contextWindow: 90000,
				reasoningEfforts: { off: null, high: "high", max: "max" },
				compat: { supportsStore: false },
			}),
			other,
		]);
	});
	it("saves a credential without returning its value and reads only the official model directory", async () => {
		const f = fixture();
		const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: "deepseek-v4.1-flash" }] }));
		const controller = createOpenCodeGoConnectionController({
			credentials: f.credentials,
			settings: f.settings,
			callStatus,
			fetchImpl,
		});
		const saved = await controller.saveCredential({ credentialRef: "OPENCODE_GO_API_KEY", apiKey: "secret-test-key" });
		expect(JSON.stringify(saved)).not.toContain("secret-test-key");
		expect((await controller.models("OPENCODE_GO_API_KEY"))[0]?.id).toBe("deepseek-v4.1-flash");
		expect(fetchImpl).toHaveBeenCalledWith(
			`${OPENCODE_GO_BASE_URL}/models`,
			expect.objectContaining({ redirect: "error" }),
		);
	});

	it("applies only the Go provider fields with revision and removes a static session header after confirmation", async () => {
		const f = fixture({
			apiKeyEnv: "OPENCODE_GO_API_KEY",
			api: "responses",
			baseURL: "https://proxy.invalid/v1",
			headers: { "x-opencode-session": "static", "x-safe": "keep" },
			models: [],
		});
		f.values.set("OPENCODE_GO_API_KEY", "secret");
		const controller = createOpenCodeGoConnectionController({
			credentials: f.credentials,
			settings: f.settings,
			callStatus,
		});
		await expect(
			controller.applyConfiguration({
				credentialRef: "OPENCODE_GO_API_KEY",
				model: { id: "deepseek-v4.1-flash" },
				expectedRevision: 4,
				confirmConflicts: false,
			}),
		).rejects.toMatchObject({ code: "configuration-conflict" });
		await controller.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			model: { id: "deepseek-v4.1-flash" },
			expectedRevision: 4,
			confirmConflicts: true,
		});
		expect(f.mutate).toHaveBeenCalledWith(
			"llm-pi-ai",
			expect.arrayContaining([
				{ op: "set", path: ["providers", "coding-opencode-go", "api"], value: OPENCODE_GO_API },
				{ op: "set", path: ["providers", "coding-opencode-go", "baseURL"], value: OPENCODE_GO_BASE_URL },
				{ op: "unset", path: ["providers", "coding-opencode-go", "headers", "x-opencode-session"] },
			]),
			4,
		);
	});

	it("requires an explicit account choice when distinct saved Go credentials exist", async () => {
		const f = fixture();
		f.values.set("OPENCODE_GO_API_KEY", "one");
		f.values.set("OPENCODE_API_KEY", "two");
		const controller = createOpenCodeGoConnectionController({
			credentials: f.credentials,
			settings: f.settings,
			callStatus,
		});
		expect((await controller.status()).credential.requiresChoice).toBe(true);
	});
});

it("requires the selected model protocol and preserves the rest of the route", async () => {
	const f = fixture({
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		api: "openai-completions",
		baseURL: OPENCODE_GO_BASE_URL,
		models: [],
	});
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await expect(
		c.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			model: { id: "gpt-5.6-luna" },
			expectedRevision: 4,
			confirmConflicts: true,
		}),
	).rejects.toMatchObject({ code: "model-protocol-mismatch" });
	await expect(
		c.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			model: { id: "gpt-5.6-luna" },
			api: "openai-responses",
			expectedRevision: 4,
			confirmConflicts: false,
		}),
	).rejects.toMatchObject({ code: "configuration-conflict" });
	await c.applyConfiguration({
		credentialRef: "OPENCODE_GO_API_KEY",
		model: { id: "gpt-5.6-luna" },
		api: "openai-responses",
		expectedRevision: 4,
		confirmConflicts: true,
	});
	expect(f.mutate).toHaveBeenCalledWith(
		"llm-pi-ai",
		expect.arrayContaining([
			{ op: "set", path: ["providers", "coding-opencode-go", "api"], value: "openai-responses" },
		]),
		4,
	);
});
it("does not break existing models when switching protocol", async () => {
	const f = fixture({ models: [{ id: "deepseek-v4.1-flash" }] });
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await expect(
		c.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			model: { id: "minimax-m3" },
			api: "anthropic-messages",
			expectedRevision: 4,
			confirmConflicts: true,
		}),
	).rejects.toMatchObject({ code: "model-protocol-mismatch" });
	expect(f.mutate).not.toHaveBeenCalled();
});

it("applies a multi-model selection with reasoning efforts and replaces the enabled set", async () => {
	const f = fixture({
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		api: "openai-completions",
		baseURL: OPENCODE_GO_BASE_URL,
		models: [{ id: "keep-me-out", name: "stale" }],
	});
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.applyConfiguration({
		credentialRef: "OPENCODE_GO_API_KEY",
		models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4.1-flash" }],
		api: "openai-completions",
		expectedRevision: 4,
		confirmConflicts: false,
	});
	const call = f.mutate.mock.calls[0] as unknown as [string, Array<{ path: string[]; value: unknown }>, number];
	const modelsOp = call[1].find((op) => op.path.join(".") === "providers.coding-opencode-go.models");
	expect(modelsOp?.value).toEqual([
		expect.objectContaining({
			id: "deepseek-v4-flash",
			reasoningEfforts: { off: null, high: "high", max: "max" },
		}),
		expect.objectContaining({ id: "deepseek-v4.1-flash" }),
	]);
	expect(JSON.stringify(modelsOp?.value)).not.toContain("keep-me-out");
	// DSH refuses non-off null wire values — applied efforts must not declare them.
	const applied = Array.isArray(modelsOp?.value) ? modelsOp.value : [];
	for (const entry of applied) {
		const row = entry as { reasoningEfforts?: Record<string, unknown> };
		const efforts = row.reasoningEfforts;
		if (efforts === undefined || efforts === null) continue;
		for (const [level, wire] of Object.entries(efforts)) {
			if (level === "off") continue;
			expect(typeof wire).toBe("string");
			expect(String(wire).length).toBeGreaterThan(0);
		}
	}
});

it("applies glm-5.3 with DSH-valid reasoningEfforts (no illegal null levels)", async () => {
	const f = fixture({
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		api: "openai-completions",
		baseURL: OPENCODE_GO_BASE_URL,
		models: [],
	});
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.applyConfiguration({
		credentialRef: "OPENCODE_GO_API_KEY",
		models: [{ id: "glm-5.3" }],
		api: "openai-completions",
		expectedRevision: 4,
		confirmConflicts: false,
	});
	const call = f.mutate.mock.calls[0] as unknown as [string, Array<{ path: string[]; value: unknown }>, number];
	const modelsOp = call[1].find((op) => op.path.join(".") === "providers.coding-opencode-go.models");
	expect(modelsOp?.value).toEqual([
		expect.objectContaining({
			id: "glm-5.3",
			name: "GLM-5.3",
			reasoningEfforts: { off: null, high: "high", max: "max" },
		}),
	]);
	const appliedGlm = Array.isArray(modelsOp?.value) ? modelsOp.value : [];
	const efforts = (appliedGlm[0] as { reasoningEfforts?: Record<string, unknown> } | undefined)?.reasoningEfforts;
	expect(Object.keys(efforts ?? {})).toEqual(["off", "high", "max"]);
	expect(JSON.stringify(efforts)).not.toMatch(/"(minimal|low|medium|xhigh)":null/);
});

it("re-apply backfills thinking onto a prior thin glm-5.3 { id } entry", async () => {
	const f = fixture({
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		api: "openai-completions",
		baseURL: OPENCODE_GO_BASE_URL,
		models: [{ id: "glm-5.3" }],
	});
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.applyConfiguration({
		credentialRef: "OPENCODE_GO_API_KEY",
		models: [{ id: "glm-5.3" }],
		api: "openai-completions",
		expectedRevision: 4,
		confirmConflicts: false,
	});
	const call = f.mutate.mock.calls[0] as unknown as [string, Array<{ path: string[]; value: unknown }>, number];
	const modelsOp = call[1].find((op) => op.path.join(".") === "providers.coding-opencode-go.models");
	expect(modelsOp?.value).toEqual([
		expect.objectContaining({
			id: "glm-5.3",
			reasoningEfforts: { off: null, high: "high", max: "max" },
		}),
	]);
});

it("rejects glm-5.3 under a mismatched protocol (negative)", async () => {
	const f = fixture({
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		api: "openai-responses",
		baseURL: "https://opencode.ai/zen/go/v1",
	});
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await expect(
		c.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			models: [{ id: "glm-5.3" }],
			api: "openai-responses",
			expectedRevision: 4,
			confirmConflicts: true,
		}),
	).rejects.toMatchObject({ code: "model-protocol-mismatch" });
	expect(f.mutate).not.toHaveBeenCalled();
});

it("rejects apply without a model when not replacing the selection (negative)", async () => {
	const f = fixture({ apiKeyEnv: "OPENCODE_GO_API_KEY", api: "openai-completions", baseURL: OPENCODE_GO_BASE_URL });
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await expect(
		c.applyConfiguration({
			credentialRef: "OPENCODE_GO_API_KEY",
			expectedRevision: 4,
			confirmConflicts: false,
		}),
	).rejects.toMatchObject({ code: "invalid-configuration" });
	expect(f.mutate).not.toHaveBeenCalled();
});

it("reinjects apiKeyEnv when isolated provider settings lack a credential", async () => {
	const f = fixture({ models: [{ id: "deepseek-v4.1-flash" }] });
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.reinjectCredential();
	expect(f.mutate).toHaveBeenCalledWith(
		"llm-pi-ai",
		[{ op: "set", path: ["providers", "coding-opencode-go", "apiKeyEnv"], value: "OPENCODE_GO_API_KEY" }],
		4,
	);
});

it("does not clobber a different explicit apiKeyEnv during reinject", async () => {
	const f = fixture({ apiKeyEnv: "CUSTOM_GO_KEY", models: [{ id: "deepseek-v4.1-flash" }] });
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.reinjectCredential({ credentialRef: "OPENCODE_GO_API_KEY" });
	expect(f.mutate).not.toHaveBeenCalled();
});

it("migrates plugin-shaped legacy opencode-go into coding-opencode-go without deleting the builtin", async () => {
	const values = new Map<string, string>([["OPENCODE_GO_API_KEY", "fixture"]]);
	const credentials = {
		describe: vi.fn(async (ref: string) => ({
			configured: values.has(String(ref)),
			writable: true,
			source: "store",
		})),
		resolve: vi.fn(async (ref: string) => (values.has(String(ref)) ? { value: values.get(String(ref))! } : undefined)),
		set: vi.fn(async () => undefined),
	} as unknown as CredentialProvider;
	const mutate = vi.fn(async () => undefined);
	const settings: OpenCodeGoSettingsProvider = {
		writable: true,
		describe: () => [
			{
				ns: "llm-pi-ai",
				revision: 7,
				value: {
					providers: {
						"opencode-go": {
							apiKeyEnv: "OPENCODE_GO_API_KEY",
							api: OPENCODE_GO_API,
							baseURL: OPENCODE_GO_BASE_URL,
							models: [{ id: "deepseek-v4.1-flash" }],
						},
					},
				},
			},
		],
		mutate,
	};
	const c = createOpenCodeGoConnectionController({ credentials, settings, callStatus });
	const status = await c.status();
	expect(status.providerId).toBe("coding-opencode-go");
	expect(status.legacy).toEqual({
		providerId: "opencode-go",
		present: true,
		migratable: true,
		targetProviderId: "coding-opencode-go",
	});
	expect(status.configuration.ready).toBe(false);
	await c.migrateLegacyConfiguration({ expectedRevision: 7 });
	expect(mutate).toHaveBeenCalledWith(
		"llm-pi-ai",
		expect.arrayContaining([
			{ op: "set", path: ["providers", "coding-opencode-go", "apiKeyEnv"], value: "OPENCODE_GO_API_KEY" },
			{ op: "set", path: ["providers", "coding-opencode-go", "api"], value: OPENCODE_GO_API },
			{ op: "set", path: ["providers", "coding-opencode-go", "baseURL"], value: OPENCODE_GO_BASE_URL },
		]),
		7,
	);
	const migrateCall = mutate.mock.calls[0] as unknown as [string, Array<{ op: string; path: string[] }>, number];
	const ops = migrateCall[1];
	expect(ops.every((op) => op.path[1] === "coding-opencode-go")).toBe(true);
	expect(ops.some((op) => op.path[1] === "opencode-go")).toBe(false);
});

it("apply writes only the isolated provider id", async () => {
	const f = fixture();
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.applyConfiguration({
		credentialRef: "OPENCODE_GO_API_KEY",
		models: [{ id: "deepseek-v4.1-flash" }],
		expectedRevision: 4,
		confirmConflicts: false,
	});
	const applyCall = f.mutate.mock.calls[0] as unknown as [string, Array<{ path: string[] }>, number];
	const ops = applyCall[1];
	expect(ops.every((op) => op.path[0] === "providers" && op.path[1] === "coding-opencode-go")).toBe(true);
});

it("enriches the live directory with known thinking metadata", async () => {
	const f = fixture();
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const fetchImpl = vi.fn(async () =>
		Response.json({ data: [{ id: "deepseek-v4-flash" }, { id: "grok-4.6" }, { id: "minimax-m3" }] }),
	);
	const c = createOpenCodeGoConnectionController({
		credentials: f.credentials,
		settings: f.settings,
		callStatus,
		fetchImpl,
	});
	const catalog = await c.models("OPENCODE_GO_API_KEY");
	expect(catalog).toHaveLength(3);
	expect(catalog.find((m) => m.id === "deepseek-v4-flash")?.reasoningEfforts).toMatchObject({ high: "high" });
	expect(catalog.find((m) => m.id === "grok-4.6")?.reasoningEfforts).toMatchObject({ xhigh: "xhigh" });
	expect(catalog.find((m) => m.id === "minimax-m3")?.protocol).toBe("anthropic-messages");
});

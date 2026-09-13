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
		describe: () => [{ ns: "llm-pi-ai", revision, value: { providers: { "opencode-go": provider } } }],
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
			reasoningEfforts: ["high"],
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
		expect(f.mutate).toHaveBeenCalledWith(
			"llm-pi-ai",
			expect.arrayContaining([{ op: "set", path: ["providers", "opencode-go", "models"], value: [existing, other] }]),
			4,
		);
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
				{ op: "set", path: ["providers", "opencode-go", "api"], value: OPENCODE_GO_API },
				{ op: "set", path: ["providers", "opencode-go", "baseURL"], value: OPENCODE_GO_BASE_URL },
				{ op: "unset", path: ["providers", "opencode-go", "headers", "x-opencode-session"] },
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
		expect.arrayContaining([{ op: "set", path: ["providers", "opencode-go", "api"], value: "openai-responses" }]),
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
	const modelsOp = call[1].find((op) => op.path.join(".") === "providers.opencode-go.models");
	expect(modelsOp?.value).toEqual([
		expect.objectContaining({
			id: "deepseek-v4-flash",
			reasoningEfforts: expect.objectContaining({ high: "high", max: "max" }),
		}),
		expect.objectContaining({ id: "deepseek-v4.1-flash" }),
	]);
	expect(JSON.stringify(modelsOp?.value)).not.toContain("keep-me-out");
});

it("reinjects apiKeyEnv when native model settings claim opencode-go without a credential", async () => {
	const f = fixture({ models: [{ id: "deepseek-v4.1-flash" }] });
	f.values.set("OPENCODE_GO_API_KEY", "fixture");
	const c = createOpenCodeGoConnectionController({ credentials: f.credentials, settings: f.settings, callStatus });
	await c.reinjectCredential();
	expect(f.mutate).toHaveBeenCalledWith(
		"llm-pi-ai",
		[{ op: "set", path: ["providers", "opencode-go", "apiKeyEnv"], value: "OPENCODE_GO_API_KEY" }],
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

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodingOAuthAdapter, preferredGrokBuildModel } from "../src/adapter.ts";
import {
	CODEX_ROUTING_HINT_HEADER,
	type CodexFastStreamOptions,
	type CodexStreamModel,
	codexRoutingHint,
} from "../src/codex-model-capabilities.ts";
import {
	CLAUDE_CODE_OAUTH_ROUTE,
	CODEX_OAUTH_FAST_ROUTE,
	CODEX_OAUTH_ROUTE,
	CODEX_PI_PROVIDER,
	CODING_OAUTH_OPTIONAL_ROUTES,
	CODING_OAUTH_ROUTES,
	DEFAULT_GROK_BUILD_MODEL,
	GROK_BUILD_ROUTE,
	KIMI_CODE_OAUTH_ROUTE,
	XAI_PI_PROVIDER,
} from "../src/ids.ts";
import { OAUTH_PROVIDER_DEFINITIONS } from "../src/oauth-providers.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import { GROK_BUILD_BASE_URL, grokBuildBaselineModels, grokBuildFingerprintHeaders } from "../src/provider.ts";
import { GrokBuildSession } from "../src/session.ts";
import { GrokBuildCredentialStore, OAuthCredentialFileStore } from "../src/store.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("preferredGrokBuildModel", () => {
	it("prefers grok-4.6 from the baseline catalog", () => {
		expect(preferredGrokBuildModel()).toBe(DEFAULT_GROK_BUILD_MODEL);
		expect(preferredGrokBuildModel([{ id: "grok-4.6" }, { id: "grok-4.5" }])).toBe("grok-4.6");
	});
});

describe("grokBuildBaselineModels", () => {
	it("ships responses-API descriptors on the grok-build route", () => {
		const models = grokBuildBaselineModels();
		expect(models.length).toBeGreaterThan(0);
		for (const model of models) {
			expect(model.provider).toBe(GROK_BUILD_ROUTE);
			expect(model.api).toBe("openai-responses");
			expect(model.baseUrl).toBe(GROK_BUILD_BASE_URL);
		}
		const grok45 = models.find((model) => model.id === "grok-4.5");
		const grok46 = models.find((model) => model.id === "grok-4.6");
		expect(grok45?.reasoning).toBe(true);
		expect(grok45?.input).toEqual(["text", "image"]);
		expect(grok45?.thinkingLevelMap?.off).toBeNull();
		expect(grok45?.thinkingLevelMap?.xhigh).toBeNull();
		expect(grok46?.input).toEqual(["text", "image"]);
		expect(grok46?.thinkingLevelMap?.xhigh).toBe("xhigh");
	});
});

describe("grokBuildFingerprintHeaders", () => {
	it("carries the CLI fingerprint required by risk control", () => {
		const headers = grokBuildFingerprintHeaders();
		expect(headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli");
		expect(headers["x-grok-client-identifier"]).toBe("grok-shell");
		expect(headers["x-grok-client-version"]).toMatch(/^\d+\.\d+\.\d+$/);
		expect(headers["User-Agent"]).toContain("grok-shell/");
	});
});

describe("GrokBuildSession.provider", () => {
	it("registers models under the harness route so the picker can find them", async () => {
		const { createModels } = await import("@earendil-works/pi-ai");
		const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-session-"));
		const session = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "auth.json")));
		const provider = session.provider();
		expect(provider.id).toBe(GROK_BUILD_ROUTE);
		const models = createModels();
		models.setProvider(provider);
		const listed = models.getModels(GROK_BUILD_ROUTE);
		expect(listed.length).toBeGreaterThan(0);
		expect(listed.every((model) => model.provider === GROK_BUILD_ROUTE)).toBe(true);
	});

	it("notifies model discovery after login even when the live catalog fails", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-notify-"));
		const store = new GrokBuildCredentialStore(join(dir, "auth.json"));
		await store.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "grok-access",
			refresh: "grok-refresh",
			expires: Date.now() + 3_600_000,
		}));
		const notify = vi.fn();
		const session = new GrokBuildSession(store, notify);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("unavailable", { status: 503 })),
		);
		await session.refreshLiveCatalog();
		expect(notify).toHaveBeenCalledOnce();
		expect(session.catalogSource).toBe("fallback");
	});

	it("contains token-refresh failures and exposes only a redacted catalog diagnostic", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-grok-build-refresh-failure-"));
		const notify = vi.fn();
		const session = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "auth.json")), notify);
		vi.spyOn(session.models, "getAuth").mockRejectedValue(new Error("Bearer EXAMPLE_ACCESS_TOKEN"));
		await expect(session.refreshLiveCatalog()).resolves.toBeUndefined();
		expect(session.catalogSource).toBe("fallback");
		expect(session.catalogError).toContain("[redacted]");
		expect(session.catalogError).not.toContain("EXAMPLE_ACCESS_TOKEN");
		expect(notify).toHaveBeenCalledOnce();
	});
});

describe("createCodingOAuthAdapter model discovery", () => {
	it("lists only authenticated OAuth routes and marks provider names", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-adapter-"));
		const grokStore = new GrokBuildCredentialStore(join(dir, "grok.json"));
		const grok = new GrokBuildSession(grokStore);
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined);

		for (const route of [GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, KIMI_CODE_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]) {
			expect(await adapter.listModels(route)).toEqual([]);
			expect(adapter.providerInfo(route).name).toMatch(/\(OAuth\)$/u);
		}

		const codex = subscriptions.find((session) => session.definition.route === CODEX_OAUTH_ROUTE)!;
		await codex.store.modify(codex.definition.nativeProviderId, async () => ({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			expires: Date.now() + 3_600_000,
		}));
		const listedCodex = await adapter.listModels(CODEX_OAUTH_ROUTE);
		expect(listedCodex.length).toBeGreaterThan(0);
		expect(await adapter.resolveModel(CODEX_OAUTH_ROUTE, listedCodex[0]!.id)).toMatchObject({
			provider: CODEX_OAUTH_ROUTE,
			id: listedCodex[0]!.id,
		});
		expect(await adapter.listModels(KIMI_CODE_OAUTH_ROUTE)).toEqual([]);

		await grokStore.modify(XAI_PI_PROVIDER, async () => ({
			type: "oauth",
			access: "grok-access",
			refresh: "grok-refresh",
			expires: Date.now() + 3_600_000,
		}));
		expect((await adapter.listModels(GROK_BUILD_ROUTE)).length).toBeGreaterThan(0);
	});

	it("exposes a retry policy that retries AUTH and transient failures on every route", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-retry-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined);
		for (const route of [GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, KIMI_CODE_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]) {
			const policy = adapter.providerRetryPolicy(route);
			expect(policy?.mode).toBe("normal");
			expect(policy).toMatchObject({ maxRetries: 2 });
			const codes = policy?.mode === "normal" ? policy.retryableCodes : [];
			for (const code of ["AUTH", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"]) {
				expect(codes).toContain(code);
			}
			// Quota exhaustion must fail fast with the real message, not retry.
			expect(codes).not.toContain("QUOTA");
			expect(codes).not.toContain("MISSING_CREDENTIAL");
		}
	});

	it("honours a retryPolicy override for every route", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-retry-override-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined, {
			mode: "normal",
			maxRetries: 5,
			retryableCodes: ["RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"],
			backoff: { initialDelayMs: 250, maxDelayMs: 5_000, jitterRatio: 0 },
		});
		const policy = adapter.providerRetryPolicy(KIMI_CODE_OAUTH_ROUTE);
		expect(policy).toMatchObject({ mode: "normal", maxRetries: 5, initialDelayMs: 250, maxDelayMs: 5_000 });
		expect(policy?.mode === "normal" && policy.retryableCodes).not.toContain("AUTH");
	});

	it("omits Fast from default routes and existing call signatures", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-fast-default-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined);
		expect(CODING_OAUTH_ROUTES).not.toContain(CODEX_OAUTH_FAST_ROUTE);
		expect(CODING_OAUTH_OPTIONAL_ROUTES).toEqual([CODEX_OAUTH_FAST_ROUTE]);
		expect(() => adapter.providerInfo(CODEX_OAUTH_FAST_ROUTE)).toThrow(/does not own provider/);
	});

	it("lists only priority-eligible Codex models on the opt-in Fast route", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-fast-list-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const codex = subscriptions.find((session) => session.definition.route === CODEX_OAUTH_ROUTE)!;
		const catalog = codex.availableModels();
		expect(catalog.length).toBeGreaterThan(1);
		const eligible = catalog[0]!;
		const ineligible = catalog[1]!;
		await codex.store.modify(codex.definition.nativeProviderId, async () => ({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			expires: Date.now() + 3_600_000,
		}));
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined, {
			codexFast: { isEligible: (id) => id === eligible.id },
		});
		expect(adapter.providerInfo(CODEX_OAUTH_FAST_ROUTE).name).toBe("OpenAI Codex Fast requested (OAuth)");
		const fastListed = await adapter.listModels(CODEX_OAUTH_FAST_ROUTE);
		expect(fastListed.map((model) => model.id)).toEqual([eligible.id]);
		expect(fastListed.every((model) => model.provider === CODEX_OAUTH_FAST_ROUTE)).toBe(true);
		const normalListed = await adapter.listModels(CODEX_OAUTH_ROUTE);
		expect(normalListed.map((model) => model.id)).toContain(ineligible.id);
		expect(normalListed.every((model) => model.provider === CODEX_OAUTH_ROUTE)).toBe(true);
		expect(eligible.provider).toBe(CODEX_PI_PROVIDER);
	});

	it("injects Fast routing only on the Fast profile while keeping native wire identity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-fast-stream-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const codex = subscriptions.find((session) => session.definition.route === CODEX_OAUTH_ROUTE)!;
		const template = codex.availableModels()[0]!;
		const eligibleId = "gpt-fast-eligible";
		const ineligibleId = "gpt-fast-ineligible";
		const seen: Array<{ model: CodexStreamModel; options?: CodexFastStreamOptions }> = [];
		const real = codex.provider();
		vi.spyOn(codex, "provider").mockImplementation(() => {
			const models = [
				{ ...template, id: eligibleId, provider: CODEX_PI_PROVIDER },
				{ ...template, id: ineligibleId, provider: CODEX_PI_PROVIDER },
			];
			return {
				...real,
				id: CODEX_PI_PROVIDER,
				getModels: () => models,
				stream: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push({ model, ...(options === undefined ? {} : { options }) });
					throw new Error("fixture-stop");
				},
				streamSimple: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
					seen.push({ model, ...(options === undefined ? {} : { options }) });
					throw new Error("fixture-stop");
				},
			} as unknown as typeof real;
		});
		await codex.store.modify(codex.definition.nativeProviderId, async () => ({
			type: "oauth",
			access: "codex-access",
			refresh: "codex-refresh",
			expires: Date.now() + 3_600_000,
		}));
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined, undefined, {
			codexFast: { isEligible: (id) => id === eligibleId },
		});
		expect(await adapter.listModels(CODEX_OAUTH_FAST_ROUTE)).toEqual([
			expect.objectContaining({ id: eligibleId, provider: CODEX_OAUTH_FAST_ROUTE }),
		]);

		const consume = async (provider: string, model: string): Promise<void> => {
			for await (const _chunk of adapter.stream({
				provider,
				model,
				messages: [],
			} as never)) {
				// Drain; the fixture stream throws after recording options.
			}
		};
		await consume(CODEX_OAUTH_ROUTE, eligibleId);
		const normal = seen[0];
		expect(normal?.model).toMatchObject({ id: eligibleId, provider: CODEX_PI_PROVIDER });
		expect(normal?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined();
		expect(await normal?.options?.onPayload?.({ model: eligibleId }, { id: eligibleId })).toBeUndefined();

		seen.length = 0;
		await consume(CODEX_OAUTH_FAST_ROUTE, eligibleId);
		const fast = seen[0];
		expect(fast?.model).toMatchObject({ id: eligibleId, provider: CODEX_PI_PROVIDER });
		expect(fast?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe(codexRoutingHint(eligibleId));
		await expect(fast?.options?.onPayload?.({ model: eligibleId }, { id: eligibleId })).resolves.toMatchObject({
			service_tier: "priority",
		});
	});

	it("uses the refreshed stored token when Kimi OAuth resolves header-only auth", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-kimi-header-auth-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const kimi = subscriptions.find((session) => session.definition.route === KIMI_CODE_OAUTH_ROUTE)!;
		await kimi.store.modify(kimi.definition.nativeProviderId, async () => ({
			type: "oauth",
			access: "kimi-access",
			refresh: "kimi-refresh",
			expires: Date.now() + 3_600_000,
		}));
		vi.spyOn(kimi.models, "getAuth").mockResolvedValue({
			auth: { headers: { Authorization: "Bearer kimi-access" } },
			source: "OAuth",
		});
		const template = kimi.availableModels()[0]!;
		const seen: Array<{ model: unknown; options?: { apiKey?: string } }> = [];
		const real = kimi.provider();
		vi.spyOn(kimi, "provider").mockImplementation(
			() =>
				({
					...real,
					getModels: () => [template],
					stream: (model: unknown, _context: unknown, options?: { apiKey?: string }) => {
						seen.push({ model, ...(options === undefined ? {} : { options }) });
						throw new Error("fixture-stop");
					},
					streamSimple: (model: unknown, _context: unknown, options?: { apiKey?: string }) => {
						seen.push({ model, ...(options === undefined ? {} : { options }) });
						throw new Error("fixture-stop");
					},
				}) as unknown as typeof real,
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined);
		for await (const _chunk of adapter.stream({
			provider: KIMI_CODE_OAUTH_ROUTE,
			model: template.id,
			messages: [],
		} as never)) {
			// Drain the fixture error event emitted after auth resolution.
		}
		expect(kimi.models.getAuth).toHaveBeenCalledWith(kimi.definition.nativeProviderId);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.options?.apiKey).toBe("kimi-access");
	});

	it("maps a failed token refresh to MISSING_CREDENTIAL instead of a bare 401", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dsh-coding-oauth-dead-refresh-"));
		const grok = new GrokBuildSession(new GrokBuildCredentialStore(join(dir, "grok.json")));
		const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
			(definition) =>
				new OAuthProviderSession(
					definition,
					undefined,
					new OAuthCredentialFileStore(
						definition.nativeProviderId,
						join(dir, `${definition.slug}.json`),
						definition.route,
					),
					join(dir, `${definition.slug}-models.json`),
				),
		);
		const kimi = subscriptions.find((session) => session.definition.route === KIMI_CODE_OAUTH_ROUTE)!;
		vi.spyOn(kimi.models, "getAuth").mockRejectedValue(
			new Error("OAuth refresh failed for kimi-coding: Bearer EXAMPLE_ACCESS_TOKEN access_token=EXAMPLE_REFRESH_TOKEN"),
		);
		const adapter = createCodingOAuthAdapter(grok, subscriptions, () => undefined);
		const consume = async (): Promise<void> => {
			for await (const _chunk of adapter.stream({
				provider: KIMI_CODE_OAUTH_ROUTE,
				model: "k3",
				messages: [],
			} as never)) {
				// Drain; the stream must reject before yielding anything.
			}
		};
		await expect(consume()).rejects.toThrow(/sign in/i);
		await consume().then(
			() => expect.unreachable("stream must reject"),
			(error: unknown) => {
				expect((error as { code?: string }).code).toBe("MISSING_CREDENTIAL");
				expect((error as Error).message).toContain("[redacted]");
				expect((error as Error).message).not.toContain("EXAMPLE_ACCESS_TOKEN");
				expect((error as Error).message).not.toContain("EXAMPLE_REFRESH_TOKEN");
				expect((error as { cause?: unknown }).cause).toBeUndefined();
			},
		);
	});
});

import { LlmError } from "@deepseek-ai/dsh-llm";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bindCapabilitySearch,
	bindCapabilityTools,
	bindCodexFastRoute,
	CapabilityRuntimeState,
	type CapabilitySearchRegistry,
	type CapabilityTimer,
	type CapabilityToolRegistry,
	capabilityToolEnabled,
	type ReplaceableAdapterRegistration,
} from "../src/capability-runtime.ts";
import { type CapabilitySettings, DEFAULT_CAPABILITY_SETTINGS } from "../src/capability-settings.ts";
import { CODEX_IMAGE_EDIT_TOOL, CODEX_IMAGE_GENERATE_TOOL } from "../src/capability-tools.ts";
import type { CodexModelCapabilities, CodexModelCapability } from "../src/codex-model-capabilities.ts";
import {
	CODEX_SEARCH_PROVIDER_ID,
	type CodexSearchProvider,
	type CodexSearchRequest,
	type CodexSearchResult,
} from "../src/codex-search.ts";
import {
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
} from "../src/grok-imagine.ts";
import { CODEX_OAUTH_FAST_ROUTE, CODING_OAUTH_ROUTES } from "../src/ids.ts";

const DEFAULT_ROUTES = [...CODING_OAUTH_ROUTES];
const FAST_ROUTES = [...CODING_OAUTH_ROUTES, CODEX_OAUTH_FAST_ROUTE];
const ELIGIBLE_MODEL: CodexModelCapability = { id: "gpt-5.4", serviceTiers: ["priority"] };
const INELIGIBLE_MODEL: CodexModelCapability = { id: "gpt-5.3-codex", serviceTiers: [] };

function settings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return { ...DEFAULT_CAPABILITY_SETTINGS, ...overrides };
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function fakeTool(name: string): ToolDefinition {
	return { name } as ToolDefinition;
}

class FakeSearchRegistry implements CapabilitySearchRegistry {
	readonly providers: CodexSearchProvider[] = [];
	registerCount = 0;
	unregisterCount = 0;

	registerSearchProvider(provider: CodexSearchProvider): () => void {
		this.registerCount += 1;
		this.providers.push(provider);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.unregisterCount += 1;
			const index = this.providers.indexOf(provider);
			if (index >= 0) this.providers.splice(index, 1);
		};
	}

	get current(): CodexSearchProvider | undefined {
		return this.providers[0];
	}
}

class FakeToolRegistry implements CapabilityToolRegistry {
	readonly names: string[] = [];
	readonly unregisterByName = new Map<string, number>();

	register(definition: ToolDefinition): () => void {
		this.names.push(definition.name);
		return () => {
			this.unregisterByName.set(definition.name, (this.unregisterByName.get(definition.name) ?? 0) + 1);
			const index = this.names.indexOf(definition.name);
			if (index >= 0) this.names.splice(index, 1);
		};
	}
}

class FakeRegistration implements ReplaceableAdapterRegistration {
	readonly history: string[][] = [];
	readonly failures: unknown[] = [];

	replace(routes: string[]): void {
		const failure = this.failures.shift();
		if (failure !== undefined) throw failure;
		this.history.push([...routes]);
	}

	get last(): string[] | undefined {
		return this.history[this.history.length - 1];
	}

	publishedFast(): boolean {
		return this.history.some((routes) => routes.includes(CODEX_OAUTH_FAST_ROUTE));
	}
}

class FakeTimer implements CapabilityTimer {
	private nextHandle = 0;
	readonly callbacks = new Map<number, () => void>();
	cleared: unknown[] = [];

	setInterval(callback: () => void, _ms: number): unknown {
		const handle = ++this.nextHandle;
		this.callbacks.set(handle, callback);
		return handle;
	}

	clearInterval(handle: unknown): void {
		this.cleared.push(handle);
		this.callbacks.delete(handle as number);
	}

	tick(): void {
		for (const callback of [...this.callbacks.values()]) callback();
	}
}

class FakeCapabilities implements CodexModelCapabilities {
	refreshImpl: () => Promise<readonly CodexModelCapability[]> = async () => [];
	eligible = new Set<string>();
	cached: readonly CodexModelCapability[] | undefined;

	async refresh(): Promise<readonly CodexModelCapability[]> {
		const models = await this.refreshImpl();
		this.cached = models;
		return models;
	}

	clear(): void {
		this.cached = undefined;
	}

	getCached(): readonly CodexModelCapability[] | undefined {
		return this.cached;
	}

	serviceTiers(): readonly string[] {
		return [];
	}

	isPriorityEligible(modelId: string): boolean {
		return this.eligible.has(modelId);
	}

	isTierEligible(): boolean {
		return false;
	}
}

function fakeSearchProvider(
	search: (request: CodexSearchRequest) => Promise<CodexSearchResult> = async () => ({
		sources: [],
		truncated: false,
	}),
	available = () => true,
): CodexSearchProvider {
	return {
		id: CODEX_SEARCH_PROVIDER_ID,
		available,
		search,
	};
}

describe("CapabilityRuntimeState", () => {
	it("starts at default-off settings", () => {
		const state = new CapabilityRuntimeState();
		expect(state.current()).toEqual(DEFAULT_CAPABILITY_SETTINGS);
		expect(state.current().codexSearch).toBe(false);
		expect(state.current().codexFast).toBe(false);
	});

	it("suppresses equal updates and does not re-notify", () => {
		const state = new CapabilityRuntimeState();
		const seen: CapabilitySettings[] = [];
		const unsubscribe = state.subscribe((next) => {
			seen.push(next);
		});
		expect(seen).toHaveLength(1);
		expect(state.set(DEFAULT_CAPABILITY_SETTINGS)).toBe(state.current());
		expect(state.set({})).toBe(state.current());
		expect(seen).toHaveLength(1);
		const enabled = state.set(settings({ codexSearch: true }));
		expect(enabled.codexSearch).toBe(true);
		expect(seen).toHaveLength(2);
		expect(state.set(settings({ codexSearch: true }))).toBe(state.current());
		expect(seen).toHaveLength(2);
		unsubscribe();
	});

	it("unsubscribe contains further notifications", () => {
		const state = new CapabilityRuntimeState();
		const seen: boolean[] = [];
		const unsubscribe = state.subscribe((next) => {
			seen.push(next.codexImages);
		}, false);
		expect(seen).toEqual([]);
		state.set(settings({ codexImages: true }));
		expect(seen).toEqual([true]);
		unsubscribe();
		unsubscribe();
		state.set(settings({ codexImages: false }));
		expect(seen).toEqual([true]);
	});

	it("reset restores defaults and notifies only when something changed", () => {
		const state = new CapabilityRuntimeState();
		const seen: CapabilitySettings[] = [];
		state.subscribe((next) => {
			seen.push(next);
		}, false);
		state.set(settings({ codexFast: true, searchResults: 2 }));
		expect(state.reset()).toEqual(DEFAULT_CAPABILITY_SETTINGS);
		expect(seen.at(-1)).toEqual(DEFAULT_CAPABILITY_SETTINGS);
		const after = seen.length;
		expect(state.reset()).toEqual(DEFAULT_CAPABILITY_SETTINGS);
		expect(seen).toHaveLength(after);
	});
});

describe("bindCapabilitySearch", () => {
	it("registers nothing by default", () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeSearchRegistry();
		const dispose = bindCapabilitySearch(state, registry, fakeSearchProvider());
		expect(registry.registerCount).toBe(0);
		expect(registry.providers).toEqual([]);
		dispose();
	});

	it("registers only while search is enabled and clamps maxResults to the live limit", async () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeSearchRegistry();
		const seen: CodexSearchRequest[] = [];
		const dispose = bindCapabilitySearch(
			state,
			registry,
			fakeSearchProvider(async (request) => {
				seen.push(request);
				return { sources: [], truncated: false };
			}),
		);
		state.set(settings({ codexSearch: true, searchResults: 5 }));
		expect(registry.registerCount).toBe(1);
		const gated = registry.current;
		expect(gated?.available()).toBe(true);
		await gated?.search({ query: "dsh", maxResults: 8 });
		await gated?.search({ query: "dsh" });
		await gated?.search({ query: "dsh", maxResults: 2 });
		state.set(settings({ codexSearch: true, searchResults: 3 }));
		await gated?.search({ query: "dsh", maxResults: 8 });
		expect(seen.map((request) => request.maxResults)).toEqual([5, 5, 2, 3]);
		dispose();
	});

	it("fails execute after disable and unregisters immediately", async () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeSearchRegistry();
		const innerSearch = vi.fn(async () => ({ sources: [], truncated: false }));
		const dispose = bindCapabilitySearch(state, registry, fakeSearchProvider(innerSearch));
		state.set(settings({ codexSearch: true }));
		const gated = registry.current;
		expect(gated).toBeDefined();
		state.set(settings({ codexSearch: false }));
		expect(registry.unregisterCount).toBe(1);
		expect(registry.providers).toEqual([]);
		expect(gated?.available()).toBe(false);
		await expect(gated?.search({ query: "dsh" })).rejects.toMatchObject({
			code: "INVALID_ARGS",
			message: "Codex search is disabled",
		});
		await expect(gated?.search({ query: "dsh" })).rejects.toBeInstanceOf(LlmError);
		expect(innerSearch).not.toHaveBeenCalled();
		dispose();
	});

	it("disposer is idempotent and stops later enable from registering", () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeSearchRegistry();
		const dispose = bindCapabilitySearch(state, registry, fakeSearchProvider());
		state.set(settings({ codexSearch: true }));
		expect(registry.registerCount).toBe(1);
		dispose();
		dispose();
		expect(registry.unregisterCount).toBe(1);
		state.set(settings({ codexSearch: false }));
		state.set(settings({ codexSearch: true }));
		expect(registry.registerCount).toBe(1);
	});
});

describe("capabilityToolEnabled", () => {
	it("maps each known tool onto the correct live flags", () => {
		expect(capabilityToolEnabled(CODEX_IMAGE_GENERATE_TOOL, settings())).toBe(false);
		expect(capabilityToolEnabled(CODEX_IMAGE_GENERATE_TOOL, settings({ codexImages: true }))).toBe(true);
		expect(capabilityToolEnabled(CODEX_IMAGE_EDIT_TOOL, settings({ codexImages: true }))).toBe(false);
		expect(capabilityToolEnabled(CODEX_IMAGE_EDIT_TOOL, settings({ codexImageEdits: true }))).toBe(false);
		expect(capabilityToolEnabled(CODEX_IMAGE_EDIT_TOOL, settings({ codexImages: true, codexImageEdits: true }))).toBe(
			true,
		);
		expect(capabilityToolEnabled(GROK_IMAGINE_IMAGE_TOOL, settings({ grokImagineImage: true }))).toBe(true);
		expect(capabilityToolEnabled(GROK_IMAGINE_VIDEO_TOOL, settings({ grokImagineVideo: true }))).toBe(true);
		expect(capabilityToolEnabled(GROK_IMAGINE_VIDEO_STATUS_TOOL, settings({ grokImagineVideo: true }))).toBe(true);
		expect(
			capabilityToolEnabled(
				"not_a_capability_tool",
				settings({
					codexImages: true,
					codexImageEdits: true,
					grokImagineImage: true,
					grokImagineVideo: true,
				}),
			),
		).toBe(false);
	});
});

describe("bindCapabilityTools", () => {
	const definitions = [
		fakeTool(CODEX_IMAGE_GENERATE_TOOL),
		fakeTool(CODEX_IMAGE_EDIT_TOOL),
		fakeTool(GROK_IMAGINE_IMAGE_TOOL),
		fakeTool(GROK_IMAGINE_VIDEO_TOOL),
		fakeTool(GROK_IMAGINE_VIDEO_STATUS_TOOL),
		fakeTool("unknown_optional_tool"),
	];

	it("registers nothing by default, including unknown tools", () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeToolRegistry();
		const dispose = bindCapabilityTools(state, registry, definitions);
		expect(registry.names).toEqual([]);
		state.set(
			settings({
				codexImages: true,
				codexImageEdits: true,
				grokImagineImage: true,
				grokImagineVideo: true,
			}),
		);
		expect(registry.names).toEqual([
			CODEX_IMAGE_GENERATE_TOOL,
			CODEX_IMAGE_EDIT_TOOL,
			GROK_IMAGINE_IMAGE_TOOL,
			GROK_IMAGINE_VIDEO_TOOL,
			GROK_IMAGINE_VIDEO_STATUS_TOOL,
		]);
		expect(registry.names).not.toContain("unknown_optional_tool");
		dispose();
	});

	it("requires both image flags for edit and unregisters immediately", () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeToolRegistry();
		const dispose = bindCapabilityTools(state, registry, definitions);
		state.set(settings({ codexImages: true }));
		expect(registry.names).toEqual([CODEX_IMAGE_GENERATE_TOOL]);
		state.set(settings({ codexImages: true, codexImageEdits: true }));
		expect(registry.names).toEqual([CODEX_IMAGE_GENERATE_TOOL, CODEX_IMAGE_EDIT_TOOL]);
		state.set(settings({ codexImages: true, codexImageEdits: false }));
		expect(registry.names).toEqual([CODEX_IMAGE_GENERATE_TOOL]);
		expect(registry.unregisterByName.get(CODEX_IMAGE_EDIT_TOOL)).toBe(1);
		state.set(settings());
		expect(registry.names).toEqual([]);
		expect(registry.unregisterByName.get(CODEX_IMAGE_GENERATE_TOOL)).toBe(1);
		dispose();
	});

	it("keeps video generate and status on the same flag and is disposer-idempotent", () => {
		const state = new CapabilityRuntimeState();
		const registry = new FakeToolRegistry();
		const dispose = bindCapabilityTools(state, registry, definitions);
		state.set(settings({ grokImagineVideo: true }));
		expect(registry.names).toEqual([GROK_IMAGINE_VIDEO_TOOL, GROK_IMAGINE_VIDEO_STATUS_TOOL]);
		dispose();
		dispose();
		expect(registry.names).toEqual([]);
		expect(registry.unregisterByName.get(GROK_IMAGINE_VIDEO_TOOL)).toBe(1);
		expect(registry.unregisterByName.get(GROK_IMAGINE_VIDEO_STATUS_TOOL)).toBe(1);
		state.set(settings({ grokImagineVideo: true, grokImagineImage: true }));
		expect(registry.names).toEqual([]);
	});
});

describe("bindCodexFastRoute", () => {
	it("does not publish the Fast route by default", () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const dispose = bindCodexFastRoute(state, capabilities, registration, { refreshIntervalMs: 0 });
		expect(registration.history).toEqual([]);
		expect(registration.publishedFast()).toBe(false);
		expect(CODING_OAUTH_ROUTES).not.toContain(CODEX_OAUTH_FAST_ROUTE);
		dispose();
	});

	it("publishes only after a live refresh lists at least one priority-eligible model", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		const pending = deferred<readonly CodexModelCapability[]>();
		capabilities.refreshImpl = () => pending.promise;
		const dispose = bindCodexFastRoute(state, capabilities, registration, { refreshIntervalMs: 0 });
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.publishedFast()).toBe(false);
		pending.resolve([INELIGIBLE_MODEL, ELIGIBLE_MODEL]);
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		dispose();
	});

	it("fails closed on empty or failed refresh", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const errors: unknown[] = [];
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		capabilities.refreshImpl = async () => [];
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 0,
			onError: (error) => {
				errors.push(error);
			},
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.publishedFast()).toBe(false);

		capabilities.refreshImpl = async () => {
			throw new Error("catalog down");
		};
		state.set(settings({ codexFast: false }));
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.publishedFast()).toBe(false);
		expect(errors).toHaveLength(1);
		dispose();
	});

	it("withdraws synchronously when account-scoped catalog state is cleared", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		capabilities.refreshImpl = async () => [ELIGIBLE_MODEL];
		const dispose = bindCodexFastRoute(state, capabilities, registration, { refreshIntervalMs: 0 });
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);

		const pending = deferred<readonly CodexModelCapability[]>();
		capabilities.refreshImpl = () => pending.promise;
		capabilities.clear();
		state.refresh();
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		pending.resolve([ELIGIBLE_MODEL]);
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		dispose();
	});

	it("withdraws synchronously on disable and ignores a late eligible refresh", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		const pending = deferred<readonly CodexModelCapability[]>();
		capabilities.refreshImpl = () => pending.promise;
		const dispose = bindCodexFastRoute(state, capabilities, registration, { refreshIntervalMs: 0 });
		state.set(settings({ codexFast: true }));
		state.set(settings({ codexFast: false }));
		expect(registration.publishedFast()).toBe(false);
		pending.resolve([ELIGIBLE_MODEL]);
		await flush();
		expect(registration.publishedFast()).toBe(false);
		expect(registration.last ?? DEFAULT_ROUTES).not.toContain(CODEX_OAUTH_FAST_ROUTE);
		dispose();
	});

	it("does not republish a late refresh after a published route is disabled", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const timer = new FakeTimer();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		const second = deferred<readonly CodexModelCapability[]>();
		let calls = 0;
		capabilities.refreshImpl = async () => {
			calls += 1;
			if (calls === 1) return [ELIGIBLE_MODEL];
			return second.promise;
		};
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 1_000,
			timer,
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		timer.tick();
		state.set(settings({ codexFast: false }));
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		second.resolve([ELIGIBLE_MODEL]);
		await flush();
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		expect(registration.history.filter((routes) => routes.includes(CODEX_OAUTH_FAST_ROUTE))).toHaveLength(1);
		dispose();
	});

	it("lets a fake-timer refresh withdraw a previously published route", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const timer = new FakeTimer();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		const results: Array<readonly CodexModelCapability[]> = [[ELIGIBLE_MODEL], []];
		capabilities.refreshImpl = async () => results.shift() ?? [];
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 1_000,
			timer,
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		timer.tick();
		await flush();
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		dispose();
	});

	it("does not mark Fast published when an enable replace fails and retries later", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const errors: unknown[] = [];
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		capabilities.cached = [ELIGIBLE_MODEL];
		capabilities.refreshImpl = async () => [ELIGIBLE_MODEL];
		registration.failures.push(new LlmError("duplicate", "DUPLICATE_ADAPTER"));
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 0,
			onError: (error) => errors.push(error),
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.publishedFast()).toBe(false);
		expect(errors).toHaveLength(1);
		state.refresh();
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		dispose();
	});

	it("keeps retrying a failed withdraw while disabled", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const timer = new FakeTimer();
		const errors: unknown[] = [];
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		capabilities.refreshImpl = async () => [ELIGIBLE_MODEL];
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 1_000,
			timer,
			onError: (error) => errors.push(error),
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(registration.last).toEqual(FAST_ROUTES);
		registration.failures.push(new Error("transient replace failure"));
		state.set(settings({ codexFast: false }));
		expect(registration.last).toEqual(FAST_ROUTES);
		expect(timer.callbacks.size).toBe(1);
		expect(errors).toHaveLength(1);
		timer.tick();
		await flush();
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		expect(timer.callbacks.size).toBe(0);
		dispose();
	});

	it("clears the timer and withdraws the route on dispose, including in-flight refresh", async () => {
		const state = new CapabilityRuntimeState();
		const capabilities = new FakeCapabilities();
		const registration = new FakeRegistration();
		const timer = new FakeTimer();
		capabilities.eligible.add(ELIGIBLE_MODEL.id);
		const pending = deferred<readonly CodexModelCapability[]>();
		let calls = 0;
		capabilities.refreshImpl = async () => {
			calls += 1;
			if (calls === 1) return [ELIGIBLE_MODEL];
			return pending.promise;
		};
		const dispose = bindCodexFastRoute(state, capabilities, registration, {
			refreshIntervalMs: 1_000,
			timer,
		});
		state.set(settings({ codexFast: true }));
		await flush();
		expect(timer.callbacks.size).toBe(1);
		expect(registration.last).toEqual(FAST_ROUTES);
		timer.tick();
		dispose();
		dispose();
		expect(timer.callbacks.size).toBe(0);
		expect(timer.cleared).toHaveLength(1);
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		pending.resolve([ELIGIBLE_MODEL]);
		await flush();
		timer.tick();
		await flush();
		expect(registration.last).toEqual(DEFAULT_ROUTES);
		expect(registration.history.filter((routes) => routes.includes(CODEX_OAUTH_FAST_ROUTE))).toHaveLength(1);
	});
});

afterEach(() => {
	vi.useRealTimers();
});

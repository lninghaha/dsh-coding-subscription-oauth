import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	CapabilitySettingsPatch,
	CapabilitySettingsScope,
	CapabilitySettingsService,
} from "../src/capability-settings.ts";
import { GrokImagineClient } from "../src/grok-imagine.ts";
import { apply } from "../src/index.ts";
import { MediaStore } from "../src/media-store.ts";
import { OAuthProviderSession } from "../src/oauth-session.ts";
import { GrokBuildSession } from "../src/session.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

function liveSettings(initial: CapabilitySettingsPatch): {
	service: CapabilitySettingsService;
	set(next: CapabilitySettingsPatch): void;
	watcherCount(): number;
} {
	let value: CapabilitySettingsPatch = initial;
	const watchers = new Set<(next: unknown, prev: unknown) => void | Promise<void>>();
	const scope: CapabilitySettingsScope = {
		get: () => value,
		watch: (callback) => {
			watchers.add(callback);
			return () => {
				watchers.delete(callback);
			};
		},
		update: async () => undefined,
		replace: async () => undefined,
	};
	return {
		service: {
			writable: true,
			register: () => scope,
		},
		set(next) {
			const previous = value;
			value = next;
			for (const watcher of [...watchers]) void watcher(next, previous);
		},
		watcherCount: () => watchers.size,
	};
}

describe("plugin startup catalog initialization", () => {
	it("applies composition capability defaults before an optional settings service exists", () => {
		vi.spyOn(GrokBuildSession.prototype, "loadCachedCatalog").mockResolvedValue(undefined);
		vi.spyOn(OAuthProviderSession.prototype, "loadCachedModels").mockResolvedValue(undefined);
		vi.spyOn(GrokBuildSession.prototype, "refreshLiveCatalog").mockResolvedValue(undefined);
		const registration = Object.assign(vi.fn(), { replace: vi.fn() });
		const registerSearchProvider = vi.fn(() => vi.fn());
		const child = {
			get: vi.fn((name: string) => (name === "web" ? { registerSearchProvider } : undefined)),
			effect: vi.fn((setup: () => unknown) => setup()),
		};
		const context = {
			logger: () => ({ warn: vi.fn() }),
			emit: vi.fn(),
			effect: vi.fn((setup: () => unknown) => setup()),
			llm: { registerAdapter: vi.fn(() => registration) },
			get: vi.fn(() => undefined),
			inject: vi.fn((services: readonly string[], callback: (ctx: unknown) => void) => {
				if (services.length === 1 && services[0] === "web") callback(child);
			}),
		} as unknown as Context;

		apply(context, { capabilities: { codexSearch: true, searchResults: 3 } });
		expect(registerSearchProvider).toHaveBeenCalledOnce();
	});

	it("releases an obsolete settings watcher before reinjection and restores composition defaults on dispose", () => {
		vi.spyOn(GrokBuildSession.prototype, "loadCachedCatalog").mockResolvedValue(undefined);
		vi.spyOn(OAuthProviderSession.prototype, "loadCachedModels").mockResolvedValue(undefined);
		vi.spyOn(GrokBuildSession.prototype, "refreshLiveCatalog").mockResolvedValue(undefined);
		const registration = Object.assign(vi.fn(), { replace: vi.fn() });
		const searchReleases: ReturnType<typeof vi.fn>[] = [];
		const registerSearchProvider = vi.fn(() => {
			const release = vi.fn();
			searchReleases.push(release);
			return release;
		});
		let settingsInjection: ((ctx: Context) => void) | undefined;
		const webCtx = {
			get: vi.fn((service: string) => (service === "web" ? { registerSearchProvider } : undefined)),
			effect: vi.fn((setup: () => unknown) => setup()),
		} as unknown as Context;
		const context = {
			logger: () => ({ warn: vi.fn() }),
			emit: vi.fn(),
			effect: vi.fn(),
			llm: { registerAdapter: vi.fn(() => registration) },
			get: vi.fn(() => undefined),
			inject: vi.fn((services: readonly string[], callback: (ctx: Context) => void) => {
				if (services.length === 1 && services[0] === "settings") settingsInjection = callback;
				if (services.length === 1 && services[0] === "web") callback(webCtx);
			}),
		} as unknown as Context;

		apply(context, { capabilities: { codexSearch: false } });
		expect(settingsInjection).toBeDefined();
		expect(registerSearchProvider).not.toHaveBeenCalled();

		const attach = (live: ReturnType<typeof liveSettings>): (() => void) => {
			let release = (): void => undefined;
			const child = {
				get: vi.fn((service: string) => (service === "settings" ? live.service : undefined)),
				effect: vi.fn((setup: () => () => void) => {
					release = setup();
				}),
				inject: vi.fn(),
			} as unknown as Context;
			settingsInjection!(child);
			return () => release();
		};

		const first = liveSettings({ codexSearch: true });
		attach(first);
		expect(first.watcherCount()).toBe(1);
		expect(registerSearchProvider).toHaveBeenCalledOnce();

		const second = liveSettings({ codexSearch: false });
		const releaseSecond = attach(second);
		expect(first.watcherCount()).toBe(0);
		expect(searchReleases[0]).toHaveBeenCalledOnce();
		first.set({ codexSearch: true });
		expect(registerSearchProvider).toHaveBeenCalledOnce();

		second.set({ codexSearch: true });
		expect(registerSearchProvider).toHaveBeenCalledTimes(2);
		releaseSecond();
		expect(second.watcherCount()).toBe(0);
		expect(searchReleases[1]).toHaveBeenCalledOnce();
	});

	it("aborts the Imagine client before asynchronous media cleanup during injected-service teardown", async () => {
		vi.spyOn(GrokBuildSession.prototype, "loadCachedCatalog").mockResolvedValue(undefined);
		vi.spyOn(OAuthProviderSession.prototype, "loadCachedModels").mockResolvedValue(undefined);
		vi.spyOn(GrokBuildSession.prototype, "refreshLiveCatalog").mockResolvedValue(undefined);
		const order: string[] = [];
		const originalDispose = GrokImagineClient.prototype.dispose;
		vi.spyOn(GrokImagineClient.prototype, "dispose").mockImplementation(function disposeImagine(
			this: GrokImagineClient,
		) {
			order.push("dispose");
			originalDispose.call(this);
		});
		vi.spyOn(MediaStore.prototype, "cleanup").mockImplementation(async () => {
			order.push("cleanup");
			return { expiredArtifacts: 0, removedObjects: 0 };
		});
		const effects: Array<{ label?: string; setup: () => unknown }> = [];
		const pending: Promise<unknown>[] = [];
		const attachments = {
			imageLimits: {
				maxImageBytes: 1024,
				maxImagesPerMessage: 4,
				maxMessageImageBytes: 4096,
				mediaTypes: ["image/png"],
			},
			validateImage: async () => undefined,
			saveImage: async () => ({
				attachmentId: `sha256:${"ab".repeat(32)}`,
				mediaType: "image/png",
				bytes: 1,
				width: 1,
				height: 1,
			}),
			readImage: async () => {
				throw new Error("not used");
			},
		};
		const services: Record<string, unknown> = {
			tools: { register: vi.fn(() => vi.fn()) },
			attachments,
			credentials: { resolve: async () => undefined },
			webServer: { register: vi.fn(() => vi.fn()) },
		};
		const toolCtx = {
			...services,
			get: vi.fn((service: string) => services[service]),
			effect: vi.fn((setup: () => unknown, label?: string) => {
				effects.push({ setup, ...(label === undefined ? {} : { label }) });
			}),
		} as unknown as Context;
		const registration = Object.assign(vi.fn(), { replace: vi.fn() });
		const context = {
			logger: () => ({ warn: vi.fn() }),
			emit: vi.fn(),
			effect: vi.fn(),
			llm: {
				registerAdapter: vi.fn(() => registration),
				resolveModelInfo: vi.fn(),
			},
			get: vi.fn(() => undefined),
			inject: vi.fn((requested: readonly string[], callback: (ctx: Context) => unknown) => {
				if (requested.join(",") !== "tools,attachments,credentials,webServer") return;
				const result = callback(toolCtx);
				if (result instanceof Promise) pending.push(result);
			}),
		} as unknown as Context;

		apply(context, {});
		await Promise.all(pending);
		await new Promise<void>((resolve) => setImmediate(resolve));
		order.length = 0;
		expect(effects.some((effect) => effect.label?.includes("imagine download routes") === true)).toBe(true);
		const lifetime = effects.find((effect) => effect.label?.includes("Imagine client and media lifetime") === true);
		expect(lifetime).toBeDefined();
		const dispose = lifetime!.setup();
		expect(dispose).toBeTypeOf("function");
		await (dispose as () => void | Promise<void>)();
		expect(order).toEqual(["dispose", "cleanup"]);
	});

	it("contains cache and refresh failures while registering the adapter", async () => {
		vi.spyOn(GrokBuildSession.prototype, "loadCachedCatalog").mockRejectedValue(new Error("grok cache failed"));
		vi.spyOn(OAuthProviderSession.prototype, "loadCachedModels").mockRejectedValue(new Error("oauth cache failed"));
		const refresh = vi
			.spyOn(GrokBuildSession.prototype, "refreshLiveCatalog")
			.mockRejectedValue(new Error("refresh failed"));
		const warn = vi.fn();
		const registration = Object.assign(vi.fn(), { replace: vi.fn() });
		const registerAdapter = vi.fn(() => registration);
		const context = {
			logger: () => ({ warn }),
			emit: vi.fn(),
			effect: vi.fn((setup: () => unknown) => setup()),
			llm: { registerAdapter },
			get: vi.fn(() => undefined),
			inject: vi.fn(),
		} as unknown as Context;

		apply(context, {});
		expect(registerAdapter).toHaveBeenCalledOnce();

		await new Promise<void>((resolve) => setImmediate(resolve));
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(refresh).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith("one or more OAuth model caches could not be loaded; using in-memory fallbacks");
		expect(warn).toHaveBeenCalledWith("background OAuth model catalog initialization failed; using static fallbacks");
	});
});

import { readFile } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { describe, expect, it, vi } from "vitest";
import { createDshClientAdapter } from "../src/client/dshClientAdapter.ts";
import { DSH_EXACT_BOM } from "../src/compatibility.ts";
import { createDshHostAdapter } from "../src/dsh-host-adapter.ts";

describe("DSH compatibility contracts", () => {
	it("keeps the published BOM identical to the executable exact-version gate", async () => {
		const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
			dsh: { compatibility: { bom: Record<string, string> } };
		};
		expect(manifest.dsh.compatibility.bom).toEqual(DSH_EXACT_BOM);
		for (const version of Object.values(manifest.dsh.compatibility.bom)) {
			expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
		}
		const matrix = JSON.parse(await readFile(new URL("../compatibility/dsh-bom.json", import.meta.url), "utf8")) as {
			coreAbi: string;
			verified: { packages: Record<string, string> };
			candidates: Array<{ status: string }>;
		};
		expect(matrix.coreAbi).toBe("dsh-coding-oauth-core/v1");
		expect(matrix.verified.packages).toEqual(manifest.dsh.compatibility.bom);
		expect(matrix.candidates.every((candidate) => candidate.status === "unverified")).toBe(true);
	});

	it("reports missing host APIs before participant activation", () => {
		const adapter = createDshHostAdapter({} as Context);
		expect(adapter.participantId).toBe("coding-subscription-oauth");
		expect(adapter.diagnostics().map((item) => item.id)).toContain("host.api.llm.registerAdapter");
		expect(() => adapter.assertCompatible()).toThrow(/incompatible DSH host API/);
	});

	it("reports a missing optional LLM registry as degraded while owner Web APIs remain usable", () => {
		const context = {
			effect() {},
			inject() {},
			get() {},
			logger() {},
		} as unknown as Context;
		const unInjected = new Set<PropertyKey>(["webServer", "settings", "credentials", "llm", "ownerRequestPolicy"]);
		const adapter = createDshHostAdapter(
			new Proxy(context, {
				get(target, property, receiver) {
					if (unInjected.has(property)) {
						throw new Error(`cannot get property "${String(property)}" without inject`);
					}
					return Reflect.get(target, property, receiver);
				},
			}),
		);

		expect(adapter.compatibility().status).toBe("degraded");
		expect(() => adapter.assertCompatible()).toThrow(/host\.api\.llm\.registerAdapter/);
	});

	it("accepts the exact host surface used by the participant", () => {
		const context = {
			effect() {},
			inject() {},
			get() {},
			logger() {},
			llm: { registerAdapter() {} },
		} as unknown as Context;
		const adapter = createDshHostAdapter(context);
		expect(adapter.diagnostics()).toEqual([]);
		expect(() => adapter.assertCompatible()).not.toThrow();
	});

	it("discovers a DSH-native owner request policy without coupling it to activation", () => {
		const policy = { authorize: vi.fn(), diagnostics: vi.fn(() => []) };
		const context = {
			effect() {},
			inject() {},
			get(name: string) {
				return name === "ownerRequestPolicy" ? policy : undefined;
			},
			logger() {},
			llm: { registerAdapter() {} },
		} as unknown as Context;
		const adapter = createDshHostAdapter(context);

		expect(adapter.ownerRequestPolicy()).toBe(policy);
		expect(adapter.compatibility().capabilities.ownerRequestPolicy).toEqual({
			state: "available",
			contract: "owner-request-policy-v1",
		});
	});

	it("accepts the exact browser surface used by the settings participant", () => {
		const context = {
			effect() {},
			locale: { register() {}, bind() {} },
			slots: { inject() {}, register() {} },
		} as unknown as ClientContext;
		const adapter = createDshClientAdapter(context);
		expect(adapter.diagnostics()).toEqual([]);
		expect(() => adapter.assertCompatible()).not.toThrow();
	});

	it("keeps an independent settings entry when slots are unavailable", () => {
		const effectDisposers: Array<() => void> = [];
		const context = {
			effect(callback: () => (() => void) | undefined) {
				const dispose = callback();
				if (dispose) effectDisposers.push(dispose);
			},
			locale: { register() {}, bind() {} },
		} as unknown as ClientContext;
		const mountFallback = vi.fn(() => vi.fn());
		const register = vi.fn(() => vi.fn());
		const adapter = createDshClientAdapter(context);

		expect(adapter.diagnostics()).toContainEqual(
			expect.objectContaining({ id: "client.slots.inject", level: "warning" }),
		);
		expect(() => adapter.assertCompatible()).not.toThrow();
		adapter.installSlots({ mountFallback, register });

		expect(mountFallback).toHaveBeenCalledOnce();
		expect(register).not.toHaveBeenCalled();
		effectDisposers.forEach((dispose) => dispose());
		expect(mountFallback.mock.results[0]?.value).toHaveBeenCalledOnce();
	});

	it("registers direct slots without mounting an independent entry", () => {
		const inject = vi.fn();
		const context = {
			effect(callback: () => (() => void) | undefined) {
				callback();
			},
			inject,
			locale: { register() {}, bind() {} },
			slots: { inject() {}, register() {} },
		} as unknown as ClientContext;
		const mountFallback = vi.fn(() => vi.fn());
		const register = vi.fn(() => vi.fn());

		createDshClientAdapter(context).installSlots({ mountFallback, register });

		expect(register).toHaveBeenCalledOnce();
		expect(mountFallback).not.toHaveBeenCalled();
		expect(inject).not.toHaveBeenCalled();
	});

	it("replaces the independent entry when delayed slots become available", () => {
		let activateSlots: ((context: ClientContext) => unknown) | undefined;
		const context = {
			effect(callback: () => (() => void) | undefined) {
				callback();
			},
			inject(_services: readonly string[], callback: (context: ClientContext) => unknown) {
				activateSlots = callback;
			},
			locale: { register() {}, bind() {} },
		} as unknown as ClientContext;
		const disposeFallback = vi.fn();
		const mountFallback = vi.fn(() => disposeFallback);
		const register = vi.fn(() => vi.fn());
		createDshClientAdapter(context).installSlots({ mountFallback, register });

		activateSlots?.({
			slots: { inject() {}, register() {} },
		} as unknown as ClientContext);
		activateSlots?.({
			slots: { inject() {}, register() {} },
		} as unknown as ClientContext);

		expect(disposeFallback).toHaveBeenCalledOnce();
		expect(register).toHaveBeenCalledOnce();
	});

	it("uses Cordis reflection without reading an uninjected slots property", () => {
		const slots = { inject() {}, register() {} };
		const target = {
			effect(callback: () => (() => void) | undefined) {
				callback();
			},
			inject: vi.fn(),
			get(name: string) {
				return name === "slots" ? slots : undefined;
			},
			locale: { register() {}, bind() {} },
		};
		const context = new Proxy(target, {
			get(object, property, receiver) {
				if (property === "slots") throw new Error('cannot get property "slots" without inject');
				return Reflect.get(object, property, receiver);
			},
		}) as unknown as ClientContext;
		const mountFallback = vi.fn(() => vi.fn());
		const register = vi.fn(() => vi.fn());

		const adapter = createDshClientAdapter(context);
		expect(adapter.diagnostics()).toEqual([]);
		adapter.installSlots({ mountFallback, register });

		expect(register).toHaveBeenCalledOnce();
		expect(mountFallback).not.toHaveBeenCalled();
		expect(target.inject).not.toHaveBeenCalled();
	});
});

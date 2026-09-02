import { Context, Service } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply, inject, name } from "../src/index.ts";

class TestWebServer extends Service {
	readonly paths = new Set<string>();
	constructor(ctx: Context) {
		super(ctx, "webServer");
	}
	register(route: { path: string }): () => void {
		if (this.paths.has(route.path)) throw new Error(`duplicate route ${route.path}`);
		this.paths.add(route.path);
		return () => this.paths.delete(route.path);
	}
}

describe("Cordis webServer lifecycle", () => {
	it("waits for the real Service, registers once, and releases routes on root disposal", async () => {
		const root = new Context();
		expect(inject).toEqual(["webServer"]);
		const fiber = root.plugin({ name, inject, apply });
		await Promise.resolve();
		expect(root.registry.get(apply)?.fibers.length).toBe(1);
		let webServer: TestWebServer | undefined;
		const serviceFiber = root.plugin((ctx) => {
			webServer = new TestWebServer(ctx);
		});
		await serviceFiber;
		await fiber;
		expect(webServer?.paths.size).toBeGreaterThan(0);
		const initialPaths = [...webServer!.paths].sort();
		expect(initialPaths).toHaveLength(25);
		await serviceFiber.dispose();
		expect(webServer!.paths.size).toBe(0);
		let replacement: TestWebServer | undefined;
		const replacementFiber = root.plugin((ctx) => {
			replacement = new TestWebServer(ctx);
		});
		await replacementFiber;
		await fiber;
		expect([...replacement!.paths].sort()).toEqual(initialPaths);
		expect(replacement!.paths).toHaveLength(25);
		expect(root.registry.get(apply)?.fibers.length).toBe(1);
		await replacementFiber.dispose();
		expect(replacement?.paths.size).toBe(0);
		await fiber.dispose();
		expect(root.registry.get(apply)).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import {
	type PluginWebRoute,
	registerWebRouteSetupAtomically,
	registerWebRoutesAtomically,
} from "../../src/core/web-routes.ts";

function route(path: string): PluginWebRoute {
	return { kind: "exact", path, handler: () => undefined };
}

class FakeRegistry {
	readonly active: string[] = [];
	readonly released: string[] = [];
	readonly throwOnRelease = new Set<string>();
	failAt = Number.POSITIVE_INFINITY;
	calls = 0;

	register(entry: PluginWebRoute): () => void {
		this.calls += 1;
		if (this.calls === this.failAt) throw new Error(`registration ${String(this.calls)} failed`);
		this.active.push(entry.path);
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			this.released.push(entry.path);
			const index = this.active.indexOf(entry.path);
			if (index >= 0) this.active.splice(index, 1);
			if (this.throwOnRelease.has(entry.path)) throw new Error(`dispose ${entry.path} failed`);
		};
	}
}

describe("atomic Web route registration", () => {
	it("rolls back declarative routes in reverse order when setup fails", () => {
		const registry = new FakeRegistry();
		registry.failAt = 3;
		expect(() => registerWebRoutesAtomically(registry, [route("/one"), route("/two"), route("/three")])).toThrow(
			"registration 3 failed",
		);
		expect(registry.active).toEqual([]);
		expect(registry.released).toEqual(["/two", "/one"]);
	});

	it("tracks imperative setup and returns an idempotent disposer", () => {
		const registry = new FakeRegistry();
		const dispose = registerWebRouteSetupAtomically(registry, (tracked) => {
			tracked.register(route("/one"));
			tracked.register(route("/two"));
		});
		expect(registry.active).toEqual(["/one", "/two"]);
		dispose();
		dispose();
		expect(registry.active).toEqual([]);
		expect(registry.released).toEqual(["/two", "/one"]);
	});

	it("rolls back imperative setup when a later registration throws", () => {
		const registry = new FakeRegistry();
		registry.failAt = 2;
		expect(() =>
			registerWebRouteSetupAtomically(registry, (tracked) => {
				tracked.register(route("/one"));
				tracked.register(route("/two"));
			}),
		).toThrow("registration 2 failed");
		expect(registry.active).toEqual([]);
		expect(registry.released).toEqual(["/one"]);
	});

	it("finishes reverse rollback when one disposer throws", () => {
		const registry = new FakeRegistry();
		registry.failAt = 3;
		registry.throwOnRelease.add("/two");
		expect(() => registerWebRoutesAtomically(registry, [route("/one"), route("/two"), route("/three")])).toThrow(
			"registration 3 failed",
		);
		expect(registry.active).toEqual([]);
		expect(registry.released).toEqual(["/two", "/one"]);
	});
});

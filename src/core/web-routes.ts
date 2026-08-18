/**
 * Atomic registration helper for plugin-owned Web routes.
 * `webServer.register()` is not fiber-scoped, so a later registration failure
 * must release every earlier route before the setup error escapes.
 * @module dsh-coding-subscription-oauth/web-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export interface PluginWebRoute {
	readonly kind: "exact" | "prefix";
	readonly path: string;
	readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface PluginWebRouteRegistry {
	register(route: PluginWebRoute): () => void;
}

/** Run imperative route setup or roll every successful registration back. */
export function registerWebRouteSetupAtomically(
	registry: PluginWebRouteRegistry,
	setup: (tracked: PluginWebRouteRegistry) => unknown,
): () => void {
	const releases: Array<() => void> = [];
	const tracked: PluginWebRouteRegistry = {
		register(route) {
			const release = registry.register(route);
			releases.push(release);
			return release;
		},
	};
	try {
		setup(tracked);
	} catch (error: unknown) {
		releaseAll(releases);
		throw error;
	}
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		releaseAll(releases);
	};
}

/** Register all routes or leave the registry exactly as it was. */
export function registerWebRoutesAtomically(
	registry: PluginWebRouteRegistry,
	routes: readonly PluginWebRoute[],
): () => void {
	const releases: Array<() => void> = [];
	try {
		for (const route of routes) releases.push(registry.register(route));
	} catch (error: unknown) {
		releaseAll(releases);
		throw error;
	}
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		releaseAll(releases);
	};
}

function releaseAll(releases: Array<() => void>): void {
	for (const release of releases.splice(0).reverse()) {
		try {
			release();
		} catch {
			// One broken disposer must not strand any sibling route.
		}
	}
}

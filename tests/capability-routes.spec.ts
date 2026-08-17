import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	CAPABILITY_SETTINGS_PATH,
	type CapabilityRouteController,
	CODEX_USAGE_PATH,
	IMAGINE_CREDENTIAL_STATUS_PATH,
	registerCapabilityRoutes,
} from "../src/capability-routes.ts";
import {
	CAPABILITY_SETTINGS_NAMESPACE,
	type CapabilitySettings,
	CapabilitySettingsConflictError,
	type CapabilitySettingsPatch,
	CapabilitySettingsReadOnlyError,
	type CapabilitySettingsSnapshot,
	DEFAULT_CAPABILITY_SETTINGS,
} from "../src/capability-settings.ts";
import { JSON_BODY_LIMIT_BYTES } from "../src/http-json.ts";

interface RegisteredRoute {
	path: string;
	handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

class TestResponse {
	status = 0;
	body = "";

	writeHead(status: number): this {
		this.status = status;
		return this;
	}

	end(value?: string): this {
		this.body += value ?? "";
		return this;
	}
}

class FakeController implements CapabilityRouteController {
	revision = 0;
	writable = true;
	readOnlyReason: "absent" | "read-only" | "disposed" | undefined;
	value: CapabilitySettings = { ...DEFAULT_CAPABILITY_SETTINGS };
	user: CapabilitySettingsPatch = {};
	writes: Array<{ mode: "patch" | "replace"; payload: CapabilitySettingsPatch; expectedRevision: number }> = [];

	snapshot(): CapabilitySettingsSnapshot {
		return {
			ns: CAPABILITY_SETTINGS_NAMESPACE,
			value: this.value,
			revision: this.revision,
			writable: this.writable,
			applies: "live",
			secrets: [],
			...(Object.keys(this.user).length > 0 ? { user: this.user } : {}),
		};
	}

	current(): CapabilitySettings {
		return this.snapshot().value;
	}

	async patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
		this.writes.push({ mode: "patch", payload: patch, expectedRevision });
		this.assertWrite(expectedRevision);
		this.user = { ...this.user, ...patch };
		this.value = { ...this.value, ...patch };
		this.revision += 1;
		return this.snapshot();
	}

	async replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
		this.writes.push({ mode: "replace", payload: section, expectedRevision });
		this.assertWrite(expectedRevision);
		this.user = { ...section };
		this.value = { ...DEFAULT_CAPABILITY_SETTINGS, ...section };
		this.revision += 1;
		return this.snapshot();
	}

	private assertWrite(expectedRevision: number): void {
		if (this.readOnlyReason !== undefined) throw new CapabilitySettingsReadOnlyError(this.readOnlyReason);
		if (expectedRevision !== this.revision) {
			throw new CapabilitySettingsConflictError(expectedRevision, this.revision);
		}
	}
}

function request(
	method: string,
	body = "",
	headers: IncomingMessage["headers"] = {},
	remoteAddress = "127.0.0.1",
): IncomingMessage {
	const stream = Readable.from([body]) as unknown as IncomingMessage;
	Object.defineProperties(stream, {
		method: { value: method, configurable: true },
		headers: {
			value: { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080", ...headers },
			configurable: true,
		},
		socket: { value: { remoteAddress }, configurable: true },
	});
	return stream;
}

function createHarness(options?: {
	controller?: FakeController;
	usage?: () => unknown | Promise<unknown>;
	credentialInfo?: () => unknown | Promise<unknown>;
	failOnPath?: string;
	routes?: Map<string, RegisteredRoute["handler"]>;
}): {
	controller: FakeController;
	routes: Map<string, RegisteredRoute["handler"]>;
	dispose: () => void;
} {
	const controller = options?.controller ?? new FakeController();
	const routes = options?.routes ?? new Map<string, RegisteredRoute["handler"]>();
	const dispose = registerCapabilityRoutes(
		{
			webServer: {
				register(route: RegisteredRoute) {
					if (options?.failOnPath !== undefined && route.path === options.failOnPath) {
						throw new Error(`webserver: duplicate exact route "${route.path}"`);
					}
					routes.set(route.path, route.handler);
					return () => {
						routes.delete(route.path);
					};
				},
			},
			effect(setup) {
				return setup();
			},
		},
		{
			controller,
			...(options?.usage === undefined ? {} : { usage: options.usage }),
			...(options?.credentialInfo === undefined ? {} : { credentialInfo: options.credentialInfo }),
		},
	);
	return { controller, routes, dispose };
}

async function invoke(
	handler: RegisteredRoute["handler"] | undefined,
	req: IncomingMessage,
): Promise<{ status: number; body: unknown }> {
	if (handler === undefined) throw new Error("route was not registered");
	const response = new TestResponse();
	await handler(req, response as unknown as ServerResponse);
	return { status: response.status, body: response.body.length === 0 ? undefined : JSON.parse(response.body) };
}

describe("capability route registrar", () => {
	it("registers the capabilities path and owns the route disposer", async () => {
		const { routes, dispose } = createHarness();
		expect([...routes.keys()]).toEqual([CAPABILITY_SETTINGS_PATH]);
		const listed = await invoke(routes.get(CAPABILITY_SETTINGS_PATH), request("GET"));
		expect(listed.status).toBe(200);
		dispose();
		expect(routes.size).toBe(0);
	});

	it("registers optional usage and credential-status routes only when injected", () => {
		const bare = createHarness();
		expect(bare.routes.has(CODEX_USAGE_PATH)).toBe(false);
		expect(bare.routes.has(IMAGINE_CREDENTIAL_STATUS_PATH)).toBe(false);

		const full = createHarness({
			usage: () => ({ remaining: 1 }),
			credentialInfo: () => ({ configured: false, source: "none", writable: false }),
		});
		expect(full.routes.has(CODEX_USAGE_PATH)).toBe(true);
		expect(full.routes.has(IMAGINE_CREDENTIAL_STATUS_PATH)).toBe(true);
	});

	it("rolls back the capabilities route when the usage route fails to register", () => {
		const routes = new Map<string, RegisteredRoute["handler"]>();
		expect(() =>
			createHarness({
				routes,
				usage: () => ({ remaining: 1 }),
				credentialInfo: () => ({ configured: false, source: "none", writable: false }),
				failOnPath: CODEX_USAGE_PATH,
			}),
		).toThrow(`webserver: duplicate exact route "${CODEX_USAGE_PATH}"`);
		expect(routes.size).toBe(0);
		expect(routes.has(CAPABILITY_SETTINGS_PATH)).toBe(false);
	});

	it("rolls back earlier capability routes when the credential-status route fails", () => {
		const routes = new Map<string, RegisteredRoute["handler"]>();
		expect(() =>
			createHarness({
				routes,
				usage: () => ({ remaining: 1 }),
				credentialInfo: () => ({ configured: false, source: "none", writable: false }),
				failOnPath: IMAGINE_CREDENTIAL_STATUS_PATH,
			}),
		).toThrow(`webserver: duplicate exact route "${IMAGINE_CREDENTIAL_STATUS_PATH}"`);
		expect(routes.size).toBe(0);
		expect(routes.has(CAPABILITY_SETTINGS_PATH)).toBe(false);
		expect(routes.has(CODEX_USAGE_PATH)).toBe(false);
	});
});

describe("GET /plugins/dsh-grok-build/capabilities", () => {
	it("returns the default-off secret-free snapshot", async () => {
		const { routes } = createHarness();
		const response = await invoke(routes.get(CAPABILITY_SETTINGS_PATH), request("GET"));
		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			ns: CAPABILITY_SETTINGS_NAMESPACE,
			value: DEFAULT_CAPABILITY_SETTINGS,
			revision: 0,
			writable: true,
			applies: "live",
			secrets: [],
		});
		const snapshot = response.body as CapabilitySettingsSnapshot;
		expect(snapshot.value.codexSearch).toBe(false);
		expect(snapshot.value.codexImages).toBe(false);
		expect(snapshot.value.codexImageEdits).toBe(false);
		expect(snapshot.value.codexUsage).toBe(false);
		expect(snapshot.value.codexFast).toBe(false);
		expect(snapshot.value.grokImagineImage).toBe(false);
		expect(snapshot.value.grokImagineVideo).toBe(false);
		expect(snapshot.secrets).toEqual([]);
		expect(response.body).not.toHaveProperty("apiKey");
		expect(JSON.stringify(snapshot.value)).not.toMatch(/apiKey|access_token|password/iu);
	});
});

describe("PATCH/PUT compare-and-swap", () => {
	it("patches then replaces through expectedRevision and refuses a stale write", async () => {
		const { controller, routes } = createHarness();
		const handler = routes.get(CAPABILITY_SETTINGS_PATH);

		const patched = await invoke(
			handler,
			request("PATCH", JSON.stringify({ expectedRevision: 0, patch: { codexSearch: true, searchResults: 3 } })),
		);
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({
			revision: 1,
			value: { ...DEFAULT_CAPABILITY_SETTINGS, codexSearch: true, searchResults: 3 },
			user: { codexSearch: true, searchResults: 3 },
			secrets: [],
		});
		expect(controller.writes).toEqual([
			{ mode: "patch", payload: { codexSearch: true, searchResults: 3 }, expectedRevision: 0 },
		]);

		const replaced = await invoke(handler, request("PUT", JSON.stringify({ expectedRevision: 1, value: {} })));
		expect(replaced.status).toBe(200);
		expect(replaced.body).toMatchObject({
			revision: 2,
			value: DEFAULT_CAPABILITY_SETTINGS,
			secrets: [],
		});
		expect((replaced.body as CapabilitySettingsSnapshot).user).toBeUndefined();

		const stale = await invoke(
			handler,
			request("PATCH", JSON.stringify({ expectedRevision: 1, patch: { grokImagineImage: true } })),
		);
		expect(stale.status).toBe(409);
		expect(stale.body).toEqual({
			error: expect.stringContaining("expected revision 1"),
			code: "SETTINGS_CONFLICT",
			expected: 1,
			actual: 2,
		});
		expect(controller.value.grokImagineImage).toBe(false);
	});

	it("maps absent/disposed writes to 503 and a read-only provider to 403", async () => {
		const absent = new FakeController();
		absent.readOnlyReason = "absent";
		const absentRoutes = createHarness({ controller: absent }).routes;
		const missing = await invoke(
			absentRoutes.get(CAPABILITY_SETTINGS_PATH),
			request("PATCH", JSON.stringify({ expectedRevision: 0, patch: { codexFast: true } })),
		);
		expect(missing.status).toBe(503);
		expect(missing.body).toMatchObject({ code: "SETTINGS_PROVIDER_ABSENT" });

		const disposed = new FakeController();
		disposed.readOnlyReason = "disposed";
		const disposedRoutes = createHarness({ controller: disposed }).routes;
		const gone = await invoke(
			disposedRoutes.get(CAPABILITY_SETTINGS_PATH),
			request("PATCH", JSON.stringify({ expectedRevision: 0, patch: { codexFast: true } })),
		);
		expect(gone.status).toBe(503);
		expect(gone.body).toMatchObject({ code: "SETTINGS_DISPOSED" });

		const locked = new FakeController();
		locked.readOnlyReason = "read-only";
		const lockedRoutes = createHarness({ controller: locked }).routes;
		const forbidden = await invoke(
			lockedRoutes.get(CAPABILITY_SETTINGS_PATH),
			request("PUT", JSON.stringify({ expectedRevision: 0, value: { imageCount: 2 } })),
		);
		expect(forbidden.status).toBe(403);
		expect(forbidden.body).toMatchObject({ code: "SETTINGS_READ_ONLY" });
	});
});

describe("capability route validation", () => {
	it("rejects unknown and secret-shaped keys before calling the controller", async () => {
		const { controller, routes } = createHarness();
		const handler = routes.get(CAPABILITY_SETTINGS_PATH);

		const unknown = await invoke(
			handler,
			request("PATCH", JSON.stringify({ expectedRevision: 0, patch: { extra: true, codexSearch: true } })),
		);
		expect(unknown.status).toBe(400);
		expect(unknown.body).toEqual({ error: "patch contains unknown key extra" });

		const secret = await invoke(
			handler,
			request(
				"PUT",
				JSON.stringify({
					expectedRevision: 0,
					value: { apiKey: "sk-secret", access_token: "tok", codexImages: true },
				}),
			),
		);
		expect(secret.status).toBe(400);
		expect((secret.body as { error: string }).error).toMatch(/secret-free \(rejected key apiKey\)/);
		expect(controller.writes).toEqual([]);
		expect(JSON.stringify(secret.body)).not.toContain("sk-secret");
	});

	it("rejects invalid types, fractional limits, and out-of-range limits", async () => {
		const { controller, routes } = createHarness();
		const handler = routes.get(CAPABILITY_SETTINGS_PATH);
		for (const patch of [
			{ codexSearch: "true" },
			{ searchResults: 1.5 },
			{ searchResults: 21 },
			{ imageCount: 0 },
			{ videoArtifactTtlMs: 60_000 },
		]) {
			const response = await invoke(handler, request("PATCH", JSON.stringify({ expectedRevision: 0, patch })));
			expect(response.status).toBe(400);
		}
		expect(controller.writes).toEqual([]);
	});

	it("rejects invalid envelopes and oversized JSON bodies", async () => {
		const { routes } = createHarness();
		const handler = routes.get(CAPABILITY_SETTINGS_PATH);

		const malformed = await invoke(handler, request("PATCH", "{not-json"));
		expect(malformed.status).toBe(400);
		expect(malformed.body).toEqual({ error: "request body must contain valid JSON" });

		const missing = await invoke(handler, request("PATCH", JSON.stringify({ patch: { codexSearch: true } })));
		expect(missing.status).toBe(400);
		expect(missing.body).toEqual({ error: "expectedRevision must be a nonnegative integer" });

		const negative = await invoke(
			handler,
			request("PUT", JSON.stringify({ expectedRevision: -1, value: { searchResults: 2 } })),
		);
		expect(negative.status).toBe(400);

		const oversized = await invoke(
			handler,
			request("PATCH", "", { "content-length": String(JSON_BODY_LIMIT_BYTES + 1) }),
		);
		expect(oversized.status).toBe(413);
		expect(oversized.body).toEqual({ error: "request body is too large" });
	});
});

describe("same-origin trust checks", () => {
	it("rejects non-loopback, cross-site, and Origin/Host mismatch before reading the body", async () => {
		const { controller, routes } = createHarness();
		const handler = routes.get(CAPABILITY_SETTINGS_PATH);
		const payload = JSON.stringify({ expectedRevision: 0, patch: { codexSearch: true } });

		const remote = await invoke(handler, request("PATCH", payload, {}, "10.0.0.8"));
		expect(remote.status).toBe(403);

		const crossSite = await invoke(handler, request("PATCH", payload, { "sec-fetch-site": "cross-site" }));
		expect(crossSite.status).toBe(403);

		const mismatched = await invoke(handler, request("PATCH", payload, { origin: "https://evil.example" }));
		expect(mismatched.status).toBe(403);

		expect(controller.writes).toEqual([]);
	});
});

describe("optional capability read surfaces", () => {
	it("returns 404/disabled when Codex usage is default-off and never calls usage()", async () => {
		let called = 0;
		const { routes } = createHarness({
			usage: () => {
				called += 1;
				return { remaining: 9 };
			},
		});
		const response = await invoke(routes.get(CODEX_USAGE_PATH), request("GET"));
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "disabled" });
		expect(called).toBe(0);
	});

	it("redacts internal 500 diagnostics from optional read surfaces", async () => {
		const controller = new FakeController();
		controller.value = { ...DEFAULT_CAPABILITY_SETTINGS, codexUsage: true };
		const { routes } = createHarness({
			controller,
			usage: () => {
				throw new Error("failed reading /home/private/oauth.json with token secret");
			},
		});
		const response = await invoke(routes.get(CODEX_USAGE_PATH), request("GET"));
		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: "request failed" });
	});

	it("delegates usage only when the flag is on and never returns secret values", async () => {
		const controller = new FakeController();
		controller.value = { ...DEFAULT_CAPABILITY_SETTINGS, codexUsage: true };
		const { routes } = createHarness({
			controller,
			usage: () => ({ plan: "plus", remaining: 4, resetAt: 1 }),
			credentialInfo: () => ({
				configured: true,
				source: "file",
				writable: false,
				apiKey: "sk-secret",
				access_token: "tok",
				credential: "leak",
			}),
		});

		const usage = await invoke(routes.get(CODEX_USAGE_PATH), request("GET"));
		expect(usage.status).toBe(200);
		expect(usage.body).toEqual({ plan: "plus", remaining: 4, resetAt: 1 });
		expect(JSON.stringify(usage.body)).not.toMatch(/apiKey|access_token|sk-/u);

		const status = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request("GET"));
		expect(status.status).toBe(200);
		expect(status.body).toEqual({ configured: true, source: "file", writable: false });
		expect(status.body).not.toHaveProperty("apiKey");
		expect(status.body).not.toHaveProperty("access_token");
		expect(status.body).not.toHaveProperty("credential");
	});

	it("redacts unbounded or path-shaped credential source labels", async () => {
		const { routes } = createHarness({
			credentialInfo: () => ({ configured: true, source: "/home/private/XAI_API_KEY", writable: true }),
		});
		const status = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request("GET"));
		expect(status.body).toEqual({ configured: true, source: "unknown", writable: true });
	});
});

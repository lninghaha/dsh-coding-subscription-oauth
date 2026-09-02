import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { CodingOAuthGatewayController, GatewayPublicStatus } from "../src/gateway.ts";
import {
	GATEWAY_REVEAL_PATH,
	GATEWAY_ROTATE_PATH,
	GATEWAY_SETTINGS_PATH,
	registerGatewayRoutes,
} from "../src/gateway-routes.ts";
import type { OwnerRequestPolicy } from "../src/web-origin.ts";

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

const idleStatus: GatewayPublicStatus = {
	enabled: false,
	running: false,
	bind: "127.0.0.1",
	port: 18_199,
	model: null,
	keyConfigured: true,
	keyAvailable: true,
	keyHint: "****key",
	models: [],
	warning: "",
};

function request(
	method: string,
	headers: IncomingMessage["headers"] = {},
	remoteAddress = "127.0.0.1",
): IncomingMessage {
	const stream = Readable.from(["{}"]) as unknown as IncomingMessage;
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

function fakeController(): CodingOAuthGatewayController & { reveals: number; rotates: number } {
	return {
		reveals: 0,
		rotates: 0,
		status: async () => idleStatus,
		startIfEnabled: async () => undefined,
		setEnabled: async () => idleStatus,
		setPort: async () => idleStatus,
		async revealKey() {
			this.reveals += 1;
			return { apiKey: "reveal-key-value-bbbb", keyHint: "****bbbb" };
		},
		async rotateKey() {
			this.rotates += 1;
			return { apiKey: "rotated-key-value-cccc", keyHint: "****cccc" };
		},
		stop: async () => undefined,
	};
}

function mount(policy?: OwnerRequestPolicy, controller = fakeController()) {
	const routes = new Map<string, RegisteredRoute["handler"]>();
	const dispose = registerGatewayRoutes(
		{
			webServer: {
				register(route: RegisteredRoute) {
					routes.set(route.path, route.handler);
					return () => routes.delete(route.path);
				},
			},
			effect(setup) {
				return setup();
			},
		},
		controller,
		policy,
	);
	return { routes, controller, dispose };
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

function policyWith(accessMode: "loopback" | "ssh-tunnel" | "trusted-https-proxy"): OwnerRequestPolicy {
	return {
		authorize: () => ({ authorized: true, accessMode }),
		diagnostics: () => [],
	};
}

describe("gateway settings routes", () => {
	it("reveals and rotates the key on loopback", async () => {
		const { routes, controller, dispose } = mount(policyWith("loopback"));
		const revealed = await invoke(routes.get(GATEWAY_REVEAL_PATH), request("POST"));
		expect(revealed.status).toBe(200);
		expect(revealed.body).toMatchObject({ apiKey: "reveal-key-value-bbbb" });
		const rotated = await invoke(routes.get(GATEWAY_ROTATE_PATH), request("POST"));
		expect(rotated.status).toBe(200);
		expect(controller.reveals).toBe(1);
		expect(controller.rotates).toBe(1);
		dispose();
	});

	it("rejects reveal and rotate when owner access is not loopback", async () => {
		for (const accessMode of ["ssh-tunnel", "trusted-https-proxy"] as const) {
			const { routes, controller, dispose } = mount(policyWith(accessMode));
			const revealed = await invoke(routes.get(GATEWAY_REVEAL_PATH), request("POST"));
			expect(revealed.status).toBe(403);
			const rotated = await invoke(routes.get(GATEWAY_ROTATE_PATH), request("POST"));
			expect(rotated.status).toBe(403);
			expect(controller.reveals).toBe(0);
			expect(controller.rotates).toBe(0);
			const status = await invoke(routes.get(GATEWAY_SETTINGS_PATH), request("GET"));
			expect(status.status).toBe(200);
			dispose();
		}
	});

	it("still forbids unauthorized peers on the control surface", async () => {
		const denied: OwnerRequestPolicy = {
			authorize: () => ({ authorized: false, reason: "denied" }),
			diagnostics: () => [],
		};
		const { routes, controller, dispose } = mount(denied);
		const revealed = await invoke(routes.get(GATEWAY_REVEAL_PATH), request("POST"));
		expect(revealed.status).toBe(403);
		expect(controller.reveals).toBe(0);
		dispose();
	});
});

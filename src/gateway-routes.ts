/**
 * Settings-facing routes for the opt-in local API gateway.
 * @module dsh-coding-subscription-oauth/gateway-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodingOAuthGatewayController } from "./gateway.ts";
import { readJsonRequest, requestErrorStatus } from "./http-json.ts";
import { safeMessage } from "./redact.ts";
import { isTrustedLoopbackWebRequest } from "./web-origin.ts";
import { registerWebRouteSetupAtomically } from "./web-routes.ts";

export const GATEWAY_SETTINGS_PATH = "/plugins/dsh-grok-build/gateway";
export const GATEWAY_ROTATE_PATH = "/plugins/dsh-grok-build/gateway/rotate";

export interface GatewayRouteContext {
	readonly webServer: {
		register(route: {
			kind: "exact" | "prefix";
			path: string;
			handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
		}): () => void;
	};
	effect(callback: () => () => void | Promise<void>, label?: string): unknown;
}

export function registerGatewayRoutes(ctx: GatewayRouteContext, controller: CodingOAuthGatewayController): () => void {
	let dispose = (): void => undefined;
	ctx.effect(() => {
		dispose = registerWebRouteSetupAtomically(ctx.webServer, (webServer) => {
			webServer.register({
				kind: "exact",
				path: GATEWAY_SETTINGS_PATH,
				handler: (req, res) => handleGatewaySettings(req, res, controller),
			});
			webServer.register({
				kind: "exact",
				path: GATEWAY_ROTATE_PATH,
				handler: (req, res) => handleGatewayRotate(req, res, controller),
			});
		});
		return dispose;
	}, "dsh-coding-subscription-oauth: gateway settings routes");
	return () => dispose();
}

async function handleGatewaySettings(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CodingOAuthGatewayController,
): Promise<void> {
	if (!isTrustedLoopbackWebRequest(req)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		if (req.method === "GET") {
			json(res, 200, await controller.status());
			return;
		}
		if (req.method === "PATCH") {
			const body = await readJsonRequest(req);
			const enabled = typeof body === "object" && body !== null ? (body as { enabled?: unknown }).enabled : undefined;
			if (typeof enabled !== "boolean") {
				json(res, 400, { error: "enabled must be a boolean" });
				return;
			}
			json(res, 200, await controller.setEnabled(enabled));
			return;
		}
		json(res, 405, { error: "method not allowed" });
	} catch (error) {
		json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
	}
}

async function handleGatewayRotate(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CodingOAuthGatewayController,
): Promise<void> {
	if (!isTrustedLoopbackWebRequest(req)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	if (req.method !== "POST") {
		json(res, 405, { error: "method not allowed" });
		return;
	}
	try {
		json(res, 200, await controller.rotateKey());
	} catch (error) {
		json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
	}
}

function json(res: ServerResponse, status: number, value: unknown): void {
	const body = Buffer.from(`${JSON.stringify(value)}\n`);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.byteLength,
		"cache-control": "no-store",
	});
	res.end(body);
}

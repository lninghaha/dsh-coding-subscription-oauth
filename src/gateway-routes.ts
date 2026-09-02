/**
 * Settings-facing routes for the opt-in local API gateway.
 * @module dsh-coding-subscription-oauth/gateway-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OwnerRequestDecision } from "dsh-coding-oauth-core";
import type { CodingOAuthGatewayController } from "./gateway.ts";
import { assertGatewayPort } from "./gateway-config.ts";
import { readJsonRequest, requestErrorStatus } from "./http-json.ts";
import { GATEWAY_REVEAL_PATH, GATEWAY_ROTATE_PATH, GATEWAY_SETTINGS_PATH } from "./ids.ts";
import { safeMessage } from "./redact.ts";
import { LOOPBACK_OWNER_REQUEST_POLICY, type OwnerRequestPolicy } from "./web-origin.ts";
import { registerWebRouteSetupAtomically } from "./web-routes.ts";

export { GATEWAY_REVEAL_PATH, GATEWAY_ROTATE_PATH, GATEWAY_SETTINGS_PATH } from "./ids.ts";

function authorizeGatewayControl(req: IncomingMessage, ownerRequestPolicy: OwnerRequestPolicy): OwnerRequestDecision {
	return ownerRequestPolicy.authorize(req);
}

function authorizeGatewaySecret(req: IncomingMessage, ownerRequestPolicy: OwnerRequestPolicy): OwnerRequestDecision {
	const decision = ownerRequestPolicy.authorize(req);
	if (!decision.authorized) return decision;
	if (decision.accessMode !== "loopback") {
		return { authorized: false, reason: "loopback-only" };
	}
	return decision;
}

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

export function registerGatewayRoutes(
	ctx: GatewayRouteContext,
	controller: CodingOAuthGatewayController,
	ownerRequestPolicy: OwnerRequestPolicy = LOOPBACK_OWNER_REQUEST_POLICY,
): () => void {
	let dispose = (): void => undefined;
	ctx.effect(() => {
		dispose = registerWebRouteSetupAtomically(ctx.webServer, (webServer) => {
			webServer.register({
				kind: "exact",
				path: GATEWAY_SETTINGS_PATH,
				handler: (req, res) => handleGatewaySettings(req, res, controller, ownerRequestPolicy),
			});
			webServer.register({
				kind: "exact",
				path: GATEWAY_REVEAL_PATH,
				handler: (req, res) => handleGatewayReveal(req, res, controller, ownerRequestPolicy),
			});
			webServer.register({
				kind: "exact",
				path: GATEWAY_ROTATE_PATH,
				handler: (req, res) => handleGatewayRotate(req, res, controller, ownerRequestPolicy),
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
	ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
	if (!authorizeGatewayControl(req, ownerRequestPolicy).authorized) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		if (req.method === "GET") {
			json(res, 200, await controller.status());
			return;
		}
		if (req.method === "PATCH") {
			const raw = await readJsonRequest(req);
			const payload = typeof raw === "object" && raw !== null ? (raw as { enabled?: unknown; port?: unknown }) : {};
			const enabled = payload.enabled;
			const port = payload.port;
			if (enabled === undefined && port === undefined) {
				json(res, 400, { error: "enabled or port is required" });
				return;
			}
			if (enabled !== undefined && typeof enabled !== "boolean") {
				json(res, 400, { error: "enabled must be a boolean" });
				return;
			}
			if (port !== undefined) {
				if (typeof port !== "number" || !Number.isSafeInteger(port)) {
					json(res, 400, { error: "port must be an integer" });
					return;
				}
				try {
					assertGatewayPort(port);
				} catch (error) {
					json(res, 400, { error: safeMessage(error) });
					return;
				}
				await controller.setPort(port);
			}
			const status = typeof enabled === "boolean" ? await controller.setEnabled(enabled) : await controller.status();
			json(res, 200, status);
			return;
		}
		json(res, 405, { error: "method not allowed" });
	} catch (error) {
		json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
	}
}

async function handleGatewayReveal(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CodingOAuthGatewayController,
	ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
	if (!authorizeGatewaySecret(req, ownerRequestPolicy).authorized) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	if (req.method !== "POST") {
		json(res, 405, { error: "method not allowed" });
		return;
	}
	try {
		json(res, 200, await controller.revealKey());
	} catch (error) {
		json(res, requestErrorStatus(error, 500), { error: safeMessage(error) });
	}
}

async function handleGatewayRotate(
	req: IncomingMessage,
	res: ServerResponse,
	controller: CodingOAuthGatewayController,
	ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
	if (!authorizeGatewaySecret(req, ownerRequestPolicy).authorized) {
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

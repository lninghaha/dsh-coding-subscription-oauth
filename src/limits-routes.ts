/**
 * GET {api}/oauth/limits[?provider=<slug>[&force=1]] — secret-free limit gauges.
 * @module dsh-coding-subscription-oauth/limits-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { CODING_OAUTH_LIMITS_PATH } from "./ids.ts";
import { LIMIT_PROVIDERS, type LimitProvider, type LimitsReader } from "./limits.ts";
import { LOOPBACK_OWNER_REQUEST_POLICY, type OwnerRequestPolicy } from "./web-origin.ts";
import { registerWebRouteSetupAtomically } from "./web-routes.ts";

type WebServerLike = Parameters<typeof registerWebRouteSetupAtomically>[0];

export interface LimitsRouteContext {
	readonly webServer: WebServerLike;
	effect(factory: () => () => void, name?: string): unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(JSON.stringify(body));
}

async function handle(
	req: IncomingMessage,
	res: ServerResponse,
	reader: LimitsReader,
	ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
	if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
	if (!ownerRequestPolicy.authorize(req).authorized) return json(res, 403, { error: "forbidden" });
	const url = new URL(req.url ?? "", "http://localhost");
	const requested = url.searchParams.get("provider");
	if (requested !== null && !LIMIT_PROVIDERS.includes(requested as LimitProvider)) {
		return json(res, 400, { error: "provider must be one of codex, claude, kimi, qwen, or grok" });
	}
	const force = url.searchParams.get("force") === "1";
	const providers = requested === null ? LIMIT_PROVIDERS : [requested as LimitProvider];
	json(res, 200, { providers: await Promise.all(providers.map((provider) => reader.read(provider, { force }))) });
}

/** Register the limits route. Returns the disposer. */
export function registerLimitsRoutes(
	ctx: LimitsRouteContext,
	reader: LimitsReader,
	ownerRequestPolicy: OwnerRequestPolicy = LOOPBACK_OWNER_REQUEST_POLICY,
): () => void {
	let dispose = (): void => undefined;
	ctx.effect(() => {
		dispose = registerWebRouteSetupAtomically(ctx.webServer, (webServer) => {
			webServer.register({
				kind: "exact",
				path: CODING_OAUTH_LIMITS_PATH,
				handler: (req, res) => {
					handle(req, res, reader, ownerRequestPolicy).catch(() => json(res, 500, { error: "internal error" }));
				},
			});
		});
		return dispose;
	}, "dsh-coding-subscription-oauth: limits route");
	return () => dispose();
}

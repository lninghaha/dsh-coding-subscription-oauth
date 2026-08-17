/**
 * Start and stop the opt-in local coding-subscription API gateway.
 * @module dsh-coding-subscription-oauth/gateway
 */

import { gatewayKeyPath, loadOrCreateGatewayApiKey } from "./gateway-auth.ts";
import { createSessionGatewayBackend, type GatewayBackend } from "./gateway-backend.ts";
import { type GatewayConfig, resolveGatewayConfig } from "./gateway-config.ts";
import { closeGateway, createGatewayHttpServer, listenGateway } from "./gateway-http.ts";
import type { OAuthProviderSession } from "./oauth-session.ts";
import type { GrokBuildSession } from "./session.ts";

export interface StartGatewayOptions {
	config?: Partial<GatewayConfig>;
	dshHome?: string;
	backend?: GatewayBackend;
	grok?: GrokBuildSession;
	subscriptions?: readonly OAuthProviderSession[];
	onError?: (error: unknown) => void;
}

export interface StartedGateway {
	close(): Promise<void>;
	readonly bind: string;
	readonly port: number;
}

export async function startCodingOAuthGateway(options: StartGatewayOptions): Promise<StartedGateway | undefined> {
	const config = resolveGatewayConfig(options.config);
	if (!config.enabled) return undefined;
	const backend =
		options.backend ??
		(options.grok === undefined ? undefined : createSessionGatewayBackend(options.grok, options.subscriptions ?? []));
	if (backend === undefined) throw new Error("gateway requires a backend or Grok session");
	const apiKey = await loadOrCreateGatewayApiKey(gatewayKeyPath(options.dshHome), config.apiKey);
	const server = createGatewayHttpServer({ config, apiKey, backend });
	try {
		await listenGateway(server, config);
	} catch (error) {
		await closeGateway(server).catch(() => undefined);
		options.onError?.(error);
		return undefined;
	}
	return {
		bind: config.bind,
		port: config.port,
		close: () => closeGateway(server),
	};
}

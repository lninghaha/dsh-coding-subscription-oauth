/**
 * Opt-in local API gateway configuration.
 * @module dsh-coding-subscription-oauth/gateway-config
 */

import z from "@deepseek-ai/schemastery";

export const GATEWAY_DEFAULT_BIND = "127.0.0.1";
export const GATEWAY_DEFAULT_PORT = 18_080;

export interface GatewayConfig {
	readonly enabled: boolean;
	readonly bind: string;
	readonly port: number;
	readonly apiKey?: string;
	readonly rateLimit: number;
}

export const GatewayConfigSchema: z<Partial<GatewayConfig>> = z.object({
	enabled: z.boolean().default(false),
	bind: z.string().default(GATEWAY_DEFAULT_BIND),
	port: z.number().default(GATEWAY_DEFAULT_PORT),
	apiKey: z.string(),
	rateLimit: z.number().default(0),
});

export function resolveGatewayConfig(raw?: Partial<GatewayConfig>): GatewayConfig {
	const bind = raw?.bind ?? GATEWAY_DEFAULT_BIND;
	const port = raw?.port ?? GATEWAY_DEFAULT_PORT;
	if (typeof bind !== "string" || bind.trim() === "") throw new Error("gateway.bind must be a non-empty host");
	if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
		throw new Error("gateway.port must be an integer between 1024 and 65535");
	}
	const rateLimit = raw?.rateLimit ?? 0;
	if (!Number.isSafeInteger(rateLimit) || rateLimit < 0)
		throw new Error("gateway.rateLimit must be a non-negative integer");
	const apiKey = raw?.apiKey;
	if (apiKey !== undefined && (typeof apiKey !== "string" || apiKey.length === 0)) {
		throw new Error("gateway.apiKey must be a non-empty string when set");
	}
	return {
		enabled: raw?.enabled === true,
		bind: bind.trim(),
		port,
		...(apiKey === undefined ? {} : { apiKey }),
		rateLimit,
	};
}

export function isLoopbackBind(bind: string): boolean {
	return bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
}

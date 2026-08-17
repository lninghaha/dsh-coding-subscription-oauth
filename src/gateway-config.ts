/**
 * Opt-in local API gateway configuration.
 * @module dsh-coding-subscription-oauth/gateway-config
 */

import z from "@deepseek-ai/schemastery";

export const GATEWAY_DEFAULT_BIND = "127.0.0.1";
export const GATEWAY_DEFAULT_PORT = 18_080;
export const GATEWAY_MIN_PORT = 1024;
export const GATEWAY_MAX_PORT = 65_535;
export const GATEWAY_RANDOM_PORT_MIN = 18_100;
export const GATEWAY_RANDOM_PORT_MAX = 18_999;
const GATEWAY_RANDOM_RESERVED = new Set([22, 53, 3080, 7890, 9090, GATEWAY_DEFAULT_PORT]);

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
	assertGatewayPort(port);
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

export function assertGatewayPort(port: number): number {
	if (!Number.isSafeInteger(port) || port < GATEWAY_MIN_PORT || port > GATEWAY_MAX_PORT) {
		throw new Error(
			`gateway.port must be an integer between ${String(GATEWAY_MIN_PORT)} and ${String(GATEWAY_MAX_PORT)}`,
		);
	}
	return port;
}

export function randomGatewayPort(exclude: number | readonly number[] = []): number {
	const blocked = new Set(GATEWAY_RANDOM_RESERVED);
	if (typeof exclude === "number") blocked.add(exclude);
	else for (const value of exclude) blocked.add(value);
	for (let attempt = 0; attempt < 32; attempt += 1) {
		const span = GATEWAY_RANDOM_PORT_MAX - GATEWAY_RANDOM_PORT_MIN + 1;
		const candidate = GATEWAY_RANDOM_PORT_MIN + Math.floor(Math.random() * span);
		if (!blocked.has(candidate)) return candidate;
	}
	return GATEWAY_RANDOM_PORT_MIN === exclude ? GATEWAY_RANDOM_PORT_MIN + 1 : GATEWAY_RANDOM_PORT_MIN;
}

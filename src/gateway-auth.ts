/**
 * Owner-only gateway API key file.
 * @module dsh-coding-subscription-oauth/gateway-auth
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { OAuthSourceError, readHardenedOAuthSourceFile } from "./oauth-sources.ts";

export const GATEWAY_KEY_FILENAME = ".coding-oauth-gateway.json";
const KEY_FORMAT_VERSION = 1;

interface GatewayKeyDocument {
	version: typeof KEY_FORMAT_VERSION;
	apiKey: string;
}

export function gatewayKeyPath(dshHome?: string): string {
	return resolve(join(resolveDshHome(dshHome), GATEWAY_KEY_FILENAME));
}

export function generateGatewayApiKey(): string {
	return randomBytes(32).toString("base64url");
}

export function gatewayKeysEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function loadOrCreateGatewayApiKey(path: string, configured?: string): Promise<string> {
	if (configured !== undefined) {
		await persistGatewayApiKey(path, configured);
		return configured;
	}
	try {
		const text = (await readHardenedOAuthSourceFile(path)).text;
		const value = JSON.parse(text) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error("gateway key file must contain an object");
		}
		const document = value as Record<string, unknown>;
		if (
			document["version"] !== KEY_FORMAT_VERSION ||
			typeof document["apiKey"] !== "string" ||
			document["apiKey"].length === 0
		) {
			throw new Error("gateway key file is invalid");
		}
		return document["apiKey"];
	} catch (error) {
		if (!(error instanceof OAuthSourceError) || error.code !== "not_found") throw error;
		const created = generateGatewayApiKey();
		await persistGatewayApiKey(path, created);
		return created;
	}
}

export async function persistGatewayApiKey(path: string, apiKey: string): Promise<void> {
	const document: GatewayKeyDocument = { version: KEY_FORMAT_VERSION, apiKey };
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFileAtomic(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
}

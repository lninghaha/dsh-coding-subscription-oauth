/**
 * Loopback + same-origin authorization shared by private plugin Web routes.
 * Rejecting non-loopback Host values closes DNS-rebinding access even when the
 * TCP peer itself is 127.0.0.1 or ::1.
 * @module dsh-coding-subscription-oauth/web-origin
 */

import type { IncomingMessage } from "node:http";

/** Authorize one browser request for owner-local exact/settings routes. */
export function isTrustedLoopbackWebRequest(req: IncomingMessage): boolean {
	if (!isLoopbackPeer(req.socket.remoteAddress)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = parseLoopbackHost(req.headers.host);
	if (host === undefined) return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		if (!isLoopbackHostname(parsed.hostname)) return false;
		return parsed.host.toLowerCase() === host;
	} catch {
		return false;
	}
}

function parseLoopbackHost(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	try {
		const parsed = new URL(`http://${value}`);
		if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "") {
			return undefined;
		}
		if (!isLoopbackHostname(parsed.hostname)) return undefined;
		return parsed.host.toLowerCase();
	} catch {
		return undefined;
	}
}

function isLoopbackPeer(value: string | undefined): boolean {
	if (value === undefined) return false;
	const normalized = value.toLowerCase();
	if (normalized === "::1") return true;
	const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
	return isIpv4Loopback(ipv4);
}

function isLoopbackHostname(value: string): boolean {
	const normalized = value.toLowerCase();
	if (normalized === "localhost" || normalized === "[::1]") return true;
	return isIpv4Loopback(normalized);
}

function isIpv4Loopback(value: string): boolean {
	const octets = value.split(".");
	if (octets.length !== 4 || octets[0] !== "127") return false;
	return octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255);
}

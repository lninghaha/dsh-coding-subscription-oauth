/**
 * Grok Imagine network allowlist / private-IP helpers.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */

import { BlockList, isIP } from "node:net";
import { FROZEN_OUTPUT_HOSTS } from "./types.ts";

const blockedNetworks = new BlockList();
blockedNetworks.addSubnet("0.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("10.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("100.64.0.0", 10, "ipv4");
blockedNetworks.addSubnet("127.0.0.0", 8, "ipv4");
blockedNetworks.addSubnet("169.254.0.0", 16, "ipv4");
blockedNetworks.addSubnet("172.16.0.0", 12, "ipv4");
blockedNetworks.addSubnet("192.0.0.0", 24, "ipv4");
blockedNetworks.addSubnet("192.0.2.0", 24, "ipv4");
blockedNetworks.addSubnet("192.88.99.0", 24, "ipv4");
blockedNetworks.addSubnet("192.168.0.0", 16, "ipv4");
blockedNetworks.addSubnet("198.18.0.0", 15, "ipv4");
blockedNetworks.addSubnet("198.51.100.0", 24, "ipv4");
blockedNetworks.addSubnet("203.0.113.0", 24, "ipv4");
blockedNetworks.addSubnet("224.0.0.0", 4, "ipv4");
blockedNetworks.addSubnet("240.0.0.0", 4, "ipv4");
blockedNetworks.addSubnet("::", 128, "ipv6");
blockedNetworks.addSubnet("::1", 128, "ipv6");
blockedNetworks.addSubnet("::", 96, "ipv6");
blockedNetworks.addSubnet("64:ff9b::", 96, "ipv6");
blockedNetworks.addSubnet("64:ff9b:1::", 48, "ipv6");
blockedNetworks.addSubnet("100::", 64, "ipv6");
blockedNetworks.addSubnet("2001::", 32, "ipv6");
blockedNetworks.addSubnet("2001:2::", 48, "ipv6");
blockedNetworks.addSubnet("2001:db8::", 32, "ipv6");
blockedNetworks.addSubnet("2002::", 16, "ipv6");
blockedNetworks.addSubnet("3fff::", 20, "ipv6");
blockedNetworks.addSubnet("5f00::", 16, "ipv6");
blockedNetworks.addSubnet("fc00::", 7, "ipv6");
blockedNetworks.addSubnet("fe80::", 10, "ipv6");
blockedNetworks.addSubnet("ff00::", 8, "ipv6");

function dottedFromWords(high: number, low: number): string {
	return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function parseIPv6Groups(address: string): number[] | undefined {
	const bare = address.toLowerCase().split("%", 1)[0] ?? "";
	let normalized = bare;
	const v4tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bare);
	if (v4tail) {
		const ipv4 = v4tail[1] ?? "";
		if (isIP(ipv4) !== 4) return undefined;
		const octets = ipv4.split(".").map((part) => Number(part));
		if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
			return undefined;
		}
		const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
		const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
		normalized = `${bare.slice(0, v4tail.index + 1)}${high}:${low}`;
	}
	const sides = normalized.split("::");
	if (sides.length > 2) return undefined;
	const parseSide = (side: string | undefined): number[] | undefined => {
		if (side === undefined || side === "") return [];
		const groups = side.split(":").map((group) => Number.parseInt(group, 16));
		if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined;
		return groups;
	};
	if (sides.length === 1) {
		const groups = parseSide(sides[0]);
		return groups?.length === 8 ? groups : undefined;
	}
	const head = parseSide(sides[0]);
	const tail = parseSide(sides[1]);
	if (head === undefined || tail === undefined || head.length + tail.length > 8) return undefined;
	return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function embeddedIPv4s(address: string): string[] {
	const groups = parseIPv6Groups(address);
	if (groups === undefined) return [];
	const found = new Set<string>();
	const last32 = dottedFromWords(groups[6] ?? 0, groups[7] ?? 0);
	const headZero = groups.slice(0, 5).every((group) => group === 0);
	if (headZero && ((groups[5] ?? 0) === 0xffff || (groups[5] ?? 0) === 0)) {
		found.add(last32);
	}
	if ((groups[0] ?? 0) === 0x2002) {
		found.add(dottedFromWords(groups[1] ?? 0, groups[2] ?? 0));
	}
	if ((groups[0] ?? 0) === 0x2001 && (groups[1] ?? 0) === 0) {
		found.add(dottedFromWords(groups[2] ?? 0, groups[3] ?? 0));
		found.add(dottedFromWords((groups[6] ?? 0) ^ 0xffff, (groups[7] ?? 0) ^ 0xffff));
	}
	if ((groups[0] ?? 0) === 0x64 && (groups[1] ?? 0) === 0xff9b) {
		found.add(last32);
	}
	return [...found];
}

function ipv4Mapped(address: string): string | undefined {
	const lower = address.toLowerCase();
	if (!lower.startsWith("::ffff:")) return undefined;
	const rest = lower.slice("::ffff:".length);
	if (isIP(rest) === 4) return rest;
	const parts = rest.split(":");
	if (parts.length !== 2) return undefined;
	const high = Number.parseInt(parts[0] ?? "", 16);
	const low = Number.parseInt(parts[1] ?? "", 16);
	if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low < 0 || high > 0xffff || low > 0xffff) {
		return undefined;
	}
	return dottedFromWords(high, low);
}

/** True when an address is loopback, private, reserved, documentation, or an embedded special form. */
export function isBlockedIp(address: string): boolean {
	if (isIP(address) === 0) return true;
	if (isIP(address) === 4) return blockedNetworks.check(address, "ipv4");
	if (blockedNetworks.check(address, "ipv6")) return true;
	if (parseIPv6Groups(address) === undefined) return true;
	const mapped = ipv4Mapped(address);
	if (mapped !== undefined && isBlockedIp(mapped)) return true;
	for (const embedded of embeddedIPv4s(address)) {
		if (isIP(embedded) === 4 && blockedNetworks.check(embedded, "ipv4")) return true;
	}
	return false;
}

export function normalizeHostname(hostname: string): string {
	return hostname.trim().toLowerCase().replace(/\.$/u, "");
}

export function isBlockedHostname(hostname: string): boolean {
	const host = normalizeHostname(hostname);
	return (
		host === "localhost" ||
		host === "localhost.localdomain" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".intranet")
	);
}

export function isAllowlistedImagineHost(hostname: string): boolean {
	return FROZEN_OUTPUT_HOSTS.has(normalizeHostname(hostname));
}

import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { isTrustedLoopbackWebRequest } from "../../src/core/web-origin.ts";

function request(
	host: string | undefined,
	origin: string | undefined,
	remoteAddress = "127.0.0.1",
	secFetchSite?: string,
): IncomingMessage {
	return {
		headers: {
			...(host === undefined ? {} : { host }),
			...(origin === undefined ? {} : { origin }),
			...(secFetchSite === undefined ? {} : { "sec-fetch-site": secFetchSite }),
		},
		socket: { remoteAddress },
	} as unknown as IncomingMessage;
}

describe("isTrustedLoopbackWebRequest", () => {
	it("accepts matching loopback Host and Origin forms", () => {
		expect(isTrustedLoopbackWebRequest(request("127.0.0.1:3080", "http://127.0.0.1:3080"))).toBe(true);
		expect(isTrustedLoopbackWebRequest(request("localhost:3080", "https://localhost:3080", "::ffff:127.0.0.1"))).toBe(
			true,
		);
		expect(isTrustedLoopbackWebRequest(request("[::1]:3080", "http://[::1]:3080", "::1"))).toBe(true);
		expect(isTrustedLoopbackWebRequest(request("127.0.0.2:3080", "http://127.0.0.2:3080", "127.0.0.2"))).toBe(true);
		expect(
			isTrustedLoopbackWebRequest(request("127.255.1.2:3080", "http://127.255.1.2:3080", "::ffff:127.255.1.2")),
		).toBe(true);
		expect(isTrustedLoopbackWebRequest(request("localhost", undefined))).toBe(true);
	});

	it("rejects DNS-rebinding Host values even when Origin matches", () => {
		expect(isTrustedLoopbackWebRequest(request("attacker.example", undefined))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request("attacker.example:3080", "http://attacker.example:3080"))).toBe(false);
		expect(
			isTrustedLoopbackWebRequest(request("127.0.0.1.attacker.example", "http://127.0.0.1.attacker.example")),
		).toBe(false);
	});

	it("rejects mismatched origins, cross-site fetches, malformed hosts, and non-loopback peers", () => {
		expect(isTrustedLoopbackWebRequest(request("127.0.0.1:3080", "http://localhost:3080"))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request("127.0.0.1:3080", "file:///tmp/test"))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request("user@127.0.0.1:3080", undefined))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request(undefined, undefined))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request("127.0.0.1:3080", undefined, "10.0.0.1"))).toBe(false);
		expect(isTrustedLoopbackWebRequest(request("127.0.0.1:3080", undefined, "127.0.0.1", "cross-site"))).toBe(false);
	});
});

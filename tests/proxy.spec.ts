import { getGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";
import { acquireCodingOAuthProxy, codingOAuthProxyUnreachableHint } from "../src/proxy.ts";

describe("codingOAuthProxyUnreachableHint", () => {
	it("names CODING_OAUTH_PROXY while installed and restores the previous dispatcher", async () => {
		const previous = getGlobalDispatcher();
		const lease = acquireCodingOAuthProxy("http://127.0.0.1:17990");
		expect(codingOAuthProxyUnreachableHint()).toBe("; check that CODING_OAUTH_PROXY is reachable");
		expect(getGlobalDispatcher()).not.toBe(previous);
		await lease.release();
		expect(getGlobalDispatcher()).toBe(previous);
	});

	it("fails closed on overlapping proxy policies and accepts the new owner after release", async () => {
		const first = acquireCodingOAuthProxy("http://127.0.0.1:17991");
		expect(() => acquireCodingOAuthProxy("http://127.0.0.1:17992")).toThrow(/different proxy policy/u);
		await first.release();
		const replacement = acquireCodingOAuthProxy("http://127.0.0.1:17992", { proxyKimi: true });
		expect(replacement.url).toBe("http://127.0.0.1:17992");
		await replacement.release();
	});
});

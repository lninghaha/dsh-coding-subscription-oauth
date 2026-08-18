import { describe, expect, it } from "vitest";
import { codingOAuthProxyUnreachableHint, ensureCodingOAuthProxy } from "../../src/core/proxy.ts";

describe("codingOAuthProxyUnreachableHint", () => {
	it("names CODING_OAUTH_PROXY after a scoped proxy is installed", () => {
		ensureCodingOAuthProxy("http://127.0.0.1:17990");
		expect(codingOAuthProxyUnreachableHint()).toBe("; check that CODING_OAUTH_PROXY is reachable");
	});
});

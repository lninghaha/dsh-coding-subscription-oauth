import { describe, expect, it } from "vitest";
import { isMisclassifiedContextWindowError, remapAuthFailureIfContextOverflow } from "../../src/core/kimi-errors.ts";

describe("isMisclassifiedContextWindowError", () => {
	it("recognizes Kimi Code's 401 context-capacity payload", () => {
		expect(
			isMisclassifiedContextWindowError(
				'401 {"error":{"type":"authentication_error","message":"k3-256k supports only 256K context."},"type":"error"}',
			),
		).toBe(true);
	});

	it("does not treat a genuine authentication 401 as overflow", () => {
		expect(isMisclassifiedContextWindowError("401 authentication_error: invalid token")).toBe(false);
	});
});

describe("remapAuthFailureIfContextOverflow", () => {
	it("rewrites only AUTH failures whose message is a context-capacity error", () => {
		expect(
			remapAuthFailureIfContextOverflow({
				message: "k3-256k supports only 256K context.",
				code: "AUTH",
			}),
		).toEqual({ message: "k3-256k supports only 256K context.", code: "CONTEXT_WINDOW_EXCEEDED" });
		expect(remapAuthFailureIfContextOverflow({ message: "401 invalid token", code: "AUTH" })).toEqual({
			message: "401 invalid token",
			code: "AUTH",
		});
		expect(
			remapAuthFailureIfContextOverflow({
				message: "k3-256k supports only 256K context.",
				code: "RATE_LIMIT",
			}),
		).toEqual({ message: "k3-256k supports only 256K context.", code: "RATE_LIMIT" });
	});
});

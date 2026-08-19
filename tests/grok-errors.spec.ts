import { describe, expect, it } from "vitest";
import { isXaiCapacityError, remapXaiCapacityFailure } from "../src/grok-errors.ts";

describe("isXaiCapacityError", () => {
	it("recognizes xAI capacity / demand / priority / overload wording", () => {
		expect(
			isXaiCapacityError(
				"Error Code null: The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing",
			),
		).toBe(true);
		expect(isXaiCapacityError("upstream overloaded, retry later")).toBe(true);
		expect(isXaiCapacityError("HIGH DEMAND on this model")).toBe(true);
	});

	it("does not treat unrelated failures as capacity", () => {
		expect(isXaiCapacityError("401 invalid token")).toBe(false);
		expect(isXaiCapacityError("429 rate limit exceeded")).toBe(false);
		expect(isXaiCapacityError("context window exceeded")).toBe(false);
	});
});

describe("remapXaiCapacityFailure", () => {
	it("rewrites any code whose message is an xAI capacity error to RATE_LIMIT", () => {
		const message =
			"The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing";
		expect(remapXaiCapacityFailure({ message, code: "PI_AI_ERROR" })).toEqual({
			message,
			code: "RATE_LIMIT",
		});
		expect(remapXaiCapacityFailure({ message, code: "AUTH" })).toEqual({
			message,
			code: "RATE_LIMIT",
		});
		expect(remapXaiCapacityFailure({ message, code: "RATE_LIMIT" })).toEqual({
			message,
			code: "RATE_LIMIT",
		});
	});

	it("leaves non-capacity failures unchanged", () => {
		expect(remapXaiCapacityFailure({ message: "401 invalid token", code: "AUTH" })).toEqual({
			message: "401 invalid token",
			code: "AUTH",
		});
		expect(remapXaiCapacityFailure({ message: "pi-ai stream error", code: "PI_AI_ERROR" })).toEqual({
			message: "pi-ai stream error",
			code: "PI_AI_ERROR",
		});
	});
});

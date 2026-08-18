import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	JSON_BODY_LIMIT_BYTES,
	JsonRequestError,
	readJsonRequest,
	requestErrorStatus,
} from "../../src/core/http-json.ts";

function request(body: string | Buffer = "", headers: IncomingMessage["headers"] = {}): IncomingMessage {
	const stream = Readable.from([body]) as unknown as IncomingMessage;
	Object.defineProperty(stream, "headers", { value: headers, configurable: true });
	return stream;
}

describe("bounded JSON request reader", () => {
	it("parses valid JSON and treats an empty body as an object", async () => {
		await expect(readJsonRequest(request('{"provider":"grok"}'))).resolves.toEqual({ provider: "grok" });
		await expect(readJsonRequest(request())).resolves.toEqual({});
	});

	it("maps malformed JSON to a 400 request error", async () => {
		await expect(readJsonRequest(request("{not-json"))).rejects.toMatchObject({
			name: "JsonRequestError",
			statusCode: 400,
			message: "request body must contain valid JSON",
		});
	});

	it("rejects an oversized declared or streamed body with 413", async () => {
		const declared = request("", { "content-length": String(JSON_BODY_LIMIT_BYTES + 1) });
		await expect(readJsonRequest(declared)).rejects.toMatchObject({ statusCode: 413 });

		const streamed = request(Buffer.alloc(JSON_BODY_LIMIT_BYTES + 1));
		await expect(readJsonRequest(streamed)).rejects.toMatchObject({ statusCode: 413 });
	});

	it("only overrides route status codes for body-reader failures", () => {
		expect(requestErrorStatus(new JsonRequestError(400, "bad JSON"), 500)).toBe(400);
		expect(requestErrorStatus(new JsonRequestError(413, "too large"), 409)).toBe(413);
		expect(requestErrorStatus(new Error("domain failure"), 409)).toBe(409);
	});
});

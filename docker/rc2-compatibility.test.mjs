import assert from "node:assert/strict";
import test from "node:test";
import { assertHttp200 } from "./rc2-http-status.mjs";

test("rc2 compatibility rejects every non-200 route status", async () => {
	assert.doesNotThrow(() => assertHttp200("/", 200));
	for (const status of [500, 503, 401, 404]) assert.throws(() => assertHttp200("/", status));
});

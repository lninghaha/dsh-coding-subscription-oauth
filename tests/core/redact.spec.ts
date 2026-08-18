import { describe, expect, it } from "vitest";
import { redactProxyUrl, safeMessage } from "../../src/core/redact.ts";

describe("safeMessage", () => {
	it("redacts jwt-shaped tokens and oauth query values", () => {
		const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart";
		expect(safeMessage(new Error(`failed ${jwt} access_token=abc.def refresh_token=xyz`))).toBe(
			"failed [redacted token] access_token=[redacted] refresh_token=[redacted]",
		);
	});

	it("redacts pasted authorization codes", () => {
		expect(safeMessage(new Error("exchange failed for code=abc123def&state=x"))).toBe(
			"exchange failed for code=[redacted]&state=x",
		);
	});

	it("redacts Claude OAuth and bearer tokens in text or JSON", () => {
		expect(safeMessage('Authorization: Bearer kimi-secret access_token":"json-secret" sk-ant-oat01-secret')).toBe(
			'Authorization: Bearer [redacted] access_token":"[redacted]" [redacted token]',
		);
	});

	it("caps diagnostic length", () => {
		expect(safeMessage("x".repeat(2000)).length).toBe(1000);
	});

	it("redacts opaque tokens that follow sensitive labels", () => {
		const opaque = "abcdefghijklmnopqrstuvwxyz0123";
		expect(safeMessage(`network error: client_secret=${opaque} api_key=${opaque} password=${opaque}`)).toBe(
			"network error: client_secret=[redacted] api_key=[redacted] password=[redacted]",
		);
		expect(safeMessage(`{"client_secret":"${opaque}","api_key":"${opaque}"}`)).toBe(
			'{"client_secret":"[redacted]","api_key":"[redacted]"}',
		);
		expect(safeMessage(`Authorization ${opaque} trail`)).toBe(`Authorization [redacted] trail`);
		expect(safeMessage(`client_secret: ${opaque} trail`)).toBe("client_secret: [redacted] trail");
	});

	it("redacts every mixed-case occurrence, not only the first match", () => {
		const opaque = "abcdefghijklmnopqrstuvwxyz0123";
		expect(safeMessage(`API_KEY=${opaque} api_key=${opaque} Authorization ${opaque} authorization ${opaque}`)).toBe(
			"API_KEY=[redacted] api_key=[redacted] Authorization [redacted] authorization [redacted]",
		);
	});

	it("does not redact ordinary prose that happens to contain a credential label", () => {
		expect(safeMessage("the code is fun to write")).toBe("the code is fun to write");
		expect(safeMessage("token missing, please retry")).toBe("token missing, please retry");
		expect(safeMessage("authorization pending on manager approval")).toBe("authorization pending on manager approval");
		// Short structured values are still redacted by the legacy rules, but only
		// in the existing JSON/URL shapes — a code-style word like `code: a` is left.
		expect(safeMessage("status: code: a value")).toBe("status: code: a value");
	});

	it("strips userinfo from proxy URLs without changing the host", () => {
		expect(redactProxyUrl("http://user:secret@127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
		expect(redactProxyUrl("http://127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
		expect(redactProxyUrl("not a url")).toBe("not a url");
	});

	it("redacts the sk- and xai- opaque token prefixes", () => {
		const opaqueSk = "sk-" + "abcdefghijklmnop"; // 16+ chars after prefix
		const opaqueXai = "xai-" + "abcdefghijklmnopqrstuv";
		const shortXai = "xai-secret-value";
		expect(safeMessage(`got401: ${opaqueSk}, ${opaqueXai}, ${shortXai}`)).toBe(
			"got401: [redacted token], [redacted token], [redacted token]",
		);
	});
});

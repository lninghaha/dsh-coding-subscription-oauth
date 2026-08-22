import { describe, expect, it } from "vitest";
import { buildGatewaySnippets } from "../src/client/gatewaySnippets.ts";

describe("gateway snippets", () => {
	it("builds curl, python, and ide snippets with base URLs and key", () => {
		const snippets = buildGatewaySnippets(
			"http://127.0.0.1:18080/v1",
			"http://127.0.0.1:18080",
			"sk-test",
			"gpt-5.3-codex",
		);
		expect(snippets.curl).toContain("http://127.0.0.1:18080/v1/chat/completions");
		expect(snippets.curl).toContain("Bearer sk-test");
		expect(snippets.python).toContain('base_url="http://127.0.0.1:18080/v1"');
		expect(snippets.ide).toContain("http://127.0.0.1:18080");
		expect(snippets.curl).toContain('"model":"gpt-5.3-codex"');
	});

	it("uses placeholder when key is empty", () => {
		const snippets = buildGatewaySnippets("http://127.0.0.1:1/v1", "http://127.0.0.1:1", "");
		expect(snippets.curl).toContain("<your-gateway-key>");
		expect(snippets.curl).not.toContain("****");
	});
});

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_OAUTH_ROUTE, CODEX_OAUTH_ROUTE, GROK_BUILD_ROUTE, KIMI_CODE_OAUTH_ROUTE } from "../src/ids.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("bundle composition", () => {
	it("inserts the grok-build host plugin and a Grok Build default model", async () => {
		const patch = await readFile(join(root, "cordis.patch.yml"), "utf8");
		expect(patch).toContain("provider: grok-build");
		expect(patch).toMatch(/model: grok-4\./);
		expect(patch).toContain("id: llm-coding-subscription-oauth");
		expect(patch).toContain("name: dsh-coding-subscription-oauth");
	});

	it("exposes collision-free OAuth route aliases", async () => {
		expect([GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, KIMI_CODE_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE]).toEqual([
			"grok-build",
			"codex-oauth",
			"kimi-code-oauth",
			"claude-code-oauth",
		]);
		const source = await readFile(join(root, "src/index.ts"), "utf8");
		expect(source).toContain("[...CODING_OAUTH_ROUTES]");
		expect(source).toContain("registerCodingOAuthRoutes");
	});

	it("ships a v0.4 host bundle that matches the capability client", async () => {
		const server = await readFile(join(root, "lib/index.js"), "utf8");
		for (const marker of [
			"/plugins/dsh-coding-subscription-oauth/oauth/sources",
			"/plugins/dsh-coding-subscription-oauth/capabilities",
			"codex-oauth-fast",
			"XAI_API_KEY",
			"/plugins/dsh-coding-subscription-oauth/imagine/media/",
		]) {
			expect(server).toContain(marker);
		}
		const imports = server.match(/^import .*$/gm) ?? [];
		expect(imports.some((statement) => statement.includes('"@deepseek-ai/dsh-tools"'))).toBe(false);
	});

	it("ships the pinned Antigravity authentication-discovery patch", async () => {
		const patch = await readFile(join(root, "patches/dsh-agy@0.1.2.patch"), "utf8");
		expect(patch).toContain('+\t\t\tname: "Google Antigravity (OAuth)"');
		expect(patch).toContain("+\t\t\tif (!session) return [];");
		expect(patch).toContain("+\t\t} catch {");
	});

	it("declares a dsh bundle and web client half", async () => {
		const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
			name: string;
			dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } };
			exports: Record<string, unknown>;
			files: string[];
		};
		expect(manifest.name).toBe("dsh-coding-subscription-oauth");
		expect((manifest as { version?: string }).version).toBe("0.5.2");
		expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
		expect(manifest.dsh.client.platform).toBe("web");
		expect(manifest.dsh.client.inject).toContain("@deepseek-ai/dsh-client-ui-settings");
		expect(manifest.exports["./client"]).toBe("./lib/client.js");
		expect(manifest.files).toContain("scripts/verify-deployed-catalog.mjs");
		expect(manifest.files).toContain("scripts/smoke-deployed-routes.mjs");
		expect(manifest.files).toContain("patches/dsh-agy@0.1.2.patch");
	});
});

#!/usr/bin/env node
/** Standalone credential CLI for the coding-subscription bundle. */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { grokBuildAuthStatus, importGrokBuildSession, loginGrokBuildSession } from "./auth.ts";
import { GATEWAY_TOS_WARNING } from "./gateway.ts";
import { GATEWAY_DEFAULT_BIND, GATEWAY_DEFAULT_PORT } from "./gateway-config.ts";
import { grokAuthPath } from "./grok-import.ts";
import { XAI_PI_PROVIDER } from "./ids.ts";
import { loginGrokBuildPkce } from "./oauth.ts";
import { oauthProviderDefinition, type SubscriptionLoginMethod } from "./oauth-providers.ts";
import { OAuthProviderSession } from "./oauth-session.ts";
import { codingOAuthProxyInEffect, ensureCodingOAuthProxy } from "./proxy.ts";
import { redactProxyUrl, safeMessage } from "./redact.ts";
import { GrokBuildSession } from "./session.ts";
import { grokBuildAuthPath } from "./store.ts";

export type CliAction = "login" | "logout" | "status" | "import";
export type CliProvider = "all" | "grok" | "codex" | "kimi" | "claude";

function openBrowser(rawUrl: string): void {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") throw new Error(`refusing to open non-HTTPS authorization URL from ${url.host}`);
	const command =
		process.platform === "win32"
			? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url.href] }
			: process.platform === "darwin"
				? { file: "open", args: [url.href] }
				: { file: "xdg-open", args: [url.href] };
	try {
		const child = spawn(command.file, command.args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// The printed URL remains the manual fallback.
	}
}

function notify(event: AuthEvent, useBrowser: boolean): void {
	switch (event.type) {
		case "auth_url":
			process.stdout.write(`Open this URL to sign in:\n${event.url}\n`);
			if (event.instructions !== undefined) process.stdout.write(`${event.instructions}\n`);
			if (useBrowser) openBrowser(event.url);
			break;
		case "device_code":
			process.stdout.write(`Open this URL to sign in:\n${event.verificationUri}\n`);
			if (event.userCode.length > 0) process.stdout.write(`Enter code: ${event.userCode}\n`);
			if (useBrowser) openBrowser(event.verificationUri);
			break;
		case "info":
		case "progress":
			process.stdout.write(`${event.message}\n`);
			break;
		default:
			event satisfies never;
	}
}

function selectLoginOption(prompt: Extract<AuthPrompt, { type: "select" }>, method?: SubscriptionLoginMethod): string {
	if (method !== undefined) {
		const exact = method === "device" ? ["device_code", "device-code", "device"] : ["browser", "browser_login"];
		for (const id of exact) if (prompt.options.some((option) => option.id === id)) return id;
		const label = method === "device" ? /device|headless/iu : /browser|pkce/iu;
		const match = prompt.options.find((option) => label.test(option.label));
		if (match !== undefined) return match.id;
	}
	const oauth = prompt.options.find((option) => option.id === "oauth" || option.id.includes("oauth"));
	return oauth?.id ?? prompt.options[0]?.id ?? "";
}

async function answerPrompt(
	prompt: AuthPrompt,
	question: (text: string, options: { signal?: AbortSignal }) => Promise<string>,
	method?: SubscriptionLoginMethod,
): Promise<string> {
	if (prompt.type === "select") return selectLoginOption(prompt, method);
	const suffix = prompt.placeholder === undefined ? "" : ` (${prompt.placeholder})`;
	return question(`${prompt.message}${suffix}: `, {
		...(prompt.signal === undefined ? {} : { signal: prompt.signal }),
	});
}

function printHelp(): void {
	process.stdout.write(
		[
			"Usage: dsh-coding-oauth <login|logout|status|import> [provider] [options]",
			"",
			"Providers: grok (default), codex, kimi, claude; status also accepts all.",
			"",
			"  login grok [--pkce|--device-auth]",
			"  login codex [--device-auth|--browser]  (device code is the default)",
			"  login kimi                              (device code)",
			"  login claude [--browser]                (PKCE + redirect paste fallback)",
			"  import [grok]                            import ~/.grok/auth.json only",
			"  logout [provider]",
			"  status [provider|all]",
			"",
			"Network: set CODING_OAUTH_PROXY or HTTPS_PROXY.",
			"Only audited subscription hosts use the proxy; Kimi stays direct by default.",
			"",
		].join("\n"),
	);
}

function parseProvider(raw: string | undefined, action: CliAction): CliProvider {
	if (raw === undefined || raw.startsWith("--")) return "grok";
	if (raw === "all" && action === "status") return raw;
	if (raw === "grok" || raw === "codex" || raw === "kimi" || raw === "claude") return raw;
	throw new Error(`unknown provider ${JSON.stringify(raw)}`);
}

function loginMethod(provider: CliProvider, flags: readonly string[]): SubscriptionLoginMethod | undefined {
	if (provider === "codex") return flags.includes("--browser") ? "browser" : "device";
	if (provider === "kimi") return "device";
	if (provider === "claude") return "browser";
	return undefined;
}

function allowedFlags(action: CliAction, provider: CliProvider): readonly string[] {
	if (action !== "login") return [];
	if (provider === "grok") return ["--pkce", "--device-auth"];
	if (provider === "codex") return ["--device-auth", "--browser"];
	if (provider === "kimi") return ["--device-auth"];
	if (provider === "claude") return ["--browser"];
	return [];
}

async function subscriptionStatus(provider: Exclude<CliProvider, "all" | "grok">): Promise<boolean> {
	const definition = oauthProviderDefinition(provider);
	if (definition === undefined) throw new Error(`provider ${provider} is not configured`);
	const session = new OAuthProviderSession(definition);
	await session.loadCachedModels();
	const status = await session.status();
	if (!status.authenticated) {
		process.stdout.write(`${definition.displayName} for dsh: signed out\n`);
		return false;
	}
	const suffix =
		status.expiresAt === undefined
			? ""
			: `; access token expires ${new Date(status.expiresAt).toISOString()} (refresh is automatic)`;
	process.stdout.write(`${definition.displayName} for dsh: signed in${suffix}\n`);
	process.stdout.write(
		`models: ${session
			.visibleModels()
			.map((model) => model.id)
			.join(", ")}\n`,
	);
	return true;
}

async function printGatewayWarning(): Promise<void> {
	try {
		const response = await fetch(`http://${GATEWAY_DEFAULT_BIND}:${String(GATEWAY_DEFAULT_PORT)}/healthz`, {
			signal: AbortSignal.timeout(200),
		});
		if (!response.ok) return;
		process.stdout.write(`WARNING: ${GATEWAY_TOS_WARNING}\n`);
	} catch {
		// Gateway is off or not on the default loopback port.
	}
}

async function grokStatus(): Promise<boolean> {
	const session = new GrokBuildSession();
	await session.loadCachedCatalog();
	const status = await grokBuildAuthStatus(session.store);
	if (!status.authenticated) {
		process.stdout.write("Grok Build for dsh: signed out\n");
		return false;
	}
	await session.refreshLiveCatalog();
	const expires = status.expiresAt;
	const suffix =
		expires === undefined || Number.isNaN(expires.valueOf())
			? ""
			: `; access token expires ${expires.toISOString()} (refresh is automatic)`;
	process.stdout.write(`Grok Build for dsh: signed in${suffix}\n`);
	process.stdout.write(
		`models (${session.catalogSource}): ${session
			.visibleModels()
			.map((model) => model.id)
			.join(", ")}\n`,
	);
	if (session.catalogError !== undefined) {
		process.stderr.write(`dsh-coding-oauth: live models-v2 failed: ${session.catalogError}\n`);
	}
	return true;
}

async function loginSubscription(
	provider: Exclude<CliProvider, "all" | "grok">,
	flags: readonly string[],
): Promise<void> {
	const definition = oauthProviderDefinition(provider);
	if (definition === undefined) throw new Error(`provider ${provider} is not configured`);
	const method = loginMethod(provider, flags);
	const session = new OAuthProviderSession(definition);
	await session.loadCachedModels();
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await session.login({
			prompt: (prompt) => answerPrompt(prompt, (text, options) => readline.question(text, options), method),
			notify: (event) => notify(event, true),
		});
	} finally {
		readline.close();
	}
	process.stdout.write(
		`${definition.displayName} for dsh: signed in; credentials saved to ${session.store.filename}\n`,
	);
	process.stdout.write(
		`models: ${session
			.visibleModels()
			.map((model) => model.id)
			.join(", ")}\n`,
	);
}

async function loginGrok(flags: readonly string[]): Promise<void> {
	const usePkce = flags.includes("--pkce");
	const session = new GrokBuildSession();
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		if (usePkce) {
			const credential = await loginGrokBuildPkce({
				onAuthorizeUrl: (url) => {
					process.stdout.write(`Open this URL to sign in:\n${url}\n`);
					openBrowser(url);
				},
				awaitCode: (signal) =>
					readline.question("After authorizing, paste the code or full redirect URL: ", { signal }),
			});
			const written = await session.store.modify(XAI_PI_PROVIDER, async () => credential);
			if (written === undefined) throw new Error("credential store refused the login credential");
			await session.refreshLiveCatalog();
		} else {
			await loginGrokBuildSession(
				{
					prompt: (prompt) => answerPrompt(prompt, (text, options) => readline.question(text, options)),
					notify: (event) => notify(event, true),
				},
				session,
			);
		}
	} finally {
		readline.close();
	}
	process.stdout.write(`Grok Build for dsh: signed in; credentials saved to ${grokBuildAuthPath()}\n`);
	process.stdout.write(
		`models (${session.catalogSource}): ${session
			.visibleModels()
			.map((model) => model.id)
			.join(", ")}\n`,
	);
}

export async function run(argv: readonly string[]): Promise<number> {
	ensureCodingOAuthProxy();
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const rawAction = argv[0];
	if (rawAction !== "login" && rawAction !== "logout" && rawAction !== "status" && rawAction !== "import") {
		process.stderr.write(
			`dsh-coding-oauth: expected login, logout, status, or import; got ${JSON.stringify(rawAction)}\n`,
		);
		return 1;
	}
	const action: CliAction = rawAction;
	try {
		const provider = parseProvider(argv[1], action);
		const flags = argv[1]?.startsWith("--") === true ? argv.slice(1) : argv.slice(2);
		const allowed = allowedFlags(action, provider);
		if (flags.some((flag) => !allowed.includes(flag))) {
			throw new Error(`invalid options for ${action} ${provider}: ${flags.join(" ")}`);
		}
		if (action === "import" && provider !== "grok") throw new Error("import is supported only for Grok Build");
		if (action !== "status" && provider === "all") throw new Error(`${action} does not accept provider all`);

		if (action === "status") {
			if (provider === "all") {
				const results = await Promise.all([
					grokStatus(),
					subscriptionStatus("codex"),
					subscriptionStatus("kimi"),
					subscriptionStatus("claude"),
				]);
				await printGatewayWarning();
				return results.some(Boolean) ? 0 : 1;
			}
			const signedIn = provider === "grok" ? await grokStatus() : await subscriptionStatus(provider);
			await printGatewayWarning();
			return signedIn ? 0 : 1;
		}

		if (action === "logout") {
			if (provider === "grok") {
				await new GrokBuildSession().logout();
				process.stdout.write(`Grok Build for dsh: signed out; removed ${grokBuildAuthPath()}\n`);
			} else {
				const definition = oauthProviderDefinition(provider);
				if (definition === undefined) throw new Error(`provider ${provider} is not configured`);
				const session = new OAuthProviderSession(definition);
				await session.logout();
				process.stdout.write(`${definition.displayName} for dsh: signed out; removed ${session.store.filename}\n`);
			}
			return 0;
		}

		if (action === "import") {
			const session = new GrokBuildSession();
			await importGrokBuildSession(session);
			process.stdout.write(`Grok Build for dsh: imported ${grokAuthPath()} into ${grokBuildAuthPath()}\n`);
			process.stdout.write("The Grok CLI file was not modified. Later dsh refresh may rotate the token.\n");
			process.stdout.write(
				`models (${session.catalogSource}): ${session
					.visibleModels()
					.map((model) => model.id)
					.join(", ")}\n`,
			);
			return 0;
		}

		const proxy = codingOAuthProxyInEffect();
		if (proxy !== undefined) process.stdout.write(`Using scoped coding OAuth proxy ${redactProxyUrl(proxy)}\n`);
		if (provider === "all") throw new Error("login does not accept provider all");
		if (provider === "grok") await loginGrok(flags);
		else await loginSubscription(provider, flags);
		return 0;
	} catch (error: unknown) {
		process.stderr.write(`dsh-coding-oauth: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	process.exitCode = await run(process.argv.slice(2));
}

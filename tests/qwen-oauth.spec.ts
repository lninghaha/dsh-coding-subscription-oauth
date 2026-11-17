import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QWEN_CODE_OAUTH_ROUTE, QWEN_PI_PROVIDER } from "../src/ids.ts";
import { oauthProviderDefinition, QWEN_CODE_OAUTH_PROVIDER } from "../src/oauth-providers.ts";
import {
	QWEN_DEVICE_GRANT,
	QWEN_OAUTH_CLIENT_ID,
	QWEN_OAUTH_SCOPE,
	qwenCodeOAuth,
	qwenOAuthHost,
} from "../src/qwen-oauth.ts";
import { QWEN_CODE_MODELS, QWEN_SUBSCRIPTION_BASE_URL } from "../src/qwen-provider.ts";

type Reply = { status: number; body: unknown };
type Handler = (path: string, form: URLSearchParams, auth: string | undefined) => Reply;

let server: Server;
let handler: Handler;
const requests: { path: string; form: URLSearchParams; auth: string | undefined }[] = [];

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
	return new Promise((resolve) => {
		let text = "";
		req.on("data", (chunk) => {
			text += String(chunk);
		});
		req.on("end", () => resolve(new URLSearchParams(text)));
	});
}

beforeEach(async () => {
	requests.length = 0;
	server = createServer(async (req, res) => {
		const form = await readForm(req);
		const path = req.url ?? "";
		const auth = req.headers.authorization;
		requests.push({ path, form, auth });
		const result = handler(path, form, auth);
		res.writeHead(result.status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(result.body));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	vi.stubEnv("QWEN_CODE_OAUTH_HOST", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function interaction(signal = new AbortController().signal) {
	const notify = vi.fn();
	return { notify, value: { signal, notify } as unknown as ProviderAuthInteraction };
}

const DEVICE = {
	device_code: "dev-code",
	user_code: "ABCD-1234",
	verification_uri: "https://chat.qwen.ai/authorize",
	verification_uri_complete: "https://chat.qwen.ai/authorize?user_code=ABCD-1234",
	expires_in: 60,
	interval: 1,
};
const TOKENS = {
	access_token: "access-1",
	refresh_token: "refresh-1",
	token_type: "Bearer",
	expires_in: 3600,
	scope: "x",
};
const USER = (member_type: string) => ({ sub: "u1", name: "n", email: "e", member_type });

describe("Qwen Code subscription OAuth", () => {
	it("runs the device flow like the official CLI and enforces a Plus/Pro plan", async () => {
		let polls = 0;
		handler = (path) => {
			if (path === "/api/oauth/device/code") return { status: 200, body: DEVICE };
			if (path === "/api/oauth/userinfo") return { status: 200, body: USER("Pro") };
			polls += 1;
			return polls < 2 ? { status: 400, body: { error: "authorization_pending" } } : { status: 200, body: TOKENS };
		};
		const { notify, value } = interaction();
		const before = Date.now();
		const credential = await qwenCodeOAuth.login(value);

		expect(credential).toMatchObject({ type: "oauth", access: "access-1", refresh: "refresh-1" });
		expect(credential.expires).toBeGreaterThanOrEqual(before + 3_600_000 - 1_000);
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "device_code",
				userCode: "ABCD-1234",
				verificationUri:
					"https://chat.qwen.ai/authorize?user_code=ABCD-1234&client=cli&entry=qwen_code&paywallScene=cli",
			}),
		);
		const [start, poll, , userinfo] = requests;
		expect(start?.form.get("client_id")).toBe(QWEN_OAUTH_CLIENT_ID);
		expect(start?.form.get("scope")).toBe(QWEN_OAUTH_SCOPE);
		expect(start?.form.has("code_challenge")).toBe(false);
		expect(poll?.path).toBe("/api/oauth/token");
		expect(poll?.form.get("grant_type")).toBe(QWEN_DEVICE_GRANT);
		expect(poll?.form.get("device_code")).toBe("dev-code");
		expect(userinfo?.auth).toBe("Bearer access-1");
	}, 15_000);

	it("rejects a non Plus/Pro account and revokes the grant without returning a credential", async () => {
		handler = (path) => {
			if (path === "/api/oauth/device/code") return { status: 200, body: DEVICE };
			if (path === "/api/oauth/userinfo") return { status: 200, body: USER("free") };
			if (path === "/api/oauth/revoke") return { status: 200, body: {} };
			return { status: 200, body: TOKENS };
		};
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Plus or Pro");
		const revoke = requests.find((r) => r.path === "/api/oauth/revoke");
		expect(revoke?.form.get("token")).toBe("refresh-1");
		expect(revoke?.form.get("token_type_hint")).toBe("refresh_token");
	}, 15_000);

	it("retries a transient 5xx while polling", async () => {
		let polls = 0;
		handler = (path) => {
			if (path === "/api/oauth/device/code") return { status: 200, body: { ...DEVICE, interval: 1 } };
			if (path === "/api/oauth/userinfo") return { status: 200, body: USER("plus") };
			polls += 1;
			if (polls === 1) return { status: 503, body: {} };
			return { status: 200, body: TOKENS };
		};
		await expect(qwenCodeOAuth.login(interaction().value)).resolves.toMatchObject({ access: "access-1" });
		expect(polls).toBe(2);
	}, 15_000);

	it("fails on access_denied and expired_token without echoing server bodies", async () => {
		handler = (path) =>
			path === "/api/oauth/device/code"
				? { status: 200, body: DEVICE }
				: { status: 400, body: { error: "access_denied", error_description: "secret-detail" } };
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Qwen Code login was denied.");
		handler = (path) =>
			path === "/api/oauth/device/code"
				? { status: 200, body: DEVICE }
				: { status: 400, body: { error: "expired_token" } };
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow(/expired/);
	}, 15_000);

	it("rejects an incomplete or untrusted device response", async () => {
		handler = () => ({ status: 200, body: { ...DEVICE, verification_uri_complete: "javascript:alert(1)" } });
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Invalid Qwen Code device authorization");
		handler = () => ({ status: 200, body: { ...DEVICE, interval: undefined } });
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Invalid Qwen Code device authorization");
	});

	it("is cancellable while waiting for approval", async () => {
		handler = (path) =>
			path === "/api/oauth/device/code"
				? { status: 200, body: DEVICE }
				: { status: 400, body: { error: "authorization_pending" } };
		const controller = new AbortController();
		const pending = qwenCodeOAuth.login(interaction(controller.signal).value);
		setTimeout(() => controller.abort(), 100);
		await expect(pending).rejects.toThrow(/cancel/i);
	});

	it("refreshes tokens through the same token endpoint", async () => {
		handler = () => ({ status: 200, body: { ...TOKENS, access_token: "access-2", refresh_token: "refresh-2" } });
		const next = await qwenCodeOAuth.refresh(
			{ type: "oauth", access: "old", refresh: "refresh-1", expires: 0 },
			new AbortController().signal,
		);
		expect(next).toMatchObject({ access: "access-2", refresh: "refresh-2" });
		expect(requests[0]?.path).toBe("/api/oauth/token");
		expect(requests[0]?.form.get("grant_type")).toBe("refresh_token");
		expect(requests[0]?.form.get("client_id")).toBe(QWEN_OAUTH_CLIENT_ID);
		expect(requests[0]?.form.get("refresh_token")).toBe("refresh-1");
	});

	it("treats an invalid_grant refresh as a dead credential without retrying", async () => {
		handler = () => ({ status: 400, body: { error: "invalid_grant" } });
		await expect(
			qwenCodeOAuth.refresh({ type: "oauth", access: "a", refresh: "r", expires: 0 }, new AbortController().signal),
		).rejects.toThrow(/unauthorized/);
		expect(requests).toHaveLength(1);
	});

	it("derives Bearer auth from the credential", async () => {
		await expect(qwenCodeOAuth.toAuth({ type: "oauth", access: "tok", refresh: "r", expires: 1 })).resolves.toEqual({
			headers: { Authorization: "Bearer tok" },
		});
	});

	it("rejects non-https hosts except loopback", () => {
		expect(() => qwenOAuthHost({ QWEN_CODE_OAUTH_HOST: "http://evil.example.com" })).toThrow(/https/);
		expect(qwenOAuthHost({ QWEN_CODE_OAUTH_HOST: "https://mirror.example.com/x" })).toBe("https://mirror.example.com");
		expect(qwenOAuthHost({})).toBe("https://auth.qwen.ai");
	});
});

describe("Qwen Code provider definition", () => {
	it("registers the route and a Bearer-capable request provider on the official gateway", async () => {
		expect(oauthProviderDefinition("qwen")).toBe(QWEN_CODE_OAUTH_PROVIDER);
		expect(QWEN_CODE_OAUTH_PROVIDER.route).toBe(QWEN_CODE_OAUTH_ROUTE);
		expect(QWEN_CODE_OAUTH_PROVIDER.loginMethods).toEqual(["device"]);
		const provider = QWEN_CODE_OAUTH_PROVIDER.requestProvider(["qwen3.8-max"]);
		expect(provider.id).toBe(QWEN_PI_PROVIDER);
		expect(provider.getModels().map((model) => model.id)).toEqual(["qwen3.8-max"]);
		expect(provider.getModels()[0]?.baseUrl).toBe(QWEN_SUBSCRIPTION_BASE_URL);
		expect(QWEN_SUBSCRIPTION_BASE_URL).toBe("https://api.qwen.ai/compatible-mode/v1");
		const auth = await provider.auth.apiKey?.resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			credential: { type: "api_key", key: "qwen-token" },
			signal: new AbortController().signal,
		});
		expect(auth?.auth).toEqual({ apiKey: "qwen-token" });
		expect(QWEN_CODE_MODELS.every((model) => model.provider === QWEN_PI_PROVIDER)).toBe(true);
	});
});

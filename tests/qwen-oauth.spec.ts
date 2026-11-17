import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QWEN_CODE_OAUTH_ROUTE, QWEN_PI_PROVIDER } from "../src/ids.ts";
import { oauthProviderDefinition, QWEN_CODE_OAUTH_PROVIDER } from "../src/oauth-providers.ts";
import {
	generateQwenPkce,
	QWEN_DEVICE_GRANT,
	QWEN_OAUTH_CLIENT_ID,
	qwenCodeOAuth,
	qwenOAuthHost,
} from "../src/qwen-oauth.ts";
import { QWEN_CODE_MODELS, QWEN_PORTAL_BASE_URL } from "../src/qwen-provider.ts";

type Handler = (path: string, form: URLSearchParams) => { status: number; body: unknown };

let server: Server;
let handler: Handler;
const requests: { path: string; form: URLSearchParams }[] = [];

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
		requests.push({ path, form });
		const result = handler(path, form);
		res.writeHead(result.status, { "Content-Type": "application/json" });
		res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	vi.stubEnv("QWEN_CODE_OAUTH_HOST", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
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

describe("Qwen Code OAuth", () => {
	it("runs the device flow with PKCE and returns an OAuth credential", async () => {
		let polls = 0;
		handler = (path) => {
			if (path.endsWith("/device/code")) return { status: 200, body: DEVICE };
			polls += 1;
			return polls < 2
				? { status: 400, body: { error: "authorization_pending" } }
				: { status: 200, body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 } };
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
				verificationUri: DEVICE.verification_uri_complete,
			}),
		);
		const start = requests[0]!;
		expect(start.form.get("client_id")).toBe(QWEN_OAUTH_CLIENT_ID);
		expect(start.form.get("code_challenge_method")).toBe("S256");
		const poll = requests[1]!;
		expect(poll.form.get("grant_type")).toBe(QWEN_DEVICE_GRANT);
		expect(poll.form.get("device_code")).toBe("dev-code");
		// The verifier sent at token time must hash to the challenge sent at start time.
		const { createHash } = await import("node:crypto");
		expect(
			createHash("sha256")
				.update(poll.form.get("code_verifier") ?? "")
				.digest("base64url"),
		).toBe(start.form.get("code_challenge"));
	}, 15_000);

	it("fails on access_denied and expired_token without echoing server bodies", async () => {
		handler = (path) =>
			path.endsWith("/device/code")
				? { status: 200, body: DEVICE }
				: { status: 400, body: { error: "access_denied", error_description: "secret-detail" } };
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Qwen Code login was denied.");
		handler = (path) =>
			path.endsWith("/device/code") ? { status: 200, body: DEVICE } : { status: 400, body: { error: "expired_token" } };
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow(/expired/);
	}, 15_000);

	it("rejects a device response with an untrusted verification URL", async () => {
		handler = () => ({
			status: 200,
			body: { ...DEVICE, verification_uri: "javascript:alert(1)", verification_uri_complete: "javascript:alert(1)" },
		});
		await expect(qwenCodeOAuth.login(interaction().value)).rejects.toThrow("Invalid Qwen Code device authorization");
	});

	it("is cancellable while waiting for approval", async () => {
		handler = (path) =>
			path.endsWith("/device/code")
				? { status: 200, body: DEVICE }
				: { status: 400, body: { error: "authorization_pending" } };
		const controller = new AbortController();
		const pending = qwenCodeOAuth.login(interaction(controller.signal).value);
		setTimeout(() => controller.abort(), 100);
		await expect(pending).rejects.toThrow(/cancel/i);
	});

	it("refreshes tokens and keeps the old refresh token when the server omits one", async () => {
		handler = () => ({ status: 200, body: { access_token: "access-2", expires_in: 1800 } });
		const next = await qwenCodeOAuth.refresh(
			{ type: "oauth", access: "old", refresh: "refresh-1", expires: 0 },
			new AbortController().signal,
		);
		expect(next).toMatchObject({ access: "access-2", refresh: "refresh-1" });
		expect(requests[0]!.form.get("grant_type")).toBe("refresh_token");
		expect(requests[0]!.form.get("refresh_token")).toBe("refresh-1");
	});

	it("treats an invalid_grant refresh as a dead credential without retrying", async () => {
		handler = () => ({ status: 400, body: { error: "invalid_grant" } });
		await expect(
			qwenCodeOAuth.refresh({ type: "oauth", access: "a", refresh: "r", expires: 0 }, new AbortController().signal),
		).rejects.toThrow(/unauthorized \(status 400\)/);
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
		expect(qwenOAuthHost({})).toBe("https://chat.qwen.ai");
	});

	it("generates S256 PKCE pairs", () => {
		const a = generateQwenPkce();
		expect(a.verifier).not.toBe(generateQwenPkce().verifier);
		expect(a.verifier.length).toBeGreaterThanOrEqual(43);
	});
});

describe("Qwen Code provider definition", () => {
	it("registers the route and a Bearer-capable request provider", async () => {
		expect(oauthProviderDefinition("qwen")).toBe(QWEN_CODE_OAUTH_PROVIDER);
		expect(QWEN_CODE_OAUTH_PROVIDER.route).toBe(QWEN_CODE_OAUTH_ROUTE);
		expect(QWEN_CODE_OAUTH_PROVIDER.loginMethods).toEqual(["device"]);
		const provider = QWEN_CODE_OAUTH_PROVIDER.requestProvider(["coder-model"]);
		expect(provider.id).toBe(QWEN_PI_PROVIDER);
		expect(provider.getModels().map((model) => model.id)).toEqual(["coder-model"]);
		expect(provider.getModels()[0]?.baseUrl).toBe(QWEN_PORTAL_BASE_URL);
		const auth = await provider.auth.apiKey?.resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			credential: { type: "api_key", key: "qwen-token" },
			signal: new AbortController().signal,
		});
		expect(auth?.auth).toEqual({ apiKey: "qwen-token" });
		expect(QWEN_CODE_MODELS.every((model) => model.provider === QWEN_PI_PROVIDER)).toBe(true);
	});
});

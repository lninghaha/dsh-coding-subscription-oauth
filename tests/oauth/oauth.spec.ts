import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
	discoverOAuthEndpoints,
	extractCode,
	GrokBuildOAuthError,
	generatePkce,
	loginGrokBuildPkce,
	refreshGrokBuildToken,
} from "../../src/oauth/oauth.ts";

interface MockIdP {
	issuer: string;
	lastAuthorizeQuery: () => URLSearchParams | undefined;
	lastTokenForm: () => URLSearchParams | undefined;
	close(): Promise<void>;
}

/** Loopback OIDC issuer double: discovery + authorize (302) + token exchange. */
async function startMockIdP(
	options: { omitRefreshOnRefreshGrant?: boolean; tokenResponsePaddingBytes?: number } = {},
): Promise<MockIdP> {
	const challenges = new Map<string, string>();
	let lastAuthorizeQuery: URLSearchParams | undefined;
	let lastTokenForm: URLSearchParams | undefined;
	let issuer = "";
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/.well-known/openid-configuration") {
			res.writeHead(200, { "content-type": "application/json" }).end(
				JSON.stringify({
					issuer,
					authorization_endpoint: `${issuer}/oauth2/authorize`,
					token_endpoint: `${issuer}/oauth2/token`,
				}),
			);
			return;
		}
		if (url.pathname === "/oauth2/authorize") {
			lastAuthorizeQuery = url.searchParams;
			const redirectUri = url.searchParams.get("redirect_uri") ?? "";
			const state = url.searchParams.get("state") ?? "";
			const challenge = url.searchParams.get("code_challenge") ?? "";
			const code = `mock-code-${challenges.size}`;
			challenges.set(code, challenge);
			res.writeHead(302, { location: `${redirectUri}?code=${code}&state=${state}` }).end();
			return;
		}
		if (url.pathname === "/oauth2/token" && req.method === "POST") {
			let body = "";
			req.on("data", (chunk) => {
				body += String(chunk);
			});
			req.on("end", () => {
				lastTokenForm = new URLSearchParams(body);
				const grant = lastTokenForm.get("grant_type");
				if (grant === "authorization_code") {
					const code = lastTokenForm.get("code") ?? "";
					const verifier = lastTokenForm.get("code_verifier") ?? "";
					const expected = challenges.get(code);
					const actual = createHash("sha256").update(verifier).digest("base64url");
					if (expected === undefined || actual !== expected) {
						res
							.writeHead(400, { "content-type": "application/json" })
							.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE verification failed" }));
						return;
					}
					res.writeHead(200, { "content-type": "application/json" }).end(
						JSON.stringify({
							access_token: "mock-access",
							refresh_token: "mock-refresh",
							expires_in: 3600,
						}),
					);
					return;
				}
				if (grant === "refresh_token") {
					const payload: Record<string, unknown> = { access_token: "mock-access-2", expires_in: 3600 };
					if (!options.omitRefreshOnRefreshGrant) payload["refresh_token"] = "mock-refresh-2";
					if (options.tokenResponsePaddingBytes !== undefined) {
						payload["padding"] = "x".repeat(options.tokenResponsePaddingBytes);
					}
					res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
					return;
				}
				res
					.writeHead(400, { "content-type": "application/json" })
					.end(JSON.stringify({ error: "unsupported_grant_type" }));
			});
			return;
		}
		res.writeHead(404).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		issuer,
		lastAuthorizeQuery: () => lastAuthorizeQuery,
		lastTokenForm: () => lastTokenForm,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

function urlSignal(): { promise: Promise<string>; deliver(url: string): void } {
	let deliver: (url: string) => void = () => {};
	const promise = new Promise<string>((resolve) => {
		deliver = resolve;
	});
	return { promise, deliver };
}

describe("generatePkce", () => {
	it("produces an S256 verifier/challenge pair", () => {
		const { verifier, challenge } = generatePkce();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
	});
});

describe("extractCode", () => {
	it("passes a bare code through and parses a full redirect URL", () => {
		expect(extractCode("  abc123  ")).toBe("abc123");
		expect(extractCode("http://127.0.0.1:56121/callback?code=xyz789&state=s")).toBe("xyz789");
		expect(extractCode("not-a-url-no-query")).toBe("not-a-url-no-query");
	});
});

describe("loginGrokBuildPkce", () => {
	it("completes a PKCE login via the loopback channel", async () => {
		const idp = await startMockIdP();
		try {
			const url = urlSignal();
			const login = loginGrokBuildPkce(
				{ onAuthorizeUrl: (value) => url.deliver(value) },
				{ issuer: idp.issuer, clientId: "test-client", port: 0, allowInsecureLoopbackIssuer: true },
			);
			const authorizeUrl = await url.promise;
			// Simulate the browser: authorize → 302 → loopback callback.
			const authResponse = await fetch(authorizeUrl, { redirect: "manual" });
			expect(authResponse.status).toBe(302);
			const location = authResponse.headers.get("location")!;
			const callbackResponse = await fetch(location);
			expect(callbackResponse.status).toBe(200);
			const credential = await login;
			expect(credential).toMatchObject({ type: "oauth", access: "mock-access", refresh: "mock-refresh" });
			expect(credential.expires).toBeGreaterThan(Date.now());
			const query = idp.lastAuthorizeQuery()!;
			expect(query.get("client_id")).toBe("test-client");
			expect(query.get("response_type")).toBe("code");
			expect(query.get("code_challenge_method")).toBe("S256");
			expect(query.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
			expect(query.get("scope")).toContain("grok-cli:access");
			// The mock only answers when code_verifier matches the challenge.
			expect(idp.lastTokenForm()?.get("grant_type")).toBe("authorization_code");
		} finally {
			await idp.close();
		}
	});

	it("completes via the manual paste channel (full redirect URL accepted)", async () => {
		const idp = await startMockIdP();
		try {
			const url = urlSignal();
			const login = loginGrokBuildPkce(
				{
					onAuthorizeUrl: (value) => url.deliver(value),
					awaitCode: async () => {
						const authorizeUrl = await url.promise;
						const authResponse = await fetch(authorizeUrl, { redirect: "manual" });
						return authResponse.headers.get("location") ?? "";
					},
				},
				{ issuer: idp.issuer, clientId: "test-client", port: 0, allowInsecureLoopbackIssuer: true },
			);
			const credential = await login;
			expect(credential.access).toBe("mock-access");
		} finally {
			await idp.close();
		}
	});

	it("rejects with state_mismatch on a forged callback", async () => {
		const idp = await startMockIdP();
		try {
			const url = urlSignal();
			const login = loginGrokBuildPkce(
				{ onAuthorizeUrl: (value) => url.deliver(value) },
				{ issuer: idp.issuer, clientId: "test-client", port: 0, allowInsecureLoopbackIssuer: true },
			);
			// Attach a handler up front: the rejection lands mid-test, and a
			// late-attached .rejects would trip Node's unhandled-rejection hook.
			const outcome = login.then(
				() => ({ ok: true as const }),
				(error: unknown) => ({ ok: false as const, error }),
			);
			const authorizeUrl = await url.promise;
			const authResponse = await fetch(authorizeUrl, { redirect: "manual" });
			const location = authResponse.headers.get("location")!;
			const forged = location.replace(/state=[^&]+/, "state=forged");
			const page = await fetch(forged);
			expect(page.status).toBe(400);
			const result = await outcome;
			expect(result.ok).toBe(false);
			expect(!result.ok && result.error).toMatchObject({ code: "state_mismatch" });
		} finally {
			await idp.close();
		}
	});

	it("rejects with timeout when nothing completes", async () => {
		const idp = await startMockIdP();
		try {
			const login = loginGrokBuildPkce(
				{ onAuthorizeUrl: () => {}, timeoutMs: 150 },
				{ issuer: idp.issuer, clientId: "test-client", port: 0, allowInsecureLoopbackIssuer: true },
			);
			await expect(login).rejects.toMatchObject({ code: "timeout" });
		} finally {
			await idp.close();
		}
	});
});

describe("refreshGrokBuildToken", () => {
	it("adopts a rotated refresh token", async () => {
		const idp = await startMockIdP();
		try {
			const credential = await refreshGrokBuildToken(
				"old-refresh",
				{ issuer: idp.issuer, clientId: "test-client" },
				undefined,
				{ allowInsecureLoopbackIssuer: true },
			);
			expect(credential).toMatchObject({ type: "oauth", access: "mock-access-2", refresh: "mock-refresh-2" });
			expect(idp.lastTokenForm()?.get("refresh_token")).toBe("old-refresh");
		} finally {
			await idp.close();
		}
	});

	it("keeps the previous refresh token when the issuer does not rotate", async () => {
		const idp = await startMockIdP({ omitRefreshOnRefreshGrant: true });
		try {
			const credential = await refreshGrokBuildToken(
				"old-refresh",
				{ issuer: idp.issuer, clientId: "test-client" },
				undefined,
				{ allowInsecureLoopbackIssuer: true },
			);
			expect(credential.refresh).toBe("old-refresh");
			expect(credential.access).toBe("mock-access-2");
		} finally {
			await idp.close();
		}
	});

	it("rejects an oversized token response before JSON parsing", async () => {
		const idp = await startMockIdP({ tokenResponsePaddingBytes: 70 * 1024 });
		try {
			await expect(
				refreshGrokBuildToken("old-refresh", { issuer: idp.issuer, clientId: "test-client" }, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "token_exchange" });
		} finally {
			await idp.close();
		}
	});
});

describe("issuer and discovery hardening", () => {
	it("rejects a non-https issuer in production (no loopback override)", async () => {
		await expect(discoverOAuthEndpoints("http://auth.x.ai")).rejects.toMatchObject({ code: "discovery" });
	});

	it("rejects a https issuer on a non-approved origin", async () => {
		await expect(discoverOAuthEndpoints("https://auth.evil.example")).rejects.toMatchObject({ code: "discovery" });
	});

	it("rejects an issuer string with userinfo", async () => {
		await expect(discoverOAuthEndpoints("https://auth.x.ai@evil.example/")).rejects.toMatchObject({
			code: "discovery",
		});
	});

	it("accepts the approved origin with the loopback override for tests", async () => {
		const idp = await startMockIdP();
		try {
			const document = await discoverOAuthEndpoints(idp.issuer, undefined, {
				allowInsecureLoopbackIssuer: true,
			});
			expect(document.token_endpoint).toBe(`${idp.issuer}/oauth2/token`);
		} finally {
			await idp.close();
		}
	});

	it("rejects discovery when the issuer returns foreign authorization/token endpoints", async () => {
		const rogueIssuer = `https://attacker.example/oauth`;
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/.well-known/openid-configuration") {
				res.writeHead(200, { "content-type": "application/json" }).end(
					JSON.stringify({
						issuer: rogueIssuer,
						authorization_endpoint: `${rogueIssuer}/authorize`,
						token_endpoint: `${rogueIssuer}/token`,
					}),
				);
				return;
			}
			res.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			await expect(
				discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "discovery" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("rejects a discovery document whose issuer identity differs from the configured issuer", async () => {
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/.well-known/openid-configuration") {
				const port = (server.address() as AddressInfo).port;
				res.writeHead(200, { "content-type": "application/json" }).end(
					JSON.stringify({
						issuer: "https://auth.x.ai",
						authorization_endpoint: `http://127.0.0.1:${String(port)}/authorize`,
						token_endpoint: `http://127.0.0.1:${String(port)}/token`,
					}),
				);
				return;
			}
			res.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			await expect(
				discoverOAuthEndpoints(`http://127.0.0.1:${String(port)}`, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "discovery" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("keeps the loopback test override pinned to the exact issuer port", async () => {
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/.well-known/openid-configuration") {
				const port = (server.address() as AddressInfo).port;
				res.writeHead(200, { "content-type": "application/json" }).end(
					JSON.stringify({
						authorization_endpoint: `http://127.0.0.1:${String(port + 1)}/authorize`,
						token_endpoint: `http://127.0.0.1:${String(port + 1)}/token`,
					}),
				);
				return;
			}
			res.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			await expect(
				discoverOAuthEndpoints(`http://127.0.0.1:${String(port)}`, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "discovery" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("rejects discovery when the declared body exceeds 64 KiB", async () => {
		const oversize = "a".repeat(65 * 1024);
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/.well-known/openid-configuration") {
				res
					.writeHead(200, {
						"content-type": "application/json",
						"content-length": String(Buffer.byteLength(oversize, "utf8")),
					})
					.end(oversize);
				return;
			}
			res.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			await expect(
				discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "discovery" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("rejects discovery when the streamed body grows past the 64 KiB cap", async () => {
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/.well-known/openid-configuration") {
				res.writeHead(200, { "content-type": "application/json" });
				res.write(
					'{"issuer":"https://auth.x.ai","authorization_endpoint":"https://auth.x.ai/oauth2/authorize","token_endpoint":"https://auth.x.ai/oauth2/token","pad":"',
				);
				res.write("a".repeat(70 * 1024));
				res.end('"}');
				return;
			}
			res.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			await expect(
				discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
					allowInsecureLoopbackIssuer: true,
				}),
			).rejects.toMatchObject({ code: "discovery" });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});

describe("extractCode hardening", () => {
	it("rejects pathological pasted authorization codes", () => {
		const huge = "a".repeat(2048);
		expect(() => extractCode(huge)).toThrow(GrokBuildOAuthError);
		expect(() => extractCode(`http://127.0.0.1:56121/callback?code=${"x".repeat(2048)}`)).toThrow(GrokBuildOAuthError);
	});

	it("extracts a code up to the ceiling", () => {
		const ok = "a".repeat(1024);
		expect(extractCode(`http://127.0.0.1:56121/callback?code=${ok}`)).toBe(ok);
	});
});

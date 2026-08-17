import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";
import { createPreviewProxy } from "./preview-proxy.mjs";

const token = "A".repeat(43);
let lastUpgradeHeaders;
let upstream;
let proxy;
let upstreamPort;
let proxyPort;

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("expected an IP listener");
	return address.port;
}

async function request(path, headers = {}, method = "GET") {
	return await new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: "127.0.0.1",
				port: proxyPort,
				path,
				method,
				headers,
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
			},
		);
		req.on("error", reject);
		req.end();
	});
}

async function upgrade(headers = {}) {
	return await new Promise((resolve, reject) => {
		const socket = net.connect(proxyPort, "127.0.0.1", () => {
			const values = {
				host: "preview.local:17800",
				upgrade: "websocket",
				connection: "Upgrade",
				"sec-websocket-key": "AAAAAAAAAAAAAAAAAAAAAA==",
				"sec-websocket-version": "13",
				cookie: `dsh_preview=${token}`,
				origin: "http://preview.local:17800",
				"sec-fetch-site": "same-origin",
				...headers,
			};
			const lines = ["GET /api/events.mux HTTP/1.1", ...Object.entries(values).map(([name, value]) => `${name}: ${value}`), "", ""];
			socket.write(lines.join("\r\n"));
		});
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("timed out waiting for upgrade response"));
		}, 5_000);
		socket.once("data", (chunk) => {
			clearTimeout(timer);
			const response = chunk.toString("utf8");
			socket.destroy();
			resolve(response);
		});
		socket.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

before(async () => {
	upstream = http.createServer((req, res) => {
		res.setHeader("content-type", "application/json");
		res.setHeader("connection", "x-response-drop");
		res.setHeader("x-response-drop", "secret");
		res.end(JSON.stringify({ path: req.url, headers: req.headers }));
	});
	upstream.on("upgrade", (req, socket) => {
		lastUpgradeHeaders = req.headers;
		socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
	});
	upstreamPort = await listen(upstream);
	proxy = createPreviewProxy({
		backendHost: "127.0.0.1",
		backendPort: upstreamPort,
		token,
		allowedAuthorities: ["preview.local:17800"],
	});
	proxyPort = await listen(proxy);
});

async function closeServer(server) {
	server.closeAllConnections();
	await Promise.race([
		new Promise((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		}),
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error("timed out closing preview test server")), 2_000);
		}),
	]).catch(() => {
		server.closeAllConnections();
	});
}

after(async () => {
	await Promise.all([closeServer(proxy), closeServer(upstream)]);
});

test("rejects invalid construction inputs", () => {
	assert.throws(
		() =>
			createPreviewProxy({
				backendHost: "127.0.0.1",
				backendPort: upstreamPort,
				token: "short; Path=/",
				allowedAuthorities: ["preview.local:17800"],
			}),
		/base64url/u,
	);
	assert.throws(
		() =>
			createPreviewProxy({
				backendHost: "0.0.0.0",
				backendPort: upstreamPort,
				token,
				allowedAuthorities: ["preview.local:17800"],
			}),
		/loopback/u,
	);
	assert.throws(
		() =>
			createPreviewProxy({
				backendHost: "127.0.0.1",
				backendPort: upstreamPort,
				token,
				allowedAuthorities: ["preview.local"],
			}),
		/explicit port/u,
	);
});

test("rejects unknown authorities and missing tokens", async () => {
	assert.equal((await request("/", { host: "unknown.local:17800" })).status, 403);
	assert.equal((await request("/", { host: "preview.local:17800" })).status, 403);
});

test("exchanges one root query token for a strict HTTP-only cookie", async () => {
	const response = await request(`/?preview_token=${token}&tab=oauth`, {
		host: "preview.local:17800",
		"sec-fetch-site": "cross-site",
	});
	assert.equal(response.status, 302);
	assert.equal(response.headers.location, "/?tab=oauth");
	assert.equal(response.headers["referrer-policy"], "no-referrer");
	assert.match(response.headers["set-cookie"]?.[0] ?? "", new RegExp(`^dsh_preview=${token}; HttpOnly; SameSite=Strict; Path=/$`, "u"));
	assert.equal((await request(`/settings?preview_token=${token}`, { host: "preview.local:17800" })).status, 403);
	assert.equal((await request(`/?preview_token=${token}&preview_token=${token}`, { host: "preview.local:17800" })).status, 403);
});

test("sets Secure on HTTPS-configured preview cookies", async () => {
	const secureProxy = createPreviewProxy({
		backendHost: "127.0.0.1",
		backendPort: upstreamPort,
		token,
		publicProtocol: "https",
		allowedAuthorities: ["secure.local:17800"],
	});
	const port = await listen(secureProxy);
	try {
		const response = await new Promise((resolve, reject) => {
			const req = http.request(
				{ host: "127.0.0.1", port, path: `/?preview_token=${token}`, headers: { host: "secure.local:17800" } },
				(res) => {
					res.resume();
					res.once("end", () => resolve(res));
				},
			);
			req.once("error", reject);
			req.end();
		});
		assert.match(response.headers["set-cookie"]?.[0] ?? "", /; Secure$/u);
	} finally {
		secureProxy.closeAllConnections();
		await new Promise((resolve) => secureProxy.close(resolve));
	}
});

test("rewrites trusted requests and strips proxy and hop-by-hop headers", async () => {
	const response = await request("/api/echo", {
		host: "preview.local:17800",
		origin: "http://preview.local:17800",
		cookie: `dsh_preview=${token}; another=value`,
		"sec-fetch-site": "same-origin",
		connection: "x-request-drop",
		"x-request-drop": "secret",
		forwarded: "for=attacker.invalid",
		"x-forwarded-surprise": "attacker.invalid",
		"x-real-ip": "203.0.113.7",
	});
	assert.equal(response.status, 200);
	const body = JSON.parse(response.body);
	assert.equal(body.path, "/api/echo");
	assert.equal(body.headers.host, `127.0.0.1:${String(upstreamPort)}`);
	assert.equal(body.headers.origin, `http://127.0.0.1:${String(upstreamPort)}`);
	assert.equal(body.headers["sec-fetch-site"], "same-origin");
	for (const name of ["cookie", "forwarded", "x-forwarded-surprise", "x-real-ip", "x-request-drop"]) {
		assert.equal(body.headers[name], undefined);
	}
	assert.equal(response.headers["x-response-drop"], undefined);
});

test("requires exact browser origin on mutations", async () => {
	const common = { host: "preview.local:17800", cookie: `dsh_preview=${token}` };
	assert.equal(
		(await request("/api/echo", { ...common, origin: "http://evil.invalid", "sec-fetch-site": "cross-site" })).status,
		403,
	);
	assert.equal(
		(await request("/api/echo", { ...common, origin: "https://preview.local:17800", "sec-fetch-site": "same-origin" })).status,
		403,
	);
	assert.equal(
		(await request("/api/echo", { ...common, origin: "http://preview.local:17800", "sec-fetch-site": "same-site" })).status,
		403,
	);
	assert.equal((await request("/api/echo", common, "POST")).status, 403);
	assert.equal((await request("/api/echo", common)).status, 200);
});

test("authenticates and validates WebSocket upgrades", async () => {
	lastUpgradeHeaders = undefined;
	assert.match(await upgrade(), /^HTTP\/1\.1 101 Switching Protocols\r\n/u);
	assert.equal(lastUpgradeHeaders?.host, `127.0.0.1:${String(upstreamPort)}`);
	assert.equal(lastUpgradeHeaders?.origin, `http://127.0.0.1:${String(upstreamPort)}`);
	assert.equal(lastUpgradeHeaders?.cookie, undefined);
	assert.equal(lastUpgradeHeaders?.connection?.toLowerCase(), "upgrade");
	assert.equal(lastUpgradeHeaders?.upgrade?.toLowerCase(), "websocket");
	assert.match(await upgrade({ origin: "http://evil.invalid" }), /^HTTP\/1\.1 403 Forbidden\r\n/u);
	assert.match(await upgrade({ origin: "" }), /^HTTP\/1\.1 403 Forbidden\r\n/u);
	assert.match(await upgrade({ "sec-websocket-key": "invalid" }), /^HTTP\/1\.1 400 Bad Request\r\n/u);
});

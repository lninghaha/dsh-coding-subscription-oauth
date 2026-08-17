import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";

const TOKEN_QUERY = "preview_token";
const TOKEN_COOKIE = "dsh_preview";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SAFE_METHODS_WITHOUT_ORIGIN = new Set(["GET", "HEAD"]);
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

function equalSecret(left, right) {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(header, name) {
	if (typeof header !== "string") return undefined;
	for (const part of header.split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=");
	}
	return undefined;
}

function requestAuthority(req) {
	const value = req.headers.host;
	return typeof value === "string" ? value.toLowerCase() : undefined;
}

function isAllowedAuthority(authority, allowedAuthorities) {
	return authority !== undefined && allowedAuthorities.has(authority);
}

function originMatches(origin, authority, publicProtocol) {
	if (typeof origin !== "string" || authority === undefined) return false;
	try {
		const parsed = new URL(origin);
		return parsed.origin === `${publicProtocol}://${authority}`;
	} catch {
		return false;
	}
}

function hasTrustedBrowserMarkers(req, authority, publicProtocol, requireOrigin = false) {
	const fetchSite = req.headers["sec-fetch-site"];
	if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") return false;
	const origin = req.headers.origin;
	if (origin !== undefined) return originMatches(origin, authority, publicProtocol);
	return !requireOrigin && SAFE_METHODS_WITHOUT_ORIGIN.has(req.method ?? "");
}

function tokenFromRequest(req) {
	return cookieValue(req.headers.cookie, TOKEN_COOKIE);
}

function authenticateByQuery(req, token) {
	if (req.method !== "GET" || req.url === undefined) return undefined;
	const url = new URL(req.url, "http://preview.invalid");
	if (url.pathname !== "/") return undefined;
	const candidates = url.searchParams.getAll(TOKEN_QUERY);
	if (candidates.length !== 1 || !equalSecret(candidates[0], token)) return undefined;
	url.searchParams.delete(TOKEN_QUERY);
	return `${url.pathname}${url.search}`;
}

function securityHeaders() {
	return {
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
	};
}

function writeForbidden(res) {
	res.writeHead(403, {
		...securityHeaders(),
		"content-type": "text/plain; charset=utf-8",
	});
	res.end("forbidden\n");
}

function headerTokens(value) {
	const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return values.flatMap((item) => item.split(",")).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function withoutHopByHopHeaders(input) {
	const headers = { ...input };
	for (const name of headerTokens(headers.connection)) delete headers[name];
	for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
	return headers;
}

function forwardedHeaders(req, backendAuthority) {
	const headers = withoutHopByHopHeaders(req.headers);
	delete headers.cookie;
	delete headers.forwarded;
	delete headers["x-real-ip"];
	for (const name of Object.keys(headers)) {
		if (name.startsWith("x-forwarded-")) delete headers[name];
	}
	headers.host = backendAuthority;
	if (headers.origin !== undefined) headers.origin = `http://${backendAuthority}`;
	headers["sec-fetch-site"] = "same-origin";
	return headers;
}

function proxyHttp(req, res, options) {
	const authority = requestAuthority(req);
	if (!isAllowedAuthority(authority, options.allowedAuthorities)) {
		writeForbidden(res);
		return;
	}
	const redirect = authenticateByQuery(req, options.token);
	if (redirect !== undefined) {
		const secure = options.publicProtocol === "https" ? "; Secure" : "";
		res.writeHead(302, {
			...securityHeaders(),
			location: redirect,
			"set-cookie": `${TOKEN_COOKIE}=${options.token}; HttpOnly; SameSite=Strict; Path=/${secure}`,
		});
		res.end();
		return;
	}
	if (!hasTrustedBrowserMarkers(req, authority, options.publicProtocol)) {
		writeForbidden(res);
		return;
	}
	const cookie = tokenFromRequest(req);
	if (cookie === undefined || !equalSecret(cookie, options.token)) {
		writeForbidden(res);
		return;
	}
	const upstream = http.request(
		{
			host: options.backendHost,
			port: options.backendPort,
			method: req.method,
			path: req.url,
			headers: forwardedHeaders(req, options.backendAuthority),
		},
		(upstreamResponse) => {
			res.writeHead(upstreamResponse.statusCode ?? 502, withoutHopByHopHeaders(upstreamResponse.headers));
			upstreamResponse.pipe(res);
		},
	);
	upstream.on("error", () => {
		if (!res.headersSent) res.writeHead(502, { ...securityHeaders(), "content-type": "text/plain; charset=utf-8" });
		res.end("preview backend unavailable\n");
	});
	req.on("aborted", () => upstream.destroy());
	res.on("close", () => {
		if (!res.writableEnded) upstream.destroy();
	});
	req.pipe(upstream);
}

function validWebSocketUpgrade(req) {
	if (req.method !== "GET") return false;
	if (typeof req.headers.upgrade !== "string" || req.headers.upgrade.toLowerCase() !== "websocket") return false;
	if (!headerTokens(req.headers.connection).includes("upgrade")) return false;
	if (req.headers["sec-websocket-version"] !== "13") return false;
	const key = req.headers["sec-websocket-key"];
	if (typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/u.test(key)) return false;
	return Buffer.from(key, "base64").length === 16;
}

function rejectUpgrade(socket, status, reason) {
	socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function proxyUpgrade(req, socket, head, options) {
	const authority = requestAuthority(req);
	const cookie = tokenFromRequest(req);
	if (
		!isAllowedAuthority(authority, options.allowedAuthorities) ||
		!hasTrustedBrowserMarkers(req, authority, options.publicProtocol, true) ||
		cookie === undefined ||
		!equalSecret(cookie, options.token)
	) {
		rejectUpgrade(socket, 403, "Forbidden");
		return;
	}
	if (!validWebSocketUpgrade(req)) {
		rejectUpgrade(socket, 400, "Bad Request");
		return;
	}
	let connected = false;
	const upstream = net.connect(options.backendPort, options.backendHost, () => {
		connected = true;
		upstream.setTimeout(0);
		const headers = forwardedHeaders(req, options.backendAuthority);
		headers.connection = "Upgrade";
		headers.upgrade = "websocket";
		const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
		for (const [name, value] of Object.entries(headers)) {
			if (value === undefined) continue;
			if (Array.isArray(value)) {
				for (const item of value) lines.push(`${name}: ${item}`);
			} else {
				lines.push(`${name}: ${value}`);
			}
		}
		upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
		if (head.length > 0) upstream.write(head);
		socket.pipe(upstream).pipe(socket);
	});
	upstream.setTimeout(5_000, () => upstream.destroy());
	upstream.on("error", () => {
		if (!connected && socket.writable) rejectUpgrade(socket, 502, "Bad Gateway");
		else socket.destroy();
	});
	upstream.on("close", () => socket.destroy());
	socket.on("error", () => upstream.destroy());
	socket.on("close", () => upstream.destroy());
}

function normalizedAuthority(value, publicProtocol) {
	if (typeof value !== "string" || value === "") throw new Error("preview authorities must be non-empty strings");
	const parsed = new URL(`${publicProtocol}://${value}`);
	if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
		throw new Error(`invalid preview authority: ${value}`);
	}
	if (parsed.port === "") throw new Error(`preview authority must include an explicit port: ${value}`);
	return parsed.host.toLowerCase();
}

export function createPreviewProxy(options) {
	if (!TOKEN_PATTERN.test(options.token)) throw new Error("preview token must be exactly 32 base64url-encoded bytes");
	if (options.backendHost !== "127.0.0.1") throw new Error("preview backend must remain on IPv4 loopback");
	if (!Number.isSafeInteger(options.backendPort) || options.backendPort < 1024 || options.backendPort > 65_535) {
		throw new Error("preview backend port must be between 1024 and 65535");
	}
	const publicProtocol = options.publicProtocol ?? "http";
	if (publicProtocol !== "http" && publicProtocol !== "https") throw new Error("preview public protocol must be http or https");
	if (!Array.isArray(options.allowedAuthorities) || options.allowedAuthorities.length === 0) {
		throw new Error("preview requires at least one allowed authority");
	}
	const backendAuthority = `${options.backendHost}:${String(options.backendPort)}`;
	const normalized = {
		...options,
		backendAuthority,
		publicProtocol,
		allowedAuthorities: new Set(options.allowedAuthorities.map((value) => normalizedAuthority(value, publicProtocol))),
	};
	const server = http.createServer((req, res) => proxyHttp(req, res, normalized));
	server.maxHeadersCount = 100;
	server.headersTimeout = 10_000;
	server.on("upgrade", (req, socket, head) => proxyUpgrade(req, socket, head, normalized));
	return server;
}

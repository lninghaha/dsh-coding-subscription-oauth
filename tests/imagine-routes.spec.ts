import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	IMAGINE_IMAGE_ROUTE_PREFIX,
	type ImagineImageAttachmentRef,
	imagineImagePath,
	parseImagineImagePath,
} from "../src/grok-imagine.ts";
import {
	IMAGINE_IMAGE_ROUTE_TTL_MS,
	IMAGINE_ROUTE_MAX_ENTRIES,
	type ImagineMediaDownloadStore,
	type ImagineRouteAttachmentStore,
	registerImagineRoutes,
} from "../src/imagine-routes.ts";
import {
	IMAGINE_MEDIA_ROUTE_PREFIX,
	imagineMediaPath,
	type MediaArtifactMeta,
	type MediaDownloadView,
	MediaStoreError,
	parseImagineMediaPath,
	type TrustedImagineAuthz,
} from "../src/media-store.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const VIDEO = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const SECRET_PATH = "/home/lning/.secrets/imagine-internal.png";
const SECRET_TOKEN = "Bearer super-secret-token";

interface RegisteredRoute {
	kind: "exact" | "prefix";
	path: string;
	handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

class TestResponse {
	status = 0;
	headers: Record<string, string> = {};
	chunks: Buffer[] = [];
	headersSent = false;

	writeHead(status: number, headers?: Record<string, string>): this {
		this.status = status;
		this.headersSent = true;
		this.headers = {};
		for (const [key, value] of Object.entries(headers ?? {})) {
			this.headers[key.toLowerCase()] = value;
		}
		return this;
	}

	end(value?: string | Buffer | Uint8Array): this {
		if (value !== undefined) {
			this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
		}
		return this;
	}

	get body(): Buffer {
		return Buffer.concat(this.chunks);
	}

	get text(): string {
		return this.body.toString("utf8");
	}
}

class FakeAttachments implements ImagineRouteAttachmentStore {
	readonly imageLimits: { maxImageBytes: number };
	readonly stored = new Map<string, { ref: ImagineImageAttachmentRef; data: Uint8Array }>();
	reads: ImagineImageAttachmentRef[] = [];
	error: unknown;
	mismatchId: string | undefined;
	oversized = false;
	pending: Promise<void> | undefined;
	releasePending: (() => void) | undefined;

	constructor(maxImageBytes = 1024) {
		this.imageLimits = { maxImageBytes };
	}

	hold(): void {
		this.pending = new Promise<void>((resolve) => {
			this.releasePending = resolve;
		});
	}

	release(): void {
		this.releasePending?.();
		this.releasePending = undefined;
		this.pending = undefined;
	}

	async readImage(ref: ImagineImageAttachmentRef): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }> {
		this.reads.push({ ...ref });
		if (this.pending !== undefined) await this.pending;
		if (this.error !== undefined) throw this.error;
		const stored = this.stored.get(ref.attachmentId);
		const data = this.oversized ? new Uint8Array(this.imageLimits.maxImageBytes + 1) : (stored?.data ?? PNG);
		return {
			ref: {
				...ref,
				attachmentId: this.mismatchId ?? ref.attachmentId,
				bytes: data.byteLength,
			},
			data,
		};
	}
}

class FakeMedia implements ImagineMediaDownloadStore {
	readonly stored = new Map<string, MediaDownloadView>();
	reads: Array<{ artifactId: string; authz: TrustedImagineAuthz }> = [];
	error: unknown;
	pending: Promise<void> | undefined;
	releasePending: (() => void) | undefined;
	extraHeaders: Record<string, string> = {};

	hold(): void {
		this.pending = new Promise<void>((resolve) => {
			this.releasePending = resolve;
		});
	}

	release(): void {
		this.releasePending?.();
		this.releasePending = undefined;
		this.pending = undefined;
	}

	async readForDownload(artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView> {
		this.reads.push({ artifactId, authz });
		if (this.pending !== undefined) await this.pending;
		if (this.error !== undefined) throw this.error;
		const stored = this.stored.get(artifactId);
		if (stored === undefined) throw new MediaStoreError("NOT_FOUND", "missing");
		return {
			...stored,
			headers: { ...stored.headers, ...this.extraHeaders },
		};
	}
}

function imageRef(id: string, overrides: Partial<ImagineImageAttachmentRef> = {}): ImagineImageAttachmentRef {
	return {
		attachmentId: id,
		mediaType: "image/png",
		bytes: PNG.byteLength,
		width: 2,
		height: 2,
		...overrides,
	};
}

function artifact(id: string, overrides: Partial<MediaArtifactMeta> = {}): MediaArtifactMeta {
	const createdAt = Date.now();
	return {
		artifactId: id,
		mediaType: "video/mp4",
		bytes: VIDEO.byteLength,
		createdAt,
		expiresAt: createdAt + 60_000,
		...overrides,
	};
}

function hexId(value: number): string {
	return value.toString(16).padStart(32, "0");
}

function request(
	method: string,
	headers: IncomingMessage["headers"] = {},
	remoteAddress = "127.0.0.1",
	url = "/",
): IncomingMessage {
	const stream = Readable.from([]) as unknown as IncomingMessage;
	Object.defineProperties(stream, {
		method: { value: method, configurable: true },
		url: { value: url, configurable: true },
		headers: {
			value: { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080", ...headers },
			configurable: true,
		},
		socket: { value: { remoteAddress }, configurable: true },
	});
	return stream;
}

function createHarness(options: { now?: () => number; effect?: boolean; maxEntries?: number; failAt?: number } = {}): {
	routes: Map<string, RegisteredRoute>;
	attachments: FakeAttachments;
	media: FakeMedia;
	registry: ReturnType<typeof registerImagineRoutes>;
	effects: Array<() => void | Promise<void>>;
} {
	const routes = new Map<string, RegisteredRoute>();
	const attachments = new FakeAttachments();
	const media = new FakeMedia();
	const effects: Array<() => void | Promise<void>> = [];
	let registrations = 0;
	const registry = registerImagineRoutes(
		{
			webServer: {
				register(route) {
					registrations += 1;
					if (options.failAt !== undefined && registrations === options.failAt) {
						throw new Error(`registration ${String(registrations)} failed`);
					}
					const recorded: RegisteredRoute = {
						kind: route.kind,
						path: route.path,
						handler: route.handler,
					};
					routes.set(route.path, recorded);
					return () => {
						routes.delete(route.path);
					};
				},
			},
			...(options.effect === true
				? {
						effect(setup: () => () => void | Promise<void>) {
							effects.push(setup());
						},
					}
				: {}),
		},
		{
			attachments,
			media,
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
		},
	);
	return { routes, attachments, media, registry, effects };
}

async function invoke(
	route: RegisteredRoute | undefined,
	req: IncomingMessage,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer; text: string; json: unknown }> {
	if (route === undefined) throw new Error("route was not registered");
	const response = new TestResponse();
	await route.handler(req, response as unknown as ServerResponse);
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.text);
	} catch {
		parsed = undefined;
	}
	return { status: response.status, headers: response.headers, body: response.body, text: response.text, json: parsed };
}

describe("imagine exact download routes", () => {
	it("registers one exact image path per remembered opaque id", async () => {
		const { routes, attachments, registry } = createHarness();
		const ref = imageRef("img_local");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([
			{ ...ref, url: "https://imgen.x.ai/signed", fsPath: SECRET_PATH } as ImagineImageAttachmentRef & {
				url: string;
				fsPath: string;
			},
		]);
		const path = imagineImagePath(ref.attachmentId);
		expect(parseImagineImagePath(path)).toBe(ref.attachmentId);
		expect(routes.get(path)?.kind).toBe("exact");
		expect([...routes.keys()]).toEqual([path]);
		expect(routes.has(`${IMAGINE_IMAGE_ROUTE_PREFIX}`)).toBe(false);
		expect(routes.has(`${path}/extra`)).toBe(false);

		const response = await invoke(routes.get(path), request("GET"));
		expect(response.status).toBe(200);
		expect(response.body.equals(Buffer.from(PNG))).toBe(true);
		expect(response.headers["content-type"]).toBe("image/png");
		expect(response.headers["content-length"]).toBe(String(PNG.byteLength));
		expect(response.headers["cache-control"]).toMatch(/private/u);
		expect(response.headers["cache-control"]).toMatch(/no-store/u);
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(response.text).not.toContain(SECRET_PATH);
		expect(JSON.stringify(attachments.reads[0])).not.toContain("https://imgen.x.ai/signed");
	});

	it("registers one exact media path and copies only safe headers", async () => {
		const { routes, media, registry } = createHarness();
		const meta = artifact(hexId(1));
		media.stored.set(meta.artifactId, {
			meta,
			body: VIDEO,
			headers: {
				"Content-Type": "video/mp4",
				"Content-Length": String(VIDEO.byteLength),
				"Content-Disposition": `attachment; filename="imagine-${meta.artifactId}.mp4"`,
				"Cache-Control": "private, max-age=0, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
		media.extraHeaders = {
			"Set-Cookie": "session=abc",
			Location: "https://videogen.x.ai/raw",
			Authorization: SECRET_TOKEN,
		};
		registry.rememberArtifact(meta);
		const path = imagineMediaPath(meta.artifactId);
		expect(parseImagineMediaPath(path)).toBe(meta.artifactId);
		expect(routes.get(path)?.kind).toBe("exact");
		expect(path.startsWith(IMAGINE_MEDIA_ROUTE_PREFIX)).toBe(true);

		const response = await invoke(routes.get(path), request("GET"));
		expect(response.status).toBe(200);
		expect(response.body.equals(Buffer.from(VIDEO))).toBe(true);
		expect(response.headers["content-type"]).toBe("video/mp4");
		expect(response.headers["content-length"]).toBe(String(VIDEO.byteLength));
		expect(response.headers["cache-control"]).toMatch(/no-store/u);
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(response.headers["set-cookie"]).toBeUndefined();
		expect(response.headers.location).toBeUndefined();
		expect(response.headers.authorization).toBeUndefined();
		expect(response.text).not.toContain(SECRET_TOKEN);
		expect(media.reads).toHaveLength(1);
		expect(media.reads[0]?.artifactId).toBe(meta.artifactId);
	});

	it("rejects non-GET methods with 405", async () => {
		const { routes, attachments, registry } = createHarness();
		const ref = imageRef("img_method");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([ref]);
		const response = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request("POST"));
		expect(response.status).toBe(405);
		expect(response.json).toEqual({ error: "method not allowed" });
		expect(attachments.reads).toHaveLength(0);
	});

	it("authorizes only same-origin loopback and ignores bearer query or cookies", async () => {
		const { routes, attachments, media, registry } = createHarness();
		const ref = imageRef("img_auth");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([ref]);
		const handler = routes.get(imagineImagePath(ref.attachmentId));

		const denied = [
			await invoke(handler, request("GET", {}, "10.0.0.2")),
			await invoke(handler, request("GET", { host: undefined })),
			await invoke(handler, request("GET", { "sec-fetch-site": "cross-site" })),
			await invoke(handler, request("GET", { origin: "http://evil.example" })),
			await invoke(
				handler,
				request("GET", { cookie: "authorization=Bearer leaked" }, "8.8.8.8", "/x?access_token=leaked"),
			),
		];
		for (const response of denied) {
			expect(response.status).toBe(403);
			expect(response.json).toEqual({ error: "forbidden" });
			expect(response.text).not.toMatch(/Bearer|leaked|access_token/u);
		}
		expect(attachments.reads).toHaveLength(0);
		expect(media.reads).toHaveLength(0);

		const allowed = await invoke(
			handler,
			request("GET", { cookie: "session=1" }, "127.0.0.1", `${imagineImagePath(ref.attachmentId)}?access_token=ignore`),
		);
		expect(allowed.status).toBe(200);
		expect(allowed.body.equals(Buffer.from(PNG))).toBe(true);

		const mapped = await invoke(handler, request("GET", {}, "::ffff:127.0.0.1"));
		expect(mapped.status).toBe(200);
		const v6 = await invoke(handler, request("GET", {}, "::1"));
		expect(v6.status).toBe(200);
	});

	it("does not call media download until the route is authorized", async () => {
		const { routes, media, registry } = createHarness();
		const meta = artifact(hexId(2));
		media.stored.set(meta.artifactId, {
			meta,
			body: VIDEO,
			headers: {
				"Content-Type": "video/mp4",
				"Content-Length": String(VIDEO.byteLength),
				"Content-Disposition": `attachment; filename="imagine-${meta.artifactId}.mp4"`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
		registry.rememberArtifact(meta);
		const handler = routes.get(imagineMediaPath(meta.artifactId));
		await invoke(handler, request("GET", {}, "192.168.1.9"));
		expect(media.reads).toHaveLength(0);
		const allowed = await invoke(handler, request("GET"));
		expect(allowed.status).toBe(200);
		expect(media.reads).toHaveLength(1);
	});

	it("does not register traversal or multi-segment ids", () => {
		const { routes, registry } = createHarness();
		registry.rememberImages([imageRef("../etc/passwd"), imageRef("a/b"), imageRef("..")]);
		registry.rememberArtifact(artifact("../not-an-id"));
		expect(routes.size).toBe(0);
		expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}../etc/passwd`)).toBeUndefined();
		expect(parseImagineMediaPath(`${IMAGINE_MEDIA_ROUTE_PREFIX}../x`)).toBeUndefined();
	});

	it("expires image routes within one hour and deletes the handler", async () => {
		let clock = 10_000;
		const { routes, attachments, registry } = createHarness({ now: () => clock });
		const ref = imageRef("img_ttl");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([ref]);
		const path = imagineImagePath(ref.attachmentId);
		expect(await invoke(routes.get(path), request("GET"))).toMatchObject({ status: 200 });
		clock += IMAGINE_IMAGE_ROUTE_TTL_MS + 1;
		const expired = await invoke(routes.get(path), request("GET"));
		expect(expired.status).toBe(404);
		expect(expired.json).toEqual({ error: "not found" });
		expect(routes.has(path)).toBe(false);
	});

	it("cannot keep a media route alive past artifact expiresAt", async () => {
		let clock = 5_000;
		const { routes, media, registry } = createHarness({ now: () => clock });
		const meta = artifact(hexId(3), { createdAt: 1_000, expiresAt: 8_000 });
		media.stored.set(meta.artifactId, {
			meta,
			body: VIDEO,
			headers: {
				"Content-Type": "video/mp4",
				"Content-Length": String(VIDEO.byteLength),
				"Content-Disposition": `attachment; filename="imagine-${meta.artifactId}.mp4"`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
		registry.rememberArtifact(meta);
		const path = imagineMediaPath(meta.artifactId);
		expect((await invoke(routes.get(path), request("GET"))).status).toBe(200);
		clock = 8_000;
		const expired = await invoke(routes.get(path), request("GET"));
		expect(expired.status).toBe(404);
		expect(routes.has(path)).toBe(false);
		registry.rememberArtifact(artifact(hexId(4), { createdAt: 1_000, expiresAt: 7_000 }));
		expect(routes.has(imagineMediaPath(hexId(4)))).toBe(false);
	});

	it("evicts the oldest exact handler once capacity is reached", async () => {
		const { routes, attachments, registry } = createHarness();
		for (let index = 0; index < IMAGINE_ROUTE_MAX_ENTRIES + 1; index += 1) {
			const ref = imageRef(`img_${String(index)}`);
			attachments.stored.set(ref.attachmentId, { ref, data: PNG });
			registry.rememberImages([ref]);
		}
		expect(routes.size).toBe(IMAGINE_ROUTE_MAX_ENTRIES);
		expect(routes.has(imagineImagePath("img_0"))).toBe(false);
		expect(routes.has(imagineImagePath(`img_${String(IMAGINE_ROUTE_MAX_ENTRIES)}`))).toBe(true);
		const kept = await invoke(routes.get(imagineImagePath(`img_${String(IMAGINE_ROUTE_MAX_ENTRIES)}`)), request("GET"));
		expect(kept.status).toBe(200);
	});

	it("refreshing an existing id does not consume another slot", () => {
		const { routes, registry } = createHarness();
		const first = imageRef("img_refresh");
		registry.rememberImages([first, imageRef("img_other")]);
		registry.rememberImages([imageRef("img_refresh", { name: "again" })]);
		expect(routes.size).toBe(2);
		expect(routes.has(imagineImagePath("img_refresh"))).toBe(true);
	});

	it("owns route disposal and is idempotent", async () => {
		const { routes, attachments, registry } = createHarness();
		const ref = imageRef("img_dispose");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([ref]);
		const path = imagineImagePath(ref.attachmentId);
		const handler = routes.get(path);
		registry.dispose();
		registry.dispose();
		expect(routes.size).toBe(0);
		registry.rememberImages([ref]);
		expect(routes.size).toBe(0);
		expect((await invoke(handler, request("GET"))).status).toBe(404);
	});

	it("lets ctx.effect own the combined disposer", () => {
		const { routes, registry, effects } = createHarness({ effect: true });
		registry.rememberImages([imageRef("img_effect")]);
		expect(routes.size).toBe(1);
		expect(effects).toHaveLength(1);
		effects[0]?.();
		expect(routes.size).toBe(0);
	});

	it("keeps the first remembered image owned after a later register throws", () => {
		const { routes, registry } = createHarness({ failAt: 2 });
		const first = imageRef("img_keep");
		const second = imageRef("img_fail");
		expect(() => registry.rememberImages([first, second])).toThrow("registration 2 failed");
		expect(routes.has(imagineImagePath(first.attachmentId))).toBe(true);
		expect(routes.has(imagineImagePath(second.attachmentId))).toBe(false);
		registry.dispose();
		expect(routes.size).toBe(0);
	});

	it("returns 404 when the stored image identity or byte ceiling fails", async () => {
		const { routes, attachments, registry } = createHarness();
		const ref = imageRef("img_check", { bytes: 8 });
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		registry.rememberImages([ref]);
		const handler = routes.get(imagineImagePath(ref.attachmentId));

		attachments.mismatchId = "img_other";
		expect((await invoke(handler, request("GET"))).status).toBe(404);
		attachments.mismatchId = undefined;
		attachments.oversized = true;
		expect((await invoke(handler, request("GET"))).status).toBe(404);
		attachments.oversized = false;
		expect((await invoke(handler, request("GET"))).status).toBe(200);
		registry.rememberImages([imageRef("img_too_big", { bytes: 4096 })]);
		expect(routes.has(imagineImagePath("img_too_big"))).toBe(false);
	});

	it("redacts internal paths and tokens from download errors", async () => {
		const { routes, attachments, media, registry } = createHarness();
		const ref = imageRef("img_err");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		attachments.error = new Error(`ENOENT ${SECRET_PATH} ${SECRET_TOKEN}`);
		registry.rememberImages([ref]);
		const failed = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request("GET"));
		expect(failed.status).toBe(500);
		expect(failed.json).toEqual({ error: "download failed" });
		expect(failed.text).not.toContain(SECRET_PATH);
		expect(failed.text).not.toContain("ENOENT");
		expect(failed.text).not.toContain("super-secret-token");

		const meta = artifact(hexId(5));
		media.error = new MediaStoreError("NOT_FOUND", `missing ${SECRET_PATH}`);
		registry.rememberArtifact(meta);
		const missing = await invoke(routes.get(imagineMediaPath(meta.artifactId)), request("GET"));
		expect(missing.status).toBe(404);
		expect(missing.json).toEqual({ error: "not found" });
		expect(missing.text).not.toContain(SECRET_PATH);
	});

	it("does not let a stale handler delete a replacement route for the same id", async () => {
		const { routes, attachments, registry } = createHarness({ maxEntries: 1 });
		const first = imageRef("img_reused");
		const other = imageRef("img_other");
		attachments.stored.set(first.attachmentId, { ref: first, data: PNG });
		attachments.stored.set(other.attachmentId, { ref: other, data: PNG });
		registry.rememberImages([first]);
		const path = imagineImagePath(first.attachmentId);
		const stale = routes.get(path);
		registry.rememberImages([other]);
		registry.rememberImages([first]);
		const replacement = routes.get(path);
		expect(replacement).not.toBe(stale);
		expect((await invoke(stale, request("GET"))).status).toBe(404);
		expect(routes.get(path)).toBe(replacement);
		expect((await invoke(replacement, request("GET"))).status).toBe(200);
	});

	it("does not finish a 200 after disposal races the in-flight read", async () => {
		const { routes, attachments, registry } = createHarness();
		const ref = imageRef("img_race");
		attachments.stored.set(ref.attachmentId, { ref, data: PNG });
		attachments.hold();
		registry.rememberImages([ref]);
		const pending = invoke(routes.get(imagineImagePath(ref.attachmentId)), request("GET"));
		registry.dispose();
		attachments.release();
		const response = await pending;
		expect(response.status).toBe(404);
		expect(response.json).toEqual({ error: "not found" });
	});
});

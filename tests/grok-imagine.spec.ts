import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertSafeRemoteMediaUrl,
	createGrokImagineClient,
	createImagineDownloaderFromFetch,
	detectImageMediaType,
	detectVideoMediaType,
	GROK_IMAGINE_IMAGE_MODEL,
	GROK_IMAGINE_IMAGE_PATH,
	GROK_IMAGINE_VIDEO_MODEL,
	GROK_IMAGINE_VIDEO_START_PATH,
	type GrokImagineClient,
	GrokImagineError,
	grokImagineVideoStatusPath,
	IMAGINE_IMAGE_IDS_MAX,
	IMAGINE_IMAGE_IDS_MIN,
	IMAGINE_PROMPT_MAX_LENGTH,
	type ImagineAttachmentStore,
	type ImagineFetch,
	type ImagineImageAttachmentRef,
	type ImagineOperation,
	imagineImageDownloadHeaders,
	imagineImagePath,
	isAllowlistedImagineHost,
	isBlockedIp,
	isSafeImagineAttachmentId,
	openTrustedImagineImageDownload,
	parseImagineImagePath,
	parseVideoRequestId,
	XAI_API_ORIGIN,
	XAI_OUTPUT_HOSTS,
} from "../src/grok-imagine.ts";
import { createTrustedImagineAuthz, imagineMediaPath, MediaStore } from "../src/media-store.ts";

const PNG = Uint8Array.from(
	Buffer.from(
		"89504e470d0a1a0a0000000d4948445200000001000000010802" +
			"000000907753de0000000c4944415408d763f8cfc00000000300" +
			"010005fed4ef0000000049454e44ae426082",
		"hex",
	),
);
const MP4 = Uint8Array.from(Buffer.from("000000186674797069736f6d0000000069736f6d69736f32", "hex"));
const WEBM = Uint8Array.from(Buffer.from("1a45dfa3", "hex"));

const PUBLIC_IP = "8.8.8.8";
const IMAGE_URL = "https://imgen.x.ai/generated/cat.png";
const IMAGE_URL_FINAL = "https://imgen.x.ai/generated/final.png";
const VIDEO_URL = "https://videogen.x.ai/generated/clip.mp4";
const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
	vi.stubGlobal("fetch", async () => {
		throw new Error("real network is forbidden in Grok Imagine tests");
	});
});

class MemoryAttachments implements ImagineAttachmentStore {
	readonly saved: Array<{ data: Uint8Array; mediaType: string; name?: string }> = [];
	readonly imageLimits = {
		maxImageBytes: 64 * 1024,
		mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
	};

	async saveImage(input: {
		data: Uint8Array;
		mediaType: ImagineImageAttachmentRef["mediaType"];
		name?: string;
	}): Promise<ImagineImageAttachmentRef> {
		this.saved.push(input);
		const ref: ImagineImageAttachmentRef = {
			attachmentId: `att_${"ab".repeat(16)}`,
			mediaType: input.mediaType,
			bytes: input.data.byteLength,
			width: 1,
			height: 1,
		};
		if (input.name !== undefined) ref.name = input.name;
		return ref;
	}

	async readImage(ref: ImagineImageAttachmentRef): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }> {
		return { ref, data: PNG };
	}
}

interface RecordedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

function headerMap(init?: RequestInit): Record<string, string> {
	const headers = new Headers(init?.headers);
	const mapped: Record<string, string> = {};
	headers.forEach((value, key) => {
		mapped[key.toLowerCase()] = value;
	});
	return mapped;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function bytesResponse(
	data: Uint8Array,
	contentType: string,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(Uint8Array.from(data).buffer, {
		status,
		headers: { "content-type": contentType, ...headers },
	});
}

async function tempMedia(maxBytes = 1024): Promise<MediaStore> {
	const dir = await mkdtemp(join(tmpdir(), "dsh-imagine-media-"));
	temporaryDirectories.push(dir);
	return new MediaStore(dir, { maxBytes });
}

function resolver(key = "xai-test-key"): {
	resolve: (operation: ImagineOperation) => Promise<string>;
	calls: ImagineOperation[];
} {
	const calls: ImagineOperation[] = [];
	return {
		calls,
		resolve: async (operation) => {
			calls.push(operation);
			return key;
		},
	};
}

function defaultLookup(hostname: string): Promise<readonly string[]> {
	return Promise.resolve(hostname.endsWith(".x.ai") ? [PUBLIC_IP] : []);
}

async function createHarness(options: {
	fetch: ImagineFetch;
	lookup?: (hostname: string) => Promise<readonly string[]>;
	key?: string;
	attachments?: MemoryAttachments;
	media?: MediaStore;
	imageMaxBytes?: number;
	apiJsonMaxBytes?: number;
}): Promise<{
	client: GrokImagineClient;
	attachments: MemoryAttachments;
	auth: ReturnType<typeof resolver>;
	media: MediaStore;
	record: RecordedRequest[];
}> {
	const attachments = options.attachments ?? new MemoryAttachments();
	const media = options.media ?? (await tempMedia());
	const auth = resolver(options.key);
	const lookup = options.lookup ?? defaultLookup;
	const client = createGrokImagineClient({
		resolveApiKey: auth.resolve,
		attachments,
		media,
		fetch: options.fetch,
		downloader: createImagineDownloaderFromFetch(options.fetch, {
			trustedTestTransport: true,
			lookup,
		}),
		...(options.imageMaxBytes === undefined ? {} : { imageMaxBytes: options.imageMaxBytes }),
		...(options.apiJsonMaxBytes === undefined ? {} : { apiJsonMaxBytes: options.apiJsonMaxBytes }),
	});
	return { client, attachments, auth, media, record: [] };
}

function scriptedFetch(script: {
	onApi?: (request: RecordedRequest) => Response | Promise<Response>;
	onMedia?: (request: RecordedRequest) => Response | Promise<Response>;
	record?: RecordedRequest[];
}): ImagineFetch {
	const record = script.record ?? [];
	return async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input.href);
		const request: RecordedRequest = {
			url: url.href,
			method: (init?.method ?? "GET").toUpperCase(),
			headers: headerMap(init),
			body: typeof init?.body === "string" ? init.body : undefined,
		};
		record.push(request);
		if (url.origin === XAI_API_ORIGIN) {
			if (script.onApi === undefined) throw new Error(`unexpected API fetch ${url.href}`);
			return script.onApi(request);
		}
		if (script.onMedia === undefined) throw new Error(`unexpected media fetch ${url.href}`);
		return script.onMedia(request);
	};
}

describe("Grok Imagine protocol constants", () => {
	it("targets official api.x.ai endpoints and pinned models", () => {
		expect(XAI_API_ORIGIN).toBe("https://api.x.ai");
		expect(GROK_IMAGINE_IMAGE_PATH).toBe("/v1/images/generations");
		expect(GROK_IMAGINE_VIDEO_START_PATH).toBe("/v1/videos/generations");
		expect(GROK_IMAGINE_IMAGE_MODEL).toBe("grok-imagine-image-2.0");
		expect(GROK_IMAGINE_VIDEO_MODEL).toBe("grok-imagine-video-1.5");
		expect(grokImagineVideoStatusPath("req_123")).toBe("/v1/videos/req_123");
		expect(() => grokImagineVideoStatusPath("../secret")).toThrow(GrokImagineError);
	});
});

describe("SSRF primitives", () => {
	it("blocks localhost, private, reserved, documentation, and embedded special forms", () => {
		expect(isBlockedIp("127.0.0.1")).toBe(true);
		expect(isBlockedIp("10.1.2.3")).toBe(true);
		expect(isBlockedIp("192.168.0.5")).toBe(true);
		expect(isBlockedIp("172.16.9.1")).toBe(true);
		expect(isBlockedIp("169.254.169.254")).toBe(true);
		expect(isBlockedIp("100.64.1.1")).toBe(true);
		expect(isBlockedIp("192.0.0.170")).toBe(true);
		expect(isBlockedIp("192.0.2.1")).toBe(true);
		expect(isBlockedIp("198.51.100.1")).toBe(true);
		expect(isBlockedIp("203.0.113.10")).toBe(true);
		expect(isBlockedIp("::1")).toBe(true);
		expect(isBlockedIp("fc00::1")).toBe(true);
		expect(isBlockedIp("fe80::1")).toBe(true);
		expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
		expect(isBlockedIp("::ffff:c0a8:0001")).toBe(true);
		expect(isBlockedIp("::192.168.0.1")).toBe(true);
		expect(isBlockedIp("64:ff9b::192.168.1.1")).toBe(true);
		expect(isBlockedIp("64:ff9b:1::10.0.0.1")).toBe(true);
		expect(isBlockedIp("2002:c0a8:0001::1")).toBe(true);
		expect(isBlockedIp("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
		expect(isBlockedIp("2001:db8::1")).toBe(true);
		expect(isBlockedIp("100::1")).toBe(true);
		expect(isBlockedIp("3fff::1")).toBe(true);
		expect(isBlockedIp("5f00::1")).toBe(true);
		expect(isBlockedIp(PUBLIC_IP)).toBe(false);
		expect(isBlockedIp("1.1.1.1")).toBe(false);
		expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
		expect(isBlockedIp("not-an-ip")).toBe(true);
	});

	it("allowlists only the frozen official output hosts", () => {
		expect([...XAI_OUTPUT_HOSTS]).toEqual(["imgen.x.ai", "videogen.x.ai", "vidgen.x.ai"]);
		expect(isAllowlistedImagineHost("imgen.x.ai")).toBe(true);
		expect(isAllowlistedImagineHost("IMGEN.X.AI.")).toBe(true);
		expect(isAllowlistedImagineHost("videogen.x.ai")).toBe(true);
		expect(isAllowlistedImagineHost("imgen.x.ai.evil.com")).toBe(false);
		expect(isAllowlistedImagineHost("cdn.x.ai")).toBe(false);
		expect(isAllowlistedImagineHost("imagine.x.ai")).toBe(false);
		expect(isAllowlistedImagineHost("assets.x.ai")).toBe(false);
		expect(isAllowlistedImagineHost("vidgen.x.ai")).toBe(true);
		expect(isAllowlistedImagineHost("evil.com")).toBe(false);
	});

	it("rejects non-HTTPS, credentialed, non-allowlisted, and privately resolved URLs", async () => {
		const publicLookup = async () => [PUBLIC_IP];
		await expect(assertSafeRemoteMediaUrl("http://imgen.x.ai/a", publicLookup)).rejects.toMatchObject({ code: "SSRF" });
		await expect(assertSafeRemoteMediaUrl("https://imgen.x.ai:8443/a", publicLookup)).rejects.toMatchObject({
			code: "SSRF",
		});
		await expect(assertSafeRemoteMediaUrl("https://user:pass@imgen.x.ai/a", publicLookup)).rejects.toMatchObject({
			code: "SSRF",
		});
		await expect(assertSafeRemoteMediaUrl("https://evil.com/a", publicLookup)).rejects.toMatchObject({ code: "SSRF" });
		await expect(assertSafeRemoteMediaUrl("https://cdn.x.ai/a", publicLookup)).rejects.toMatchObject({ code: "SSRF" });
		await expect(assertSafeRemoteMediaUrl("https://localhost/a", publicLookup)).rejects.toMatchObject({ code: "SSRF" });
		await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ["127.0.0.1"])).rejects.toMatchObject({
			code: "SSRF",
		});
		await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ["10.0.0.8"])).rejects.toMatchObject({ code: "SSRF" });
		await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ["169.254.1.1"])).rejects.toMatchObject({
			code: "SSRF",
		});
		await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ["203.0.113.10"])).rejects.toMatchObject({
			code: "SSRF",
		});
		await expect(assertSafeRemoteMediaUrl(IMAGE_URL, publicLookup)).resolves.toMatchObject({ hostname: "imgen.x.ai" });
	});
});

describe("media sniffing", () => {
	it("detects PNG/JPEG/WebP/GIF and MP4/WebM magic", () => {
		expect(detectImageMediaType(PNG)).toBe("image/png");
		expect(detectImageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0x01]))).toBe("image/jpeg");
		expect(detectVideoMediaType(MP4)).toBe("video/mp4");
		expect(detectVideoMediaType(WEBM)).toBe("video/webm");
		expect(detectImageMediaType(MP4)).toBeUndefined();
		expect(detectVideoMediaType(PNG)).toBeUndefined();
	});
});

describe("GrokImagineClient image generation", () => {
	it("POSTs the official generations endpoint and persists a downloaded raster", async () => {
		const record: RecordedRequest[] = [];
		const { client, attachments, auth } = await createHarness({
			fetch: scriptedFetch({
				record,
				onApi: (request) => {
					expect(request.url).toBe(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`);
					expect(request.method).toBe("POST");
					expect(request.headers["authorization"]).toBe("Bearer xai-test-key");
					const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
					expect(body).toMatchObject({
						model: GROK_IMAGINE_IMAGE_MODEL,
						prompt: "a red cube",
						n: 1,
						response_format: "url",
					});
					expect(body).not.toHaveProperty("size");
					return jsonResponse({ data: [{ url: IMAGE_URL }] });
				},
				onMedia: (request) => {
					expect(request.url).toBe(IMAGE_URL);
					expect(request.method).toBe("GET");
					expect(request.headers["authorization"]).toBeUndefined();
					return bytesResponse(PNG, "image/png");
				},
			}),
		});

		const result = await client.generateImage({ prompt: "a red cube" });
		expect(auth.calls).toEqual(["image.generate"]);
		expect(attachments.saved).toHaveLength(1);
		expect(attachments.saved[0]?.mediaType).toBe("image/png");
		expect(result.path).toBe(imagineImagePath(result.attachment.attachmentId));
		expect(result.path.startsWith("/plugins/dsh-grok-build/imagine/images/")).toBe(true);
		expect(JSON.stringify(result)).not.toContain("imgen.x.ai");
		expect(JSON.stringify(result)).not.toContain("https://");
		expect(JSON.stringify(result)).not.toMatch(/[a-f0-9]{64}/);
		expect(record.every((item) => item.url.startsWith("https://"))).toBe(true);
		const mediaGets = record.filter((item) => !item.url.startsWith(XAI_API_ORIGIN));
		expect(mediaGets.every((item) => item.headers.authorization === undefined)).toBe(true);
	});

	it("accepts official b64_json without a media download", async () => {
		const record: RecordedRequest[] = [];
		const { client, attachments } = await createHarness({
			fetch: scriptedFetch({
				record,
				onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString("base64") }] }),
			}),
		});
		const result = await client.generateImage({ prompt: "encoded" });
		expect(attachments.saved[0]?.data).toEqual(PNG);
		expect(result.images).toHaveLength(1);
		expect(record.some((item) => item.url.includes("imgen.x.ai"))).toBe(false);
	});

	it("does not fall back to OAuth when the resolver is empty or throws", async () => {
		const media = await tempMedia();
		const attachments = new MemoryAttachments();
		const empty = createGrokImagineClient({
			resolveApiKey: async () => "",
			attachments,
			media,
			fetch: async () => {
				throw new Error("fetch should not run");
			},
			downloader: {
				download: async () => {
					throw new Error("download should not run");
				},
			},
		});
		await expect(empty.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MISSING_CREDENTIAL" });

		const failing = createGrokImagineClient({
			resolveApiKey: async () => {
				throw new Error("store empty");
			},
			attachments,
			media,
			fetch: async () => {
				throw new Error("fetch should not run");
			},
			downloader: {
				download: async () => {
					throw new Error("download should not run");
				},
			},
		});
		await expect(failing.generateImage({ prompt: "x" })).rejects.toMatchObject({
			code: "MISSING_CREDENTIAL",
			message: expect.stringMatching(/does not fall back to OAuth/),
		});
	});

	it("maps 401 to AUTH without retrying another credential and redacts secrets", async () => {
		let apiCalls = 0;
		const { client, auth } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => {
					apiCalls += 1;
					return jsonResponse(
						{
							error: {
								message:
									"invalid api key xai-secret-value client_secret: abcdefghijklmnopqrstuvwxyz0123 https://imgen.x.ai/x?token=abc",
							},
						},
						401,
					);
				},
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({
			code: "AUTH",
			status: 401,
			message: expect.not.stringContaining("xai-secret-value"),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({
			message: expect.not.stringMatching(/imgen\.x\.ai|abcdefghijklmnopqrstuvwxyz0123/u),
		});
		expect(apiCalls).toBe(2);
		expect(auth.calls).toEqual(["image.generate", "image.generate"]);
	});
});

describe("GrokImagineClient video", () => {
	it("starts a video on the official endpoint and downloads MP4 on done", async () => {
		const record: RecordedRequest[] = [];
		const { client, auth, media } = await createHarness({
			fetch: scriptedFetch({
				record,
				onApi: (request) => {
					if (request.method === "POST") {
						expect(request.url).toBe(`${XAI_API_ORIGIN}${GROK_IMAGINE_VIDEO_START_PATH}`);
						const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
						expect(body).toMatchObject({ model: GROK_IMAGINE_VIDEO_MODEL, prompt: "orbit" });
						return jsonResponse({ request_id: "req_video_1" });
					}
					expect(request.url).toBe(`${XAI_API_ORIGIN}/v1/videos/req_video_1`);
					return jsonResponse({
						status: "done",
						video: { url: VIDEO_URL, duration: 6, respect_moderation: true },
						model: GROK_IMAGINE_VIDEO_MODEL,
					});
				},
				onMedia: (request) => {
					expect(request.url).toBe(VIDEO_URL);
					expect(request.headers["authorization"]).toBeUndefined();
					return bytesResponse(MP4, "video/mp4");
				},
			}),
		});

		const started = await client.startVideo({ prompt: "orbit" });
		expect(started).toEqual({ model: GROK_IMAGINE_VIDEO_MODEL, requestId: "req_video_1", status: "pending" });
		const status = await client.videoStatus("req_video_1");
		expect(status.status).toBe("completed");
		expect(status.artifact).toBeDefined();
		expect(status.artifact).not.toHaveProperty("sha256");
		expect(status.path).toBe(imagineMediaPath(status.artifact!.artifactId));
		expect(JSON.stringify(status)).not.toContain("videogen.x.ai");
		expect(JSON.stringify(status)).not.toContain("https://");
		expect(JSON.stringify(status)).not.toMatch(/[a-f0-9]{64}/);
		expect((await media.read(status.artifact!.artifactId)).data).toEqual(MP4);
		expect(auth.calls).toEqual(["video.start", "video.status"]);
		expect(record.filter((item) => item.url.startsWith(XAI_API_ORIGIN)).map((item) => item.method)).toEqual([
			"POST",
			"GET",
		]);
	});

	it("returns pending and failed official statuses without downloading", async () => {
		const record: RecordedRequest[] = [];
		const pendingClient = (
			await createHarness({
				fetch: scriptedFetch({
					record,
					onApi: () => jsonResponse({ status: "pending", progress: 10 }),
				}),
			})
		).client;
		await expect(pendingClient.videoStatus("req_p")).resolves.toEqual({ requestId: "req_p", status: "pending" });

		const failedClient = (
			await createHarness({
				fetch: scriptedFetch({
					record,
					onApi: () =>
						jsonResponse({
							status: "failed",
							error: { code: "invalid_argument", message: "quota" },
						}),
				}),
			})
		).client;
		await expect(failedClient.videoStatus("req_f")).resolves.toEqual({
			requestId: "req_f",
			status: "failed",
			error: "quota",
		});
		expect(record.some((item) => item.url.includes("videogen"))).toBe(false);
	});

	it("downloads WebM from the official video.url field", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () =>
					jsonResponse({
						status: "done",
						video: { url: VIDEO_URL, duration: 4, respect_moderation: true },
					}),
				onMedia: () => bytesResponse(WEBM, "video/webm"),
			}),
		});
		const status = await client.videoStatus("req_w");
		expect(status.artifact?.mediaType).toBe("video/webm");
	});

	it("makes a second poll of a completed request idempotent without leaking the upstream URL", async () => {
		let statusCalls = 0;
		let mediaCalls = 0;
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => {
					statusCalls += 1;
					return jsonResponse({
						status: "done",
						video: { url: `${VIDEO_URL}?sig=super-secret`, duration: 6, respect_moderation: true },
					});
				},
				onMedia: () => {
					mediaCalls += 1;
					return bytesResponse(MP4, "video/mp4");
				},
			}),
		});
		const first = await client.videoStatus("req_idemp");
		const second = await client.videoStatus("req_idemp");
		expect(statusCalls).toBe(1);
		expect(mediaCalls).toBe(1);
		expect(second.status).toBe("completed");
		expect(second.artifact?.artifactId).toBe(first.artifact?.artifactId);
		expect(JSON.stringify(second)).not.toContain("videogen");
		expect(JSON.stringify(second)).not.toContain("super-secret");
		expect(JSON.stringify(second)).not.toContain("https://");

		const concurrentClient = (
			await createHarness({
				fetch: scriptedFetch({
					onApi: async () => {
						statusCalls += 1;
						return jsonResponse({
							status: "done",
							video: { url: VIDEO_URL, duration: 6, respect_moderation: true },
						});
					},
					onMedia: () => bytesResponse(MP4, "video/mp4"),
				}),
			})
		).client;
		const before = statusCalls;
		const [left, right] = await Promise.all([
			concurrentClient.videoStatus("req_same"),
			concurrentClient.videoStatus("req_same"),
		]);
		expect(statusCalls - before).toBe(1);
		expect(left.artifact?.artifactId).toBe(right.artifact?.artifactId);
	});
});

describe("GrokImagineClient download policy", () => {
	it("rejects a generated image URL that is not HTTPS or not allowlisted", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: "http://imgen.x.ai/cat.png" }] }),
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });

		const blocked = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: "https://example.com/cat.png" }] }),
			}),
		});
		await expect(blocked.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });
	});

	it("rejects frozen-list host widening including former extra xAI hosts", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: "https://cdn.x.ai/cat.png" }] }),
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });
	});

	it("validates each redirect and refuses a hop that resolves privately", async () => {
		const lookups: string[] = [];
		const { client } = await createHarness({
			lookup: async (hostname) => {
				lookups.push(hostname);
				if (hostname === "imgen.x.ai") return [PUBLIC_IP];
				return ["10.0.0.9"];
			},
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: (request) => {
					if (request.url === IMAGE_URL) {
						return new Response(null, { status: 302, headers: { location: "https://imgen.x.ai/next.png" } });
					}
					return bytesResponse(PNG, "image/png");
				},
			}),
		});
		const privateClient = (
			await createHarness({
				lookup: async (hostname) => {
					lookups.push(hostname);
					return hostname === "imgen.x.ai" ? ["10.0.0.9"] : [PUBLIC_IP];
				},
				fetch: scriptedFetch({
					onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
					onMedia: () => bytesResponse(PNG, "image/png"),
				}),
			})
		).client;
		await expect(privateClient.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });
		await expect(client.generateImage({ prompt: "x" })).resolves.toMatchObject({
			path: expect.stringContaining("/imagine/images/"),
		});
	});

	it("follows one allowlisted same-host redirect after re-checking DNS", async () => {
		const { client, attachments } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: (request) => {
					if (request.url === IMAGE_URL) {
						return new Response(null, { status: 302, headers: { location: IMAGE_URL_FINAL } });
					}
					expect(request.url).toBe(IMAGE_URL_FINAL);
					expect(request.headers["authorization"]).toBeUndefined();
					return bytesResponse(PNG, "image/png");
				},
			}),
		});
		const result = await client.generateImage({ prompt: "x" });
		expect(attachments.saved).toHaveLength(1);
		expect(result.path).toContain("/imagine/images/");
	});

	it("rejects an invalid redirect Location", async () => {
		const missing = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => new Response(null, { status: 302 }),
			}),
		});
		await expect(missing.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });

		const evil = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => new Response(null, { status: 302, headers: { location: "https://evil.com/steal" } }),
			}),
		});
		await expect(evil.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });

		const fileUrl = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
			}),
		});
		await expect(fileUrl.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "SSRF" });
	});

	it("rejects oversized bodies, MIME mismatch, declared content-length overflow, and huge API JSON", async () => {
		const oversized = await createHarness({
			imageMaxBytes: 16,
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => bytesResponse(PNG, "image/png"),
			}),
		});
		await expect(oversized.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MEDIA" });

		const mismatch = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => bytesResponse(PNG, "image/jpeg"),
			}),
		});
		await expect(mismatch.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MEDIA" });

		const declared = await createHarness({
			imageMaxBytes: 32,
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => bytesResponse(PNG, "image/png", 200, { "content-length": "99999" }),
			}),
		});
		await expect(declared.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MEDIA" });

		const hugeJson = await createHarness({
			apiJsonMaxBytes: 64,
			fetch: scriptedFetch({
				onApi: () =>
					new Response("x".repeat(2_000_000), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			}),
		});
		await expect(hugeJson.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MEDIA" });

		const hugeB64 = await createHarness({
			imageMaxBytes: 32,
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ b64_json: "A".repeat(10_000) }] }),
			}),
		});
		await expect(hugeB64.client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "MEDIA" });
	});

	it("never sends Authorization on temporary media GETs", async () => {
		const record: RecordedRequest[] = [];
		const { client } = await createHarness({
			fetch: scriptedFetch({
				record,
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: () => bytesResponse(PNG, "image/png"),
			}),
		});
		await client.generateImage({ prompt: "x" });
		const mediaRequests = record.filter((item) => !item.url.startsWith(XAI_API_ORIGIN));
		expect(mediaRequests.length).toBeGreaterThan(0);
		expect(mediaRequests.every((item) => item.headers.authorization === undefined)).toBe(true);
	});

	it("rejects invalid models and unofficial image size fields", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => {
					throw new Error("API must not run for invalid models");
				},
			}),
		});
		await expect(client.generateImage({ prompt: "x", model: "grok-2" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(client.generateImage({ prompt: "x", resolution: "4k" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(client.generateImage({ prompt: "x", aspectRatio: "21:9" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(client.startVideo({ prompt: "x", model: "grok-imagine-video" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(client.startVideo({ prompt: "x", duration: 16 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(client.startVideo({ prompt: "x", resolution: "4k" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});

	it("maps a download timeout to TIMEOUT", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
				onMedia: async () => {
					const error = new Error("aborted");
					error.name = "TimeoutError";
					throw error;
				},
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "TIMEOUT" });
	});

	it("refuses to treat an ordinary fetch as a production media transport", () => {
		expect(() =>
			createImagineDownloaderFromFetch(async () => new Response(null), {
				trustedTestTransport: false as true,
			}),
		).toThrow(GrokImagineError);
	});
});

describe("image route gate", () => {
	it("builds and parses same-origin image routes and serves only with explicit authz", async () => {
		const ref: ImagineImageAttachmentRef = {
			attachmentId: `att_${"cd".repeat(16)}`,
			mediaType: "image/png",
			bytes: PNG.byteLength,
			width: 1,
			height: 1,
		};
		const path = imagineImagePath(ref.attachmentId);
		expect(parseImagineImagePath(path)).toBe(ref.attachmentId);
		expect(parseImagineImagePath("/plugins/dsh-grok-build/imagine/images/../etc/passwd")).toBeUndefined();
		expect(isSafeImagineAttachmentId("../etc/passwd")).toBe(false);
		expect(imagineImageDownloadHeaders(ref)["X-Content-Type-Options"]).toBe("nosniff");
		await expect(openTrustedImagineImageDownload(new MemoryAttachments(), ref, {} as never)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		const view = await openTrustedImagineImageDownload(
			new MemoryAttachments(),
			ref,
			createTrustedImagineAuthz({ remoteAddress: "127.0.0.1" }),
		);
		expect(view.body).toEqual(PNG);
		expect(view.headers["Content-Type"]).toBe("image/png");
		expect(JSON.stringify(view.headers)).not.toMatch(/https?:\/\//);
	});
});

describe("GrokImagineClient input validation", () => {
	it("rejects prompts longer than the 4000-character ceiling", async () => {
		const oversized = "x".repeat(IMAGINE_PROMPT_MAX_LENGTH + 1);
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () => {
					throw new Error("API must not run for an over-long prompt");
				},
			}),
		});
		await expect(client.generateImage({ prompt: oversized })).rejects.toMatchObject({
			code: "INVALID_INPUT",
			message: expect.stringMatching(/4000/),
		});
		await expect(client.startVideo({ prompt: oversized })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
	});

	it("rejects base64 strings containing non-canonical characters", async () => {
		const hostile = "$".repeat(200);
		const { client } = await createHarness({
			imageMaxBytes: 1024 * 1024,
			fetch: scriptedFetch({
				onApi: () =>
					jsonResponse({
						data: [{ b64_json: hostile }],
					}),
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "UPSTREAM" });
	});

	it("rejects unpadded base64 of remainder 1", async () => {
		const unpadded = "AAAAA";
		const { client } = await createHarness({
			imageMaxBytes: 1024 * 1024,
			fetch: scriptedFetch({
				onApi: () =>
					jsonResponse({
						data: [{ b64_json: unpadded }],
					}),
			}),
		});
		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "UPSTREAM" });
	});

	it("accepts well-formed padded base64 and rejects empty input", async () => {
		const { client } = await createHarness({
			fetch: scriptedFetch({
				onApi: () =>
					jsonResponse({
						data: [{ b64_json: Buffer.from(PNG).toString("base64") }],
					}),
			}),
		});
		const result = await client.generateImage({ prompt: "x" });
		expect(result.images).toHaveLength(1);
	});
});

describe("parseVideoRequestId and imageIds bounds", () => {
	it("accepts a safe ASCII request id up to 256 characters", () => {
		expect(parseVideoRequestId("req_video_1")).toBe("req_video_1");
		expect(parseVideoRequestId("a".repeat(256))).toBe("a".repeat(256));
	});

	it("rejects request ids outside the [A-Za-z0-9_-]{1,256} pattern", () => {
		expect(() => parseVideoRequestId("")).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId("a".repeat(257))).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId("../escape")).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId("req with space")).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId(null)).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId(123)).toThrow(GrokImagineError);
	});

	it("advertises the documented bounds for tool schemas", () => {
		expect(IMAGINE_PROMPT_MAX_LENGTH).toBe(4000);
		expect(IMAGINE_IMAGE_IDS_MIN).toBe(1);
		expect(IMAGINE_IMAGE_IDS_MAX).toBe(5);
	});
});

describe("GrokImagineClient dispose ownership", () => {
	it("refuses new work after dispose and cancels a pending poll", async () => {
		let pendingPoll: ((response: Response) => void) | undefined;
		let aborted: AbortSignal | undefined;
		const client = createGrokImagineClient({
			resolveApiKey: async () => "xai-test-key",
			attachments: new MemoryAttachments(),
			media: await tempMedia(),
			fetch: async (_input, init) => {
				aborted = init?.signal ?? undefined;
				return new Promise<Response>((resolve) => {
					pendingPoll = (response) => resolve(response);
				});
			},
			downloader: {
				download: async () => {
					throw new Error("download must not run after dispose");
				},
			},
		});

		const statusPromise = client.videoStatus("req_owned");
		await new Promise((resolve) => setImmediate(resolve));
		client.dispose();
		expect(client.isDisposed).toBe(true);
		if (pendingPoll) pendingPoll(jsonResponse({ status: "pending" }));
		await expect(statusPromise).rejects.toMatchObject({ code: "TIMEOUT" });
		expect(aborted?.aborted).toBe(true);

		await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
			message: expect.stringContaining("disposed"),
		});
		await expect(client.startVideo({ prompt: "x" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		client.dispose();
		expect(client.isDisposed).toBe(true);
	});

	it("rejects an already-aborted consumer signal before resolving credentials or fetching", async () => {
		const controller = new AbortController();
		controller.abort(new Error("caller cancelled"));
		const { client, auth } = await createHarness({
			fetch: async () => {
				throw new Error("fetch must not run for an already-aborted operation");
			},
		});
		await expect(client.generateImage({ prompt: "x" }, controller.signal)).rejects.toMatchObject({ code: "TIMEOUT" });
		await expect(client.startVideo({ prompt: "x" }, controller.signal)).rejects.toMatchObject({ code: "TIMEOUT" });
		await expect(client.videoStatus("req_aborted", { signal: controller.signal })).rejects.toMatchObject({
			code: "TIMEOUT",
		});
		expect(auth.calls).toEqual([]);
	});

	it("keeps concurrent caller-owned video poll cancellation isolated", async () => {
		const responders: Array<(response: Response) => void> = [];
		const { client } = await createHarness({
			fetch: async () =>
				new Promise<Response>((resolve) => {
					responders.push(resolve);
				}),
		});
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = client.videoStatus("req_shared", { signal: firstController.signal });
		const second = client.videoStatus("req_shared", { signal: secondController.signal });
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(responders).toHaveLength(2);
		firstController.abort(new Error("first caller cancelled"));
		for (const respond of responders) respond(jsonResponse({ status: "pending" }));
		await expect(first).rejects.toMatchObject({ code: "TIMEOUT" });
		await expect(second).resolves.toEqual({ requestId: "req_shared", status: "pending" });
	});

	it("forwards the consumer-owned AbortSignal into the fetch init", async () => {
		let observed: AbortSignal | undefined;
		const client = createGrokImagineClient({
			resolveApiKey: async () => "xai-test-key",
			attachments: new MemoryAttachments(),
			media: await tempMedia(),
			fetch: async (_input, init) => {
				observed = init?.signal ?? undefined;
				return jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString("base64") }] });
			},
			downloader: {
				download: async () => {
					throw new Error("download must not run");
				},
			},
		});

		const controller = new AbortController();
		await client.generateImage({ prompt: "x" }, controller.signal);
		expect(observed).toBeDefined();
		expect(observed?.aborted).toBe(false);
	});
});

describe("imagine image route suffix hardening", () => {
	it("accepts opaque DSH attachment ids while rejecting path syntax and controls", () => {
		expect(isSafeImagineAttachmentId(`sha256:${"ab".repeat(32)}`)).toBe(true);
		expect(isSafeImagineAttachmentId("att.dot")).toBe(true);
		expect(isSafeImagineAttachmentId("att..dot")).toBe(false);
		expect(isSafeImagineAttachmentId("att/slash")).toBe(false);
		expect(isSafeImagineAttachmentId("att\\backslash")).toBe(false);
		expect(isSafeImagineAttachmentId("att with space")).toBe(false);
		// NUL byte is rejected even before the regex check.
		expect(isSafeImagineAttachmentId("att\u0000byte")).toBe(false);
		expect(isSafeImagineAttachmentId("att_a-b_c-123")).toBe(true);
	});

	it("rejects unknown image subtypes for downloads", () => {
		expect(() =>
			imagineImageDownloadHeaders({
				attachmentId: "att_a-b_c-123",
				mediaType: "image/svg+xml" as "image/png",
				bytes: 10,
				width: 1,
				height: 1,
			}),
		).toThrow(GrokImagineError);
	});

	it("renders an ASCII-safe inline filename", () => {
		const header = imagineImageDownloadHeaders({
			attachmentId: "att_x1",
			mediaType: "image/png",
			bytes: 10,
			width: 1,
			height: 1,
		});
		expect(header["Content-Disposition"]).toBe(`inline; filename="imagine-att_x1.png"`);
		expect(header["X-Content-Type-Options"]).toBe("nosniff");
	});
});

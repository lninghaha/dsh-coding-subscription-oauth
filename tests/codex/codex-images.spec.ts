import type { ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from "@deepseek-ai/dsh-attachment";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CodexFetch } from "../../src/codex/codex-http.ts";
import {
	CODEX_IMAGE_EDIT_URL,
	CODEX_IMAGE_GENERATION_URL,
	CODEX_IMAGE_MODEL,
	CODEX_IMAGE_RESPONSE_FORMAT,
	collectCanonicalImageRefs,
	createCodexImageController,
	decodeImageBase64,
	estimateDecodedBase64Bytes,
	isCodexImageCapableRoute,
	resolveSessionImageRefs,
} from "../../src/codex/codex-images.ts";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

function jwtWithAccount(accountId: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
	).toString("base64url");
	return `${header}.${payload}.sig`;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(impl?: CodexFetch): Mock<CodexFetch> {
	return impl === undefined ? vi.fn<CodexFetch>() : vi.fn(impl);
}

function imageRef(id: string): ImageAttachmentRef {
	return {
		attachmentId: id as ImageAttachmentRef["attachmentId"],
		mediaType: "image/png",
		bytes: PNG.byteLength,
		width: 1,
		height: 1,
	};
}

function memoryAttachments(overrides?: { maxImageBytes?: number }) {
	const saved: ImageAttachmentRef[] = [];
	return {
		imageLimits: {
			maxImageBytes: overrides?.maxImageBytes ?? 1024 * 1024,
			maxImagesPerMessage: 6,
			maxMessageImageBytes: 4 * 1024 * 1024,
			mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] as const,
		},
		validateImage: vi.fn(async (_input: SaveImageAttachment) => {}),
		saveImage: vi.fn(async (input: SaveImageAttachment) => {
			const ref = imageRef(`saved-${String(saved.length + 1)}`);
			saved.push(ref);
			expect(input.mediaType).toBe("image/png");
			return ref;
		}),
		readImage: vi.fn(
			async (ref: ImageAttachmentRef): Promise<StoredImageAttachment> => ({ ref, data: new Uint8Array(PNG) }),
		),
		saved,
	};
}

beforeEach(() => {
	vi.stubGlobal("fetch", () => {
		throw new Error("unexpected real network");
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("isCodexImageCapableRoute", () => {
	it("requires a Codex OAuth provider that declares image input", () => {
		expect(isCodexImageCapableRoute({ provider: "codex-oauth", inputModalities: ["text", "image"] })).toBe(true);
		expect(isCodexImageCapableRoute({ provider: "openai-codex", inputModalities: ["image"] })).toBe(true);
		expect(isCodexImageCapableRoute({ provider: "codex-oauth-fast", inputModalities: ["image"] })).toBe(true);
		expect(isCodexImageCapableRoute({ provider: "codex-oauth", inputModalities: ["text"] })).toBe(false);
		expect(isCodexImageCapableRoute({ provider: "codex-oauth" })).toBe(false);
		expect(isCodexImageCapableRoute(undefined)).toBe(false);
		expect(isCodexImageCapableRoute({ provider: "grok-build", inputModalities: ["image"] })).toBe(false);
	});
});

describe("resolveSessionImageRefs", () => {
	const messages = [
		{
			content: [
				{ type: "text", text: "hi" },
				{ type: "image", attachment: imageRef("att-1") },
				{
					type: "tool-result",
					content: [{ type: "image", attachment: imageRef("att-nested") }],
				},
				{
					type: "random",
					nested: { type: "image", attachment: imageRef("att-sneaky") },
				},
			],
		},
	];

	it("resolves only canonical refs visibly present in current session message content", () => {
		expect(collectCanonicalImageRefs(messages).has("att-1")).toBe(true);
		expect(collectCanonicalImageRefs(messages).has("att-nested")).toBe(false);
		expect(collectCanonicalImageRefs(messages).has("att-sneaky")).toBe(false);
		const refs = resolveSessionImageRefs(() => messages, ["image:att-1"]);
		expect(refs.map((ref) => String(ref.attachmentId))).toEqual(["att-1"]);
	});

	it("rejects nested-only ids, unknown ids, HTTP URLs, and more than five references", () => {
		expect(() => resolveSessionImageRefs(() => messages, ["att-nested"])).toThrow(/not a canonical attachment/);
		expect(() => resolveSessionImageRefs(() => messages, ["att-missing"])).toThrow(/not a canonical attachment/);
		expect(() => resolveSessionImageRefs(() => messages, ["https://example.com/x.png"])).toThrow(/HTTP/);
		expect(() => resolveSessionImageRefs(() => messages, ["a", "b", "c", "d", "e", "f"])).toThrow(/at most 5/);
	});
});

describe("decodeImageBase64", () => {
	it("decodes standard base64 and base64url and prechecks encoded size", () => {
		const standard = PNG.toString("base64");
		const url = PNG.toString("base64url");
		expect(Buffer.from(decodeImageBase64(standard) ?? new Uint8Array()).equals(PNG)).toBe(true);
		expect(Buffer.from(decodeImageBase64(url) ?? new Uint8Array()).equals(PNG)).toBe(true);
		expect(estimateDecodedBase64Bytes(standard)).toBe(PNG.byteLength);
		expect(estimateDecodedBase64Bytes("====")).toBeUndefined();
		expect(decodeImageBase64("not base64!!!")).toBeUndefined();
	});
});

describe("createCodexImageController", () => {
	it("generates with gpt-image-2 auto defaults and saves only b64_json rasters", async () => {
		const attachments = memoryAttachments();
		const fetchImpl = mockFetch(async () =>
			jsonResponse(200, {
				created: 1,
				data: [{ b64_json: PNG.toString("base64") }, { url: "https://cdn.example/signed" }],
			}),
		);
		const controller = createCodexImageController({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
				invalidate: async () => {},
			},
			attachments,
			session: {
				deriveMessages: () => [],
				route: { provider: "codex-oauth", model: "gpt-5.4", inputModalities: ["text", "image"] },
			},
			fetchImpl,
			sleep: async () => {},
			now: () => 1_700_000_000_000,
		});
		const result = await controller.generate({ prompt: "a red cube" });
		expect(result.operation).toBe("generate");
		expect(result.model).toBe(CODEX_IMAGE_MODEL);
		expect(result.images).toHaveLength(1);
		expect(result.warnings.some((warning) => warning.code === "IMAGE_DATA_MISSING")).toBe(true);
		expect(attachments.validateImage).toHaveBeenCalledOnce();
		expect(attachments.saveImage).toHaveBeenCalledOnce();
		const [url, init = {}] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe(CODEX_IMAGE_GENERATION_URL);
		expect(JSON.parse(String(init.body))).toEqual({
			prompt: "a red cube",
			model: "gpt-image-2",
			n: 1,
			size: "auto",
			quality: "auto",
			background: "auto",
			response_format: CODEX_IMAGE_RESPONSE_FORMAT,
		});
	});

	it("decodes a base64url b64_json item", async () => {
		const attachments = memoryAttachments();
		const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString("base64url") }] }));
		const controller = createCodexImageController({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
				invalidate: async () => {},
			},
			attachments,
			session: {
				deriveMessages: () => [],
				route: { provider: "codex-oauth", inputModalities: ["image"] },
			},
			fetchImpl,
			sleep: async () => {},
		});
		const result = await controller.generate({ prompt: "url-safe" });
		expect(result.images).toHaveLength(1);
		expect(attachments.saveImage).toHaveBeenCalledOnce();
	});

	it("prechecks encoded size and does not save an oversized item", async () => {
		const attachments = memoryAttachments({ maxImageBytes: 8 });
		const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString("base64") }] }));
		const controller = createCodexImageController({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
				invalidate: async () => {},
			},
			attachments,
			session: {
				deriveMessages: () => [],
				route: { provider: "codex-oauth", inputModalities: ["image"] },
			},
			fetchImpl,
			sleep: async () => {},
		});
		await expect(controller.generate({ prompt: "too big" })).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
		expect(attachments.saveImage).not.toHaveBeenCalled();
	});

	it("edits only session-owned images and posts to the edits endpoint", async () => {
		const attachments = memoryAttachments();
		const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString("base64") }] }));
		const controller = createCodexImageController({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
				invalidate: async () => {},
			},
			attachments,
			session: {
				deriveMessages: () => [{ content: [{ type: "image", attachment: imageRef("owned") }] }],
				route: { provider: "openai-codex", inputModalities: ["image"] },
			},
			fetchImpl,
			sleep: async () => {},
		});
		const result = await controller.edit({ prompt: "make it blue", imageIds: ["image:owned"] });
		expect(result.operation).toBe("edit");
		expect(result.references.map((ref) => String(ref.attachmentId))).toEqual(["owned"]);
		expect(attachments.readImage).toHaveBeenCalledOnce();
		const [url, init = {}] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe(CODEX_IMAGE_EDIT_URL);
		const body = JSON.parse(String(init.body)) as {
			images: Array<{ image_url: string }>;
			model: string;
			response_format: string;
		};
		expect(body.model).toBe("gpt-image-2");
		expect(body.response_format).toBe("b64_json");
		expect(body.images[0]?.image_url.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("gates generation on an image-capable route", async () => {
		const fetchImpl = mockFetch();
		const controller = createCodexImageController({
			auth: {
				resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
				invalidate: async () => {},
			},
			attachments: memoryAttachments(),
			session: {
				deriveMessages: () => [],
				route: { provider: "codex-oauth", inputModalities: ["text"] },
			},
			fetchImpl,
		});
		await expect(controller.generate({ prompt: "nope" })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("fails closed when the session route is missing or has no modalities", async () => {
		const fetchImpl = mockFetch();
		const auth = {
			resolve: async () => ({ accessToken: jwtWithAccount("acct-img") }),
			invalidate: async () => {},
		};
		const missing = createCodexImageController({
			auth,
			attachments: memoryAttachments(),
			session: { deriveMessages: () => [] },
			fetchImpl,
		});
		const identityOnly = createCodexImageController({
			auth,
			attachments: memoryAttachments(),
			session: { deriveMessages: () => [], route: { provider: "codex-oauth", model: "gpt-5.4" } },
			fetchImpl,
		});
		await expect(missing.generate({ prompt: "nope" })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		await expect(identityOnly.generate({ prompt: "nope" })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

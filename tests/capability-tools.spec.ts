import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CAPABILITY_SETTINGS_BOUNDS,
	type CapabilitySettings,
	DEFAULT_CAPABILITY_SETTINGS,
} from "../src/capability-settings.ts";
import {
	CAPABILITY_TOOL_NAMES,
	type CapabilityImagineClient,
	CODEX_IMAGE_EDIT_TOOL,
	CODEX_IMAGE_GENERATE_TOOL,
	type CreateCodexImageController,
	createCapabilityTools,
} from "../src/capability-tools.ts";
import type { CodexAuthSession } from "../src/codex-http.ts";
import { CODEX_IMAGE_MODEL, type CodexImageController, type CodexImageSessionContext } from "../src/codex-images.ts";
import {
	GROK_IMAGINE_IMAGE_MODEL,
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_MODEL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	type ImagineImageAttachmentRef,
	type ImagineImageResult,
	type ImagineVideoStartResult,
	type ImagineVideoStatusResult,
} from "../src/grok-imagine.ts";
import { imagineMediaPath } from "../src/media-store.ts";

const ARTIFACT_ID = "ab".repeat(16);

function imageRef(id: string): ImageAttachmentRef {
	return {
		attachmentId: id as ImageAttachmentRef["attachmentId"],
		mediaType: "image/png",
		bytes: 32,
		width: 1,
		height: 1,
		name: `${id}.png`,
	};
}

function imagineRef(id: string): ImagineImageAttachmentRef {
	return {
		attachmentId: id,
		mediaType: "image/png",
		bytes: 32,
		width: 1,
		height: 1,
		name: `${id}.png`,
	};
}

function enabledSettings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return {
		...DEFAULT_CAPABILITY_SETTINGS,
		codexImages: true,
		codexImageEdits: true,
		grokImagineImage: true,
		grokImagineVideo: true,
		imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.default,
		...overrides,
	};
}

function fakeExec(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
	return {
		callId: "call-1" as ToolRunContext["callId"],
		rootCallId: "call-1" as ToolRunContext["rootCallId"],
		name: "tool",
		arguments: {},
		signal: new AbortController().signal,
		token: Symbol("tool-token") as ToolRunContext["token"],
		deferContext: () => {},
		concludeTurn: () => {},
		...overrides,
	};
}

function toolByName(tools: readonly ToolDefinition[], name: string): ToolDefinition {
	const tool = tools.find((candidate) => candidate.name === name);
	if (tool === undefined) throw new Error(`missing tool ${name}`);
	return tool;
}

function leakyImagineImage(): ImagineImageResult {
	const attachment = imagineRef("img_local");
	return {
		model: GROK_IMAGINE_IMAGE_MODEL,
		images: [
			{
				attachment,
				path: `/plugins/dsh-grok-build/imagine/images/${attachment.attachmentId}`,
			},
		],
		attachment,
		path: `/plugins/dsh-grok-build/imagine/images/${attachment.attachmentId}`,
		url: "https://imgen.x.ai/signed?token=abc",
		token: "sk-secret",
	} as ImagineImageResult & { url: string; token: string };
}

function leakyVideoStart(): ImagineVideoStartResult & { url: string; access_token: string } {
	return {
		model: GROK_IMAGINE_VIDEO_MODEL,
		requestId: "req_video_1",
		status: "pending",
		url: "https://videogen.x.ai/job",
		access_token: "tok-secret",
	};
}

function leakyVideoStatus(): ImagineVideoStatusResult & { url: string; token: string } {
	return {
		requestId: "req_video_1",
		status: "completed",
		artifact: {
			artifactId: ARTIFACT_ID,
			mediaType: "video/mp4",
			bytes: 64,
			createdAt: 1,
			expiresAt: 2,
		},
		path: imagineMediaPath(ARTIFACT_ID),
		url: "https://videogen.x.ai/signed-clip",
		token: "upstream-token",
	};
}

function fakeAuth(): CodexAuthSession {
	return {
		resolve: vi.fn(async () => ({ accessToken: "tok", accountId: "acct" })),
		invalidate: vi.fn(async () => {}),
	};
}

function fakeAttachments() {
	return {
		imageLimits: {
			maxImageBytes: 1024 * 1024,
			maxImagesPerMessage: 6,
			maxMessageImageBytes: 4 * 1024 * 1024,
			mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] as const,
		},
		validateImage: vi.fn(async () => {}),
		saveImage: vi.fn(async () => imageRef("saved")),
		readImage: vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: new Uint8Array([1, 2, 3]) })),
	};
}

function fakeImagine(overrides: Partial<CapabilityImagineClient> = {}): CapabilityImagineClient {
	return {
		generateImage: vi.fn(async () => leakyImagineImage()),
		startVideo: vi.fn(async () => leakyVideoStart()),
		videoStatus: vi.fn(async () => leakyVideoStatus()),
		...overrides,
	};
}

function fakeCodexController(overrides: Partial<CodexImageController> = {}): CodexImageController {
	const generated = imageRef("generated");
	return {
		generate: vi.fn<CodexImageController["generate"]>(async () => ({
			operation: "generate",
			model: CODEX_IMAGE_MODEL,
			images: [generated],
			references: [],
			warnings: [],
		})),
		edit: vi.fn<CodexImageController["edit"]>(async () => ({
			operation: "edit",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("edited")],
			references: [imageRef("owned")],
			warnings: [],
		})),
		...overrides,
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

describe("createCapabilityTools", () => {
	it("returns the five named tools without registering anything", () => {
		const tools = createCapabilityTools({
			current: () => DEFAULT_CAPABILITY_SETTINGS,
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
		});
		expect(tools.map((tool) => tool.name)).toEqual([...CAPABILITY_TOOL_NAMES]);
		expect(tools.every((tool) => tool.isConcurrencySafe === undefined)).toBe(true);
		expect(tools.find((tool) => tool.name === GROK_IMAGINE_IMAGE_TOOL)?.timeoutMs).toBeUndefined();
		expect(tools.find((tool) => tool.name === GROK_IMAGINE_VIDEO_TOOL)?.timeoutMs).toBeUndefined();
		expect(tools.find((tool) => tool.name === GROK_IMAGINE_VIDEO_STATUS_TOOL)?.timeoutMs).toBeUndefined();
	});

	it("denies every capability while settings stay default-off", async () => {
		const generate = vi.fn();
		const edit = vi.fn();
		const imagine = fakeImagine();
		const tools = createCapabilityTools({
			current: () => DEFAULT_CAPABILITY_SETTINGS,
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine,
			createCodexController: () => fakeCodexController({ generate, edit }),
		});
		const exec = fakeExec();
		await expect(toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: "cube" }, exec)).rejects.toMatchObject({
			message: expect.stringContaining("disabled"),
		});
		await expect(
			toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute({ prompt: "blue", imageIds: ["owned"] }, exec),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		await expect(toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: "orbit" }, exec)).rejects.toMatchObject({
			message: expect.stringContaining("disabled"),
		});
		await expect(toolByName(tools, GROK_IMAGINE_VIDEO_TOOL).execute({ prompt: "orbit" }, exec)).rejects.toMatchObject({
			message: expect.stringContaining("disabled"),
		});
		await expect(
			toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: "req_video_1" }, exec),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		expect(generate).not.toHaveBeenCalled();
		expect(edit).not.toHaveBeenCalled();
		expect(imagine.generateImage).not.toHaveBeenCalled();
		expect(imagine.startVideo).not.toHaveBeenCalled();
		expect(imagine.videoStatus).not.toHaveBeenCalled();
	});

	it("re-checks live flags after the tools already exist", async () => {
		let settings = enabledSettings();
		const generate = vi.fn();
		const tools = createCapabilityTools({
			current: () => settings,
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController: () => fakeCodexController({ generate }),
		});
		settings = enabledSettings({
			codexImages: false,
			codexImageEdits: false,
			grokImagineImage: false,
			grokImagineVideo: false,
		});
		await expect(
			toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: "cube" }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		await expect(
			toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: "req_video_1" }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		expect(generate).not.toHaveBeenCalled();
	});

	it("defaults omitted n to imageCount and rejects a larger n", async () => {
		const generate = vi.fn<CodexImageController["generate"]>(async () => ({
			operation: "generate",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("generated")],
			references: [],
			warnings: [],
		}));
		const imagineGenerate = vi.fn(async () => leakyImagineImage());
		const tools = createCapabilityTools({
			current: () => enabledSettings({ imageCount: 2 }),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine({ generateImage: imagineGenerate }),
			createCodexController: () => fakeCodexController({ generate }),
		});
		await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: "cube" }, fakeExec());
		expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "cube", n: 2 }), expect.any(AbortSignal));
		await expect(
			toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: "cube", n: 3 }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("imageCount") });
		await expect(
			toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: "orbit", n: 3 }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("imageCount") });
		expect(imagineGenerate).not.toHaveBeenCalled();
	});

	it("renders Codex and Imagine images from the canonical returned attachment refs", async () => {
		const generated = imageRef("generated");
		const tools = createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController: () =>
				fakeCodexController({
					generate: vi.fn<CodexImageController["generate"]>(async () => ({
						operation: "generate",
						model: CODEX_IMAGE_MODEL,
						images: [generated],
						references: [],
						warnings: [],
					})),
				}),
		});
		const generateTool = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL);
		const generateValue = (await generateTool.execute({ prompt: "cube" }, fakeExec())) as {
			images: ImageAttachmentRef[];
		};
		expect(generateValue.images[0]?.attachmentId).toBe("generated");
		const generateView = generateTool.output.render({ prompt: "cube" }, generateValue as never);
		expect(generateView[0]).toMatchObject({ type: "text" });
		expect(generateView[1]).toMatchObject({
			type: "image",
			attachment: { attachmentId: "generated", mediaType: "image/png" },
		});

		const imagineTool = toolByName(tools, GROK_IMAGINE_IMAGE_TOOL);
		const imagineValue = (await imagineTool.execute({ prompt: "orbit" }, fakeExec())) as {
			images: Array<{ attachment: ImageAttachmentRef; path: string }>;
		};
		expect(imagineValue.images[0]?.attachment.attachmentId).toBe("img_local");
		const imagineView = imagineTool.output.render({ prompt: "orbit" }, imagineValue as never);
		expect(imagineView[0]).toMatchObject({ type: "text" });
		expect(imagineView[1]).toMatchObject({
			type: "image",
			attachment: { attachmentId: "img_local" },
		});
	});

	it("fails Codex edit closed without an agent session and forwards deriveMessages when present", async () => {
		const sessions: CodexImageSessionContext[] = [];
		const deriveMessages = vi.fn(() => [{ content: [{ type: "image", attachment: imageRef("owned") }] }]);
		const edit = vi.fn<CodexImageController["edit"]>(async () => ({
			operation: "edit",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("edited")],
			references: [imageRef("owned")],
			warnings: [],
		}));
		const createCodexController = vi.fn<CreateCodexImageController>((session) => {
			sessions.push(session);
			return fakeCodexController({ edit });
		});
		const tools = createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController,
		});
		const editTool = toolByName(tools, CODEX_IMAGE_EDIT_TOOL);
		await expect(editTool.execute({ prompt: "blue", imageIds: ["owned"] }, fakeExec())).rejects.toMatchObject({
			message: expect.stringContaining("agent session"),
		});
		expect(createCodexController).not.toHaveBeenCalled();

		const signal = new AbortController().signal;
		await editTool.execute(
			{ prompt: "blue", imageIds: ["owned"] },
			fakeExec({
				signal,
				agent: {
					session: { deriveMessages },
					options: { provider: "codex-oauth", model: "gpt-5.4" },
				} as unknown as NonNullable<ToolRunContext["agent"]>,
			}),
		);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.deriveMessages()).toEqual([{ content: [{ type: "image", attachment: imageRef("owned") }] }]);
		expect(deriveMessages).toHaveBeenCalled();
		expect(edit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "blue", imageIds: ["owned"] }), signal);
	});

	it("lets generation run with empty history and forwards abort signal", async () => {
		const generate = vi.fn<CodexImageController["generate"]>(async (_input, _signal) => ({
			operation: "generate",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("generated")],
			references: [],
			warnings: [],
		}));
		const sessions: CodexImageSessionContext[] = [];
		const tools = createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController: (session) => {
				sessions.push(session);
				return fakeCodexController({ generate });
			},
		});
		const signal = new AbortController().signal;
		await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: "cube" }, fakeExec({ signal }));
		expect(sessions[0]?.deriveMessages()).toEqual([]);
		expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "cube" }), signal);
	});

	it("returns opaque Imagine outputs without upstream URLs or tokens", async () => {
		const tools = createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
		});
		const image = await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: "orbit" }, fakeExec());
		expect(JSON.stringify(image)).not.toMatch(/imgen\.x\.ai|token|sk-secret/iu);
		expect(image).toMatchObject({
			model: GROK_IMAGINE_IMAGE_MODEL,
			path: "/plugins/dsh-grok-build/imagine/images/img_local",
			attachment: { attachmentId: "img_local" },
		});

		const started = await toolByName(tools, GROK_IMAGINE_VIDEO_TOOL).execute({ prompt: "orbit" }, fakeExec());
		expect(started).toEqual({
			model: GROK_IMAGINE_VIDEO_MODEL,
			requestId: "req_video_1",
			status: "pending",
		});
		expect(JSON.stringify(started)).not.toMatch(/videogen\.x\.ai|access_token|tok-secret/iu);

		const statusTool = toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL);
		const status = (await statusTool.execute({ requestId: "req_video_1" }, fakeExec())) as {
			requestId: string;
			status: "completed";
			artifact: { artifactId: string; mediaType: string; bytes: number; createdAt: number; expiresAt: number };
			path: string;
		};
		expect(status).toEqual({
			requestId: "req_video_1",
			status: "completed",
			artifact: {
				artifactId: ARTIFACT_ID,
				mediaType: "video/mp4",
				bytes: 64,
				createdAt: 1,
				expiresAt: 2,
			},
			path: imagineMediaPath(ARTIFACT_ID),
		});
		expect(JSON.stringify(status)).not.toMatch(/videogen\.x\.ai|upstream-token|https?:\/\//iu);
		const statusView = statusTool.output.render({ requestId: "req_video_1" }, status);
		expect(statusView).toEqual([
			{ type: "text", text: `Imagine video req_video_1 completed (${imagineMediaPath(ARTIFACT_ID)}).` },
		]);
		expect(statusView.every((block) => block.type === "text")).toBe(true);
	});

	it("requires both Codex image flags for edits and grokImagineVideo for status", async () => {
		const edit = vi.fn();
		const imagine = fakeImagine();
		const tools = createCapabilityTools({
			current: () => enabledSettings({ codexImages: false, grokImagineVideo: false }),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine,
			createCodexController: () => fakeCodexController({ edit }),
		});
		await expect(
			toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
				{ prompt: "blue", imageIds: ["owned"] },
				fakeExec({
					agent: { session: { deriveMessages: () => [] }, options: {} } as unknown as NonNullable<
						ToolRunContext["agent"]
					>,
				}),
			),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		await expect(
			toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: "req_video_1" }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		expect(edit).not.toHaveBeenCalled();
		expect(imagine.videoStatus).not.toHaveBeenCalled();
	});
});

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
	callingRouteIdentity,
	codexImageRoutePolicy,
	createCapabilityTools,
	resolveCodexImageRouteFromLlm,
} from "../src/capability-tools.ts";
import type { CodexAuthSession } from "../src/codex-http.ts";
import { CODEX_IMAGE_MODEL, type CodexImageController, type CodexImageSessionContext } from "../src/codex-images.ts";
import {
	GROK_IMAGINE_IMAGE_MODEL,
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_MODEL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	IMAGINE_IMAGE_IDS_MAX,
	IMAGINE_IMAGE_IDS_MIN,
	IMAGINE_PROMPT_MAX_LENGTH,
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

function fakeAgent(
	input: {
		options?: { provider?: string; model?: string };
		header?: { provider: string; model: string };
		deriveMessages?: () => readonly unknown[];
	} = {},
): NonNullable<ToolRunContext["agent"]> {
	return {
		options: input.options ?? {},
		session: {
			...(input.deriveMessages === undefined ? {} : { deriveMessages: input.deriveMessages }),
			...(input.header === undefined ? {} : { requestHeader: () => ({ config: input.header }) }),
		},
	} as unknown as NonNullable<ToolRunContext["agent"]>;
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
	it("returns the five named tools without registering anything", async () => {
		const tools = await createCapabilityTools({
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

	it("relaxes the Codex route gate when codexImagesAnyModel is on", () => {
		expect(codexImageRoutePolicy(enabledSettings())).toBe("codex-capable");
		expect(codexImageRoutePolicy(enabledSettings({ codexImagesAnyModel: true }))).toBe("any");
		expect(codexImageRoutePolicy(DEFAULT_CAPABILITY_SETTINGS)).toBe("codex-capable");
	});

	it("denies every capability while settings stay default-off", async () => {
		const generate = vi.fn();
		const edit = vi.fn();
		const imagine = fakeImagine();
		const resolveCodexImageRoute = vi.fn(async () => ({
			provider: "codex-oauth",
			model: "gpt-5.4",
			inputModalities: ["text", "image"],
		}));
		const tools = await createCapabilityTools({
			current: () => DEFAULT_CAPABILITY_SETTINGS,
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine,
			createCodexController: () => fakeCodexController({ generate, edit }),
			resolveCodexImageRoute,
		});
		const exec = fakeExec({
			agent: fakeAgent({
				options: { provider: "codex-oauth", model: "gpt-5.4" },
				header: { provider: "codex-oauth", model: "gpt-5.4" },
			}),
		});
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
		expect(resolveCodexImageRoute).not.toHaveBeenCalled();
		expect(imagine.generateImage).not.toHaveBeenCalled();
		expect(imagine.startVideo).not.toHaveBeenCalled();
		expect(imagine.videoStatus).not.toHaveBeenCalled();
	});

	it("re-checks live flags after the tools already exist", async () => {
		let settings = enabledSettings();
		const generate = vi.fn();
		const tools = await createCapabilityTools({
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
		const tools = await createCapabilityTools({
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
		const tools = await createCapabilityTools({
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
		const tools = await createCapabilityTools({
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
				agent: fakeAgent({
					options: { provider: "codex-oauth", model: "gpt-5.4" },
					deriveMessages,
				}),
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
		const tools = await createCapabilityTools({
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
		const tools = await createCapabilityTools({
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
		const resolveCodexImageRoute = vi.fn(async () => ({
			provider: "codex-oauth",
			model: "gpt-5.4",
			inputModalities: ["text", "image"],
		}));
		const tools = await createCapabilityTools({
			current: () => enabledSettings({ codexImages: false, grokImagineVideo: false }),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine,
			createCodexController: () => fakeCodexController({ edit }),
			resolveCodexImageRoute,
		});
		await expect(
			toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
				{ prompt: "blue", imageIds: ["owned"] },
				fakeExec({
					agent: fakeAgent({
						options: { provider: "codex-oauth", model: "gpt-5.4" },
						deriveMessages: () => [],
					}),
				}),
			),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		await expect(
			toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: "req_video_1" }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringContaining("disabled") });
		expect(edit).not.toHaveBeenCalled();
		expect(resolveCodexImageRoute).not.toHaveBeenCalled();
		expect(imagine.videoStatus).not.toHaveBeenCalled();
	});
});

describe("Codex image route resolution", () => {
	it("prefers requestHeader.config over agent.options and falls back when the header is absent", () => {
		expect(
			callingRouteIdentity(
				fakeExec({
					agent: fakeAgent({
						options: { provider: "codex-oauth", model: "gpt-5.4" },
						header: { provider: "codex-oauth", model: "gpt-5.3-codex-spark" },
					}),
				}),
			),
		).toEqual({ provider: "codex-oauth", model: "gpt-5.3-codex-spark" });
		expect(
			callingRouteIdentity(
				fakeExec({
					agent: fakeAgent({ options: { provider: "codex-oauth-fast", model: "gpt-5.4" } }),
				}),
			),
		).toEqual({ provider: "codex-oauth-fast", model: "gpt-5.4" });
		expect(callingRouteIdentity(fakeExec())).toBeUndefined();
		expect(
			callingRouteIdentity(fakeExec({ agent: fakeAgent({ options: { provider: "codex-oauth" } }) })),
		).toBeUndefined();
	});

	it("copies authoritative modalities and omits them when lookup fails", async () => {
		const exec = fakeExec({
			agent: fakeAgent({ options: { provider: "codex-oauth", model: "gpt-5.4" } }),
		});
		const resolveModelInfo = vi.fn(async () => ({ inputModalities: ["text", "image"] as const }));
		await expect(resolveCodexImageRouteFromLlm(exec, resolveModelInfo)).resolves.toEqual({
			provider: "codex-oauth",
			model: "gpt-5.4",
			inputModalities: ["text", "image"],
		});
		expect(resolveModelInfo).toHaveBeenCalledWith("codex-oauth", "gpt-5.4", exec.signal);

		await expect(
			resolveCodexImageRouteFromLlm(exec, async () => {
				throw new Error("UNKNOWN_MODEL");
			}),
		).resolves.toEqual({ provider: "codex-oauth", model: "gpt-5.4" });
		await expect(resolveCodexImageRouteFromLlm(exec, async () => ({}))).resolves.toEqual({
			provider: "codex-oauth",
			model: "gpt-5.4",
		});
		await expect(resolveCodexImageRouteFromLlm(fakeExec(), resolveModelInfo)).resolves.toBeUndefined();
	});

	it("fails the real controller closed without a resolver, identity, or image modality", async () => {
		const attachments = fakeAttachments();
		const tools = await createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments,
			imagine: fakeImagine(),
		});
		const generate = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL);
		await expect(generate.execute({ prompt: "cube" }, fakeExec())).rejects.toMatchObject({
			code: "UNSUPPORTED_CONTENT",
		});

		const resolveModelInfo = vi.fn(async (provider: string, model: string) => {
			if (model === "gpt-5.3-codex-spark") return { inputModalities: ["text"] as const };
			if (provider === "grok-build") return { inputModalities: ["text", "image"] as const };
			throw new Error("UNKNOWN_MODEL");
		});
		const gated = await createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments,
			imagine: fakeImagine(),
			resolveCodexImageRoute: (exec) => resolveCodexImageRouteFromLlm(exec, resolveModelInfo),
		});
		const gatedGenerate = toolByName(gated, CODEX_IMAGE_GENERATE_TOOL);
		await expect(
			gatedGenerate.execute(
				{ prompt: "cube" },
				fakeExec({
					agent: fakeAgent({
						options: { provider: "codex-oauth", model: "gpt-5.4" },
						header: { provider: "codex-oauth", model: "gpt-5.3-codex-spark" },
					}),
				}),
			),
		).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		expect(resolveModelInfo).toHaveBeenCalledWith("codex-oauth", "gpt-5.3-codex-spark", expect.any(AbortSignal));
		await expect(
			gatedGenerate.execute(
				{ prompt: "cube" },
				fakeExec({ agent: fakeAgent({ options: { provider: "grok-build", model: "grok-4.6" } }) }),
			),
		).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		await expect(
			gatedGenerate.execute(
				{ prompt: "cube" },
				fakeExec({ agent: fakeAgent({ options: { provider: "codex-oauth", model: "missing" } }) }),
			),
		).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
		expect(attachments.saveImage).not.toHaveBeenCalled();
	});

	it("passes the live any-model policy per execution and restores the strict gate immediately", async () => {
		let current = enabledSettings({ codexImagesAnyModel: true });
		const policies: string[] = [];
		const tools = await createCapabilityTools({
			current: () => current,
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController: (_session, policy) => {
				policies.push(policy);
				return fakeCodexController();
			},
			resolveCodexImageRoute: async () => ({ provider: "deepseek", model: "deepseek-v4", inputModalities: ["text"] }),
		});
		const generate = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL);
		await generate.execute({ prompt: "allowed" }, fakeExec());
		current = enabledSettings({ codexImagesAnyModel: false });
		await generate.execute({ prompt: "strict" }, fakeExec());
		expect(policies).toEqual(["any", "codex-capable"]);
	});

	it("forwards the resolved route without inventing modalities and keeps edit ownership", async () => {
		const sessions: CodexImageSessionContext[] = [];
		const deriveMessages = vi.fn(() => [
			{
				content: [
					{ type: "image", attachment: imageRef("owned") },
					{ type: "tool-result", content: [{ type: "image", attachment: imageRef("nested") }] },
				],
			},
		]);
		const generate = vi.fn<CodexImageController["generate"]>(async () => ({
			operation: "generate",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("generated")],
			references: [],
			warnings: [],
		}));
		const edit = vi.fn<CodexImageController["edit"]>(async () => ({
			operation: "edit",
			model: CODEX_IMAGE_MODEL,
			images: [imageRef("edited")],
			references: [imageRef("owned")],
			warnings: [],
		}));
		const resolveModelInfo = vi.fn(async () => ({ inputModalities: ["image"] as const }));
		const tools = await createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine(),
			createCodexController: (session) => {
				sessions.push(session);
				return fakeCodexController({ generate, edit });
			},
			resolveCodexImageRoute: (exec) => resolveCodexImageRouteFromLlm(exec, resolveModelInfo),
		});
		const signal = new AbortController().signal;
		await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute(
			{ prompt: "cube" },
			fakeExec({
				signal,
				agent: fakeAgent({
					options: { provider: "codex-oauth", model: "gpt-5.4" },
					header: { provider: "openai-codex", model: "gpt-5.5" },
				}),
			}),
		);
		expect(sessions[0]?.deriveMessages()).toEqual([]);
		expect(sessions[0]?.route).toEqual({
			provider: "openai-codex",
			model: "gpt-5.5",
			inputModalities: ["image"],
		});
		expect(resolveModelInfo).toHaveBeenCalledWith("openai-codex", "gpt-5.5", signal);

		await toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
			{ prompt: "blue", imageIds: ["owned"] },
			fakeExec({
				agent: fakeAgent({
					options: { provider: "codex-oauth-fast", model: "gpt-5.4" },
					deriveMessages,
				}),
			}),
		);
		expect(sessions[1]?.deriveMessages()).toEqual(deriveMessages.mock.results[0]?.value);
		expect(sessions[1]?.route).toEqual({
			provider: "codex-oauth-fast",
			model: "gpt-5.4",
			inputModalities: ["image"],
		});
		expect(edit).toHaveBeenCalledWith(expect.objectContaining({ imageIds: ["owned"] }), expect.any(AbortSignal));
	});
});

describe("Imagine tool signal threading", () => {
	it("forwards exec.signal into every Imagine client method", async () => {
		const captured: Array<AbortSignal | undefined> = [];
		const fakeImagineClient: CapabilityImagineClient = {
			generateImage: vi.fn(async (_input, signal) => {
				captured.push(signal);
				return leakyImagineImage();
			}),
			startVideo: vi.fn(async (_input, signal) => {
				captured.push(signal);
				return leakyVideoStart();
			}),
			videoStatus: vi.fn(async (_requestId, options) => {
				captured.push(options?.signal);
				return leakyVideoStatus();
			}),
		};
		const tools = await createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagineClient,
		});
		const controller = new AbortController();
		const exec = {
			...fakeExec({ signal: controller.signal }),
		};
		await toolByName(tools, "grok_imagine_image").execute({ prompt: "x" }, exec);
		await toolByName(tools, "grok_imagine_video").execute({ prompt: "x" }, exec);
		await toolByName(tools, "grok_imagine_video_status").execute({ requestId: "req_video_1" }, exec);
		expect(captured).toHaveLength(3);
		expect(captured.every((s) => s === controller.signal)).toBe(true);
	});

	it("rejects video status before the client sees a non-conforming requestId", async () => {
		const imagineVideoStatus = vi.fn(async () => leakyVideoStatus());
		const tools = await createCapabilityTools({
			current: () => enabledSettings(),
			auth: fakeAuth(),
			attachments: fakeAttachments(),
			imagine: fakeImagine({ videoStatus: imagineVideoStatus }),
		});
		await expect(
			toolByName(tools, "grok_imagine_video_status").execute({ requestId: "../escape" }, fakeExec()),
		).rejects.toMatchObject({ message: expect.stringMatching(/safe ASCII identifier/) });
		expect(imagineVideoStatus).not.toHaveBeenCalled();
	});
});

describe("runtime capability bounds", () => {
	it("pins the prompt-length and imageIds limits enforced before upstream calls", () => {
		// The host value-schema DSL does not support length constraints, so the
		// client/runtime validators are authoritative and these constants keep
		// their documented limits from drifting accidentally.
		expect(IMAGINE_PROMPT_MAX_LENGTH).toBe(4000);
		expect(IMAGINE_IMAGE_IDS_MIN).toBe(1);
		expect(IMAGINE_IMAGE_IDS_MAX).toBe(5);
	});
});

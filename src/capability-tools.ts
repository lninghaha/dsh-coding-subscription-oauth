/**
 * Optional Codex / Grok Imagine tool definitions. The factory only returns
 * public `ToolDefinition` objects — it never registers on `ctx.tools`.
 * Feature flags and `imageCount` are re-read from `current()` at execute time.
 * @module dsh-coding-subscription-oauth/capability-tools
 */

import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import { LlmError } from "@deepseek-ai/dsh-llm";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { CAPABILITY_SETTINGS_BOUNDS, type CapabilitySettings } from "./capability-settings.ts";
import type { CodexAuthSession } from "./codex-http.ts";
import {
	CODEX_IMAGE_BACKGROUNDS,
	CODEX_IMAGE_MODEL,
	CODEX_IMAGE_QUALITIES,
	CODEX_IMAGE_SIZES,
	type CodexImageAttachmentStore,
	type CodexImageBackground,
	type CodexImageController,
	type CodexImageQuality,
	type CodexImageResult,
	type CodexImageRoute,
	type CodexImageSessionContext,
	type CodexImageSize,
	createCodexImageController,
} from "./codex-images.ts";
import {
	type GenerateImagineImageInput,
	GROK_IMAGINE_IMAGE_MODEL,
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_MODEL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	type GrokImagineClient,
	IMAGINE_IMAGE_ASPECT_RATIOS,
	IMAGINE_IMAGE_RESOLUTIONS,
	IMAGINE_VIDEO_ASPECT_RATIOS,
	IMAGINE_VIDEO_MAX_DURATION_SECONDS,
	IMAGINE_VIDEO_MIN_DURATION_SECONDS,
	IMAGINE_VIDEO_RESOLUTIONS,
	type ImagineImageAspectRatio,
	type ImagineImageResolution,
	type ImagineImageResult,
	type ImagineVideoAspectRatio,
	type ImagineVideoResolution,
	type ImagineVideoStartResult,
	type ImagineVideoStatusResult,
	imagineImagePath,
	type StartImagineVideoInput,
} from "./grok-imagine.ts";
import { imagineMediaPath, type MediaArtifactMeta } from "./media-store.ts";

export const CODEX_IMAGE_GENERATE_TOOL = "codex_image_generate";
export const CODEX_IMAGE_EDIT_TOOL = "codex_image_edit";

export {
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
} from "./grok-imagine.ts";

const IMAGE_COUNT_VALUES = [1, 2, 3, 4] as const;
const VIDEO_DURATION_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const IMAGINE_IMAGE_PREFIX = "/plugins/dsh-grok-build/imagine/images/";
const IMAGINE_MEDIA_PREFIX = "/plugins/dsh-grok-build/imagine/media/";

/** Shared client surface; production passes one `GrokImagineClient` so video status can see started jobs. */
export type CapabilityImagineClient = Pick<GrokImagineClient, "generateImage" | "startVideo" | "videoStatus">;

/** Per-exec Codex controller factory. Tests inject a fake; production binds auth + attachments. */
export type CreateCodexImageController = (session: CodexImageSessionContext) => CodexImageController;

/** Resolve authoritative host model metadata for the calling route. */
export type ResolveCodexImageRoute = (exec: ToolRunContext) => Promise<CodexImageRoute | undefined>;

/** Exact provider/model identity from the live request header, then agent options. */
export function callingRouteIdentity(exec: ToolRunContext): { provider: string; model: string } | undefined {
	const session = exec.agent?.session;
	const header =
		session !== undefined && typeof session.requestHeader === "function" ? session.requestHeader()?.config : undefined;
	const provider = header?.provider ?? exec.agent?.options.provider;
	const model = header?.model ?? exec.agent?.options.model;
	if (typeof provider !== "string" || provider.length === 0) return undefined;
	if (typeof model !== "string" || model.length === 0) return undefined;
	return { provider, model };
}

/**
 * Copy host-resolved modalities onto the calling identity. Never invents
 * `inputModalities`; lookup failures keep the identity and omit the field so
 * the image-capability gate fails closed.
 */
export async function resolveCodexImageRouteFromLlm(
	exec: ToolRunContext,
	resolveModelInfo: (
		provider: string,
		model: string,
		signal?: AbortSignal,
	) => Promise<{ inputModalities?: readonly string[] }>,
): Promise<CodexImageRoute | undefined> {
	const identity = callingRouteIdentity(exec);
	if (identity === undefined) return undefined;
	try {
		const info = await resolveModelInfo(identity.provider, identity.model, exec.signal);
		const modalities = info.inputModalities;
		return {
			...identity,
			...(Array.isArray(modalities) ? { inputModalities: [...modalities] } : {}),
		};
	} catch {
		return identity;
	}
}

export interface CapabilityToolsOptions {
	/** Live capability section. Re-read on every execute so a disable takes effect immediately. */
	current(): CapabilitySettings;
	readonly auth: CodexAuthSession;
	readonly attachments: CodexImageAttachmentStore;
	readonly imagine: CapabilityImagineClient;
	readonly createCodexController?: CreateCodexImageController;
	readonly resolveCodexImageRoute?: ResolveCodexImageRoute;
}

const attachmentRefSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		attachmentId: { type: "string" as const, required: true as const },
		mediaType: { type: "string" as const, required: true as const },
		bytes: { type: "integer" as const, required: true as const },
		width: { type: "integer" as const, required: true as const },
		height: { type: "integer" as const, required: true as const },
		name: { type: "string" as const },
	},
};

const warningSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		index: { type: "integer" as const, required: true as const },
		code: { type: "string" as const, required: true as const },
		message: { type: "string" as const, required: true as const },
	},
};

const artifactSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		artifactId: { type: "string" as const, required: true as const },
		mediaType: { type: "string" as const, required: true as const },
		bytes: { type: "integer" as const, required: true as const },
		createdAt: { type: "integer" as const, required: true as const },
		expiresAt: { type: "integer" as const, required: true as const },
		name: { type: "string" as const },
	},
};

const imagineImageItemSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		attachment: { ...attachmentRefSchema, required: true as const },
		path: { type: "string" as const, required: true as const },
	},
};

function disabled(name: string): never {
	throw new LlmError(`${name} is disabled`, "INVALID_ARGS");
}

function imageCountLimit(settings: CapabilitySettings): number {
	const value = settings.imageCount;
	if (!Number.isSafeInteger(value) || value < CAPABILITY_SETTINGS_BOUNDS.imageCount.min) {
		return CAPABILITY_SETTINGS_BOUNDS.imageCount.default;
	}
	return Math.min(value, CAPABILITY_SETTINGS_BOUNDS.imageCount.max);
}

function resolveImageCount(n: number | undefined, settings: CapabilitySettings): number {
	const limit = imageCountLimit(settings);
	const value = n ?? limit;
	if (!Number.isSafeInteger(value) || value < 1 || value > limit) {
		throw new LlmError(`n cannot exceed the configured imageCount (${String(limit)})`, "INVALID_ARGS");
	}
	return value;
}

async function routeFromExec(
	exec: ToolRunContext,
	resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageRoute | undefined> {
	if (resolve === undefined) return undefined;
	try {
		const resolved = await resolve(exec);
		if (resolved === undefined) return undefined;
		const modalities = resolved.inputModalities;
		return {
			...(typeof resolved.provider === "string" && resolved.provider.length > 0 ? { provider: resolved.provider } : {}),
			...(typeof resolved.model === "string" && resolved.model.length > 0 ? { model: resolved.model } : {}),
			...(Array.isArray(modalities) ? { inputModalities: [...modalities] } : {}),
		};
	} catch {
		return undefined;
	}
}

async function generateSession(
	exec: ToolRunContext,
	resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageSessionContext> {
	const route = await routeFromExec(exec, resolve);
	return {
		deriveMessages: () => [],
		...(route === undefined ? {} : { route }),
	};
}

async function requireEditSession(
	exec: ToolRunContext,
	resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageSessionContext> {
	const session = exec.agent?.session;
	if (session === undefined || typeof session.deriveMessages !== "function") {
		throw new LlmError("codex_image_edit requires an active agent session", "INVALID_ARGS");
	}
	const route = await routeFromExec(exec, resolve);
	return {
		deriveMessages: () => session.deriveMessages(),
		...(route === undefined ? {} : { route }),
	};
}

function publicPluginPath(path: string | undefined, fallback: string, prefix: string): string {
	if (typeof path === "string" && path.startsWith(prefix)) return path;
	return fallback;
}

function publicAttachmentRef(ref: {
	attachmentId: string;
	mediaType: string;
	bytes: number;
	width: number;
	height: number;
	name?: string;
}): ImageAttachmentRef {
	return {
		attachmentId: ref.attachmentId as ImageAttachmentRef["attachmentId"],
		mediaType: ref.mediaType as ImageAttachmentRef["mediaType"],
		bytes: ref.bytes,
		width: ref.width,
		height: ref.height,
		...(ref.name === undefined ? {} : { name: ref.name }),
	};
}

function publicArtifact(meta: MediaArtifactMeta): MediaArtifactMeta {
	return {
		artifactId: meta.artifactId,
		mediaType: meta.mediaType,
		bytes: meta.bytes,
		createdAt: meta.createdAt,
		expiresAt: meta.expiresAt,
		...(meta.name === undefined ? {} : { name: meta.name }),
	};
}

function publicCodexResult<const Operation extends "generate" | "edit">(
	result: CodexImageResult & { operation: Operation },
): {
	operation: Operation;
	model: typeof CODEX_IMAGE_MODEL;
	images: ImageAttachmentRef[];
	references: ImageAttachmentRef[];
	warnings: Array<{ index: number; code: string; message: string }>;
} {
	return {
		operation: result.operation,
		model: CODEX_IMAGE_MODEL,
		images: result.images.map(publicAttachmentRef),
		references: result.references.map(publicAttachmentRef),
		warnings: result.warnings.map((warning) => ({
			index: warning.index,
			code: warning.code,
			message: warning.message,
		})),
	};
}

function publicImagineImageResult(result: ImagineImageResult): {
	model: string;
	images: Array<{ attachment: ImageAttachmentRef; path: string }>;
	attachment: ImageAttachmentRef;
	path: string;
} {
	const images = result.images.map((image) => {
		const attachment = publicAttachmentRef(image.attachment);
		return {
			attachment,
			path: publicPluginPath(image.path, imagineImagePath(String(attachment.attachmentId)), IMAGINE_IMAGE_PREFIX),
		};
	});
	const first = images[0];
	const fallback = first ?? {
		attachment: publicAttachmentRef(result.attachment),
		path: publicPluginPath(result.path, imagineImagePath(String(result.attachment.attachmentId)), IMAGINE_IMAGE_PREFIX),
	};
	return {
		model: GROK_IMAGINE_IMAGE_MODEL,
		images,
		attachment: fallback.attachment,
		path: fallback.path,
	};
}

function publicVideoStart(result: ImagineVideoStartResult): ImagineVideoStartResult {
	return {
		model: GROK_IMAGINE_VIDEO_MODEL,
		requestId: result.requestId,
		status: "pending",
	};
}

function publicVideoStatus(result: ImagineVideoStatusResult): {
	readonly requestId: string;
	readonly status: ImagineVideoStatusResult["status"];
	readonly artifact?: MediaArtifactMeta;
	readonly path?: string;
	readonly error?: string;
} {
	const artifact = result.artifact === undefined ? undefined : publicArtifact(result.artifact);
	const path =
		artifact === undefined
			? undefined
			: publicPluginPath(result.path, imagineMediaPath(artifact.artifactId), IMAGINE_MEDIA_PREFIX);
	return {
		requestId: result.requestId,
		status: result.status,
		...(artifact === undefined ? {} : { artifact }),
		...(path === undefined ? {} : { path }),
		...(typeof result.error === "string" ? { error: result.error } : {}),
	};
}

function renderImageRefs(
	summary: string,
	refs: readonly {
		attachmentId: string;
		mediaType: string;
		bytes: number;
		width: number;
		height: number;
		name?: string;
	}[],
) {
	return [
		{ type: "text" as const, text: summary },
		...refs.map((ref) => ({ type: "image" as const, attachment: publicAttachmentRef(ref) })),
	];
}

/**
 * Build the five optional capability tools. Callers register the returned
 * definitions; this function has no Cordis / registry side effects. The tools
 * peer is loaded only after Cordis has composed the optional `tools` service.
 */
export async function createCapabilityTools(options: CapabilityToolsOptions): Promise<readonly ToolDefinition[]> {
	const { defineTool } = await import("@deepseek-ai/dsh-tools");
	const createController: CreateCodexImageController =
		options.createCodexController ??
		((session) =>
			createCodexImageController({
				auth: options.auth,
				attachments: options.attachments,
				session,
			}));

	const generate = defineTool({
		name: CODEX_IMAGE_GENERATE_TOOL,
		description:
			"Generate images with the signed-in Codex subscription. Uses the fixed gpt-image-2 model. Does not accept a model id or image URL.",
		parameters: {
			prompt: { type: "string", required: true, description: "Image generation prompt." },
			n: {
				type: "integer",
				enum: [...IMAGE_COUNT_VALUES],
				description: "How many images to generate. Defaults to the live imageCount setting and cannot exceed it.",
			},
			size: { type: "string", enum: [...CODEX_IMAGE_SIZES], description: "Output size. Defaults to auto." },
			quality: { type: "string", enum: [...CODEX_IMAGE_QUALITIES], description: "Output quality. Defaults to auto." },
			background: {
				type: "string",
				enum: [...CODEX_IMAGE_BACKGROUNDS],
				description: "Background mode. Defaults to auto.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					operation: { type: "string", required: true, enum: ["generate"] },
					model: { type: "string", required: true },
					images: { type: "array", required: true, items: attachmentRefSchema },
					references: { type: "array", required: true, items: attachmentRefSchema },
					warnings: { type: "array", required: true, items: warningSchema },
				},
			},
			render: (_args, value) =>
				renderImageRefs(`Generated ${String(value.images.length)} Codex image(s) with ${value.model}.`, value.images),
		},
		async execute(args, exec) {
			const settings = options.current();
			if (!settings.codexImages) disabled(CODEX_IMAGE_GENERATE_TOOL);
			const n = resolveImageCount(args.n, settings);
			const result = await createController(await generateSession(exec, options.resolveCodexImageRoute)).generate(
				{
					prompt: args.prompt,
					n,
					...(args.size === undefined ? {} : { size: args.size as CodexImageSize }),
					...(args.quality === undefined ? {} : { quality: args.quality as CodexImageQuality }),
					...(args.background === undefined ? {} : { background: args.background as CodexImageBackground }),
				},
				exec.signal,
			);
			return publicCodexResult({ ...result, operation: "generate" });
		},
	});

	const edit = defineTool({
		name: CODEX_IMAGE_EDIT_TOOL,
		description:
			"Edit current-session Codex images. imageIds must be canonical attachment ids visible in this session. Does not accept HTTP(S) URLs or a model id.",
		parameters: {
			prompt: { type: "string", required: true, description: "Edit instructions." },
			imageIds: {
				type: "array",
				required: true,
				items: { type: "string" },
				description: "Current-session image attachment ids (optionally image:<id>). URLs are rejected.",
			},
			n: {
				type: "integer",
				enum: [...IMAGE_COUNT_VALUES],
				description: "How many edited images to return. Defaults to the live imageCount setting and cannot exceed it.",
			},
			size: { type: "string", enum: [...CODEX_IMAGE_SIZES], description: "Output size. Defaults to auto." },
			quality: { type: "string", enum: [...CODEX_IMAGE_QUALITIES], description: "Output quality. Defaults to auto." },
			background: {
				type: "string",
				enum: [...CODEX_IMAGE_BACKGROUNDS],
				description: "Background mode. Defaults to auto.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					operation: { type: "string", required: true, enum: ["edit"] },
					model: { type: "string", required: true },
					images: { type: "array", required: true, items: attachmentRefSchema },
					references: { type: "array", required: true, items: attachmentRefSchema },
					warnings: { type: "array", required: true, items: warningSchema },
				},
			},
			render: (_args, value) =>
				renderImageRefs(`Edited ${String(value.images.length)} Codex image(s) with ${value.model}.`, value.images),
		},
		async execute(args, exec) {
			const settings = options.current();
			if (!settings.codexImageEdits || !settings.codexImages) disabled(CODEX_IMAGE_EDIT_TOOL);
			const n = resolveImageCount(args.n, settings);
			const result = await createController(await requireEditSession(exec, options.resolveCodexImageRoute)).edit(
				{
					prompt: args.prompt,
					imageIds: args.imageIds,
					n,
					...(args.size === undefined ? {} : { size: args.size as CodexImageSize }),
					...(args.quality === undefined ? {} : { quality: args.quality as CodexImageQuality }),
					...(args.background === undefined ? {} : { background: args.background as CodexImageBackground }),
				},
				exec.signal,
			);
			return publicCodexResult({ ...result, operation: "edit" });
		},
	});

	const imagineImage = defineTool({
		name: GROK_IMAGINE_IMAGE_TOOL,
		description:
			"Generate images with official xAI Imagine. Uses the fixed grok-imagine-image-2.0 model. Does not accept a model id or source URL.",
		parameters: {
			prompt: { type: "string", required: true, description: "Image generation prompt." },
			n: {
				type: "integer",
				enum: [...IMAGE_COUNT_VALUES],
				description: "How many images to generate. Defaults to the live imageCount setting and cannot exceed it.",
			},
			aspectRatio: {
				type: "string",
				enum: [...IMAGINE_IMAGE_ASPECT_RATIOS],
				description: "Optional Imagine image aspect ratio.",
			},
			resolution: {
				type: "string",
				enum: [...IMAGINE_IMAGE_RESOLUTIONS],
				description: "Optional Imagine image resolution.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					model: { type: "string", required: true },
					images: { type: "array", required: true, items: imagineImageItemSchema },
					attachment: { ...attachmentRefSchema, required: true },
					path: { type: "string", required: true },
				},
			},
			render: (_args, value) =>
				renderImageRefs(
					`Generated ${String(value.images.length)} Imagine image(s).`,
					value.images.map((image) => image.attachment),
				),
		},
		async execute(args) {
			const settings = options.current();
			if (!settings.grokImagineImage) disabled(GROK_IMAGINE_IMAGE_TOOL);
			const input: GenerateImagineImageInput = {
				prompt: args.prompt,
				n: resolveImageCount(args.n, settings),
				...(args.aspectRatio === undefined ? {} : { aspectRatio: args.aspectRatio as ImagineImageAspectRatio }),
				...(args.resolution === undefined ? {} : { resolution: args.resolution as ImagineImageResolution }),
			};
			return publicImagineImageResult(await options.imagine.generateImage(input));
		},
	});

	const imagineVideo = defineTool({
		name: GROK_IMAGINE_VIDEO_TOOL,
		description:
			"Start an official xAI Imagine video job. Uses the fixed grok-imagine-video-1.5 model. Poll status with grok_imagine_video_status and the returned requestId.",
		parameters: {
			prompt: { type: "string", required: true, description: "Video generation prompt." },
			duration: {
				type: "integer",
				enum: [...VIDEO_DURATION_VALUES],
				description: `Optional duration in seconds (${String(IMAGINE_VIDEO_MIN_DURATION_SECONDS)}-${String(IMAGINE_VIDEO_MAX_DURATION_SECONDS)}).`,
			},
			aspectRatio: {
				type: "string",
				enum: [...IMAGINE_VIDEO_ASPECT_RATIOS],
				description: "Optional Imagine video aspect ratio.",
			},
			resolution: {
				type: "string",
				enum: [...IMAGINE_VIDEO_RESOLUTIONS],
				description: "Optional Imagine video resolution.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					model: { type: "string", required: true },
					requestId: { type: "string", required: true },
					status: { type: "string", required: true, enum: ["pending"] },
				},
			},
			render: (_args, value) => [{ type: "text", text: `Imagine video job ${value.requestId} is ${value.status}.` }],
		},
		async execute(args) {
			const settings = options.current();
			if (!settings.grokImagineVideo) disabled(GROK_IMAGINE_VIDEO_TOOL);
			const input: StartImagineVideoInput = {
				prompt: args.prompt,
				...(args.duration === undefined ? {} : { duration: args.duration }),
				...(args.aspectRatio === undefined ? {} : { aspectRatio: args.aspectRatio as ImagineVideoAspectRatio }),
				...(args.resolution === undefined ? {} : { resolution: args.resolution as ImagineVideoResolution }),
			};
			return publicVideoStart(await options.imagine.startVideo(input));
		},
	});

	const imagineVideoStatus = defineTool({
		name: GROK_IMAGINE_VIDEO_STATUS_TOOL,
		description:
			"Poll a previously started Imagine video job by requestId. Completed results expose only an opaque artifact id and same-origin path.",
		parameters: {
			requestId: { type: "string", required: true, description: "Opaque request id returned by grok_imagine_video." },
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					requestId: { type: "string", required: true },
					status: { type: "string", required: true, enum: ["pending", "completed", "failed"] },
					artifact: artifactSchema,
					path: { type: "string" },
					error: { type: "string" },
				},
			},
			render: (_args, value) => {
				const detail =
					value.status === "completed" && value.path !== undefined
						? `Imagine video ${value.requestId} completed (${value.path}).`
						: `Imagine video ${value.requestId} is ${value.status}.`;
				return [{ type: "text", text: detail }];
			},
		},
		async execute(args) {
			const settings = options.current();
			if (!settings.grokImagineVideo) disabled(GROK_IMAGINE_VIDEO_STATUS_TOOL);
			return publicVideoStatus(await options.imagine.videoStatus(args.requestId));
		},
	});

	return [generate, edit, imagineImage, imagineVideo, imagineVideoStatus];
}

export const CAPABILITY_TOOL_NAMES = [
	CODEX_IMAGE_GENERATE_TOOL,
	CODEX_IMAGE_EDIT_TOOL,
	GROK_IMAGINE_IMAGE_TOOL,
	GROK_IMAGINE_VIDEO_TOOL,
	GROK_IMAGINE_VIDEO_STATUS_TOOL,
] as const;

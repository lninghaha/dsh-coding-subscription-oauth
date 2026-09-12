/** Pure derivation for the Codex image tool result view. */

export interface CodexImageAttachment {
	attachmentId: string;
	mediaType: string;
	bytes: number;
	width: number;
	height: number;
	name?: string;
}

export type CodexImageToolState = "running" | "error" | "empty" | "ready";

export interface CodexImageToolModel {
	state: CodexImageToolState;
	text: string;
	images: readonly CodexImageAttachment[];
	error?: string;
}

const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAttachment(value: unknown): CodexImageAttachment | undefined {
	if (!isRecord(value)) return undefined;
	const attachmentId = value["attachmentId"];
	const mediaType = value["mediaType"];
	const bytes = value["bytes"];
	const width = value["width"];
	const height = value["height"];
	if (typeof attachmentId !== "string" || attachmentId.length === 0) return undefined;
	if (typeof mediaType !== "string" || !IMAGE_MEDIA_TYPES.has(mediaType)) return undefined;
	if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return undefined;
	if (typeof width !== "number" || !Number.isSafeInteger(width) || width <= 0) return undefined;
	if (typeof height !== "number" || !Number.isSafeInteger(height) || height <= 0) return undefined;
	const name = value["name"];
	return {
		attachmentId,
		mediaType,
		bytes,
		width,
		height,
		...(typeof name === "string" && name.length > 0 ? { name } : {}),
	};
}

function walkContent(blocks: readonly unknown[], out: { texts: string[]; images: CodexImageAttachment[] }): void {
	for (const block of blocks) {
		if (!isRecord(block)) continue;
		if (block["type"] === "text" && typeof block["text"] === "string") {
			out.texts.push(block["text"]);
			continue;
		}
		if (block["type"] === "image") {
			const attachment = readAttachment(block["attachment"]);
			if (attachment !== undefined) out.images.push(attachment);
			continue;
		}
		if (block["type"] === "tool-result" && Array.isArray(block["content"])) {
			walkContent(block["content"], out);
		}
	}
}

function readError(block: Record<string, unknown>): string | undefined {
	const error = block["error"];
	if (!isRecord(error)) return undefined;
	const message = error["message"];
	if (typeof message === "string" && message.length > 0) return message;
	const name = error["name"];
	const code = error["code"];
	if (typeof name === "string" && typeof code === "string") return `${name}: ${code}`;
	if (typeof name === "string") return name;
	if (typeof code === "string") return code;
	return undefined;
}

/** Project one frozen tool call/result block into the image row model. */
export function codexImageToolModel(block: unknown): CodexImageToolModel {
	if (!isRecord(block)) return { state: "empty", text: "", images: [] };
	const content = Array.isArray(block["content"]) ? block["content"] : undefined;
	const isError = block["isError"] === true;
	if (content === undefined) {
		if (isError) {
			const error = readError(block);
			return { state: "error", text: error ?? "", images: [], ...(error === undefined ? {} : { error }) };
		}
		return { state: "running", text: "", images: [] };
	}
	const collected = { texts: [] as string[], images: [] as CodexImageAttachment[] };
	walkContent(content, collected);
	const text = collected.texts.join("\n").trim();
	if (isError) {
		const error = readError(block) ?? (text.length > 0 ? text : undefined);
		return { state: "error", text, images: collected.images, ...(error === undefined ? {} : { error }) };
	}
	if (collected.images.length > 0) return { state: "ready", text, images: collected.images };
	return { state: "empty", text, images: [] };
}

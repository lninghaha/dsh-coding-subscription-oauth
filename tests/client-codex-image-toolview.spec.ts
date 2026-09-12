import { describe, expect, it } from "vitest";
import { codexImageToolModel } from "../src/client/codexImageToolviewModel.ts";

const attachment = {
	attachmentId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	mediaType: "image/png",
	bytes: 1234,
	width: 1024,
	height: 1024,
	name: "codex-image-1.png",
};

describe("codex image toolview model", () => {
	it("treats a call without settled content as running", () => {
		expect(codexImageToolModel({ name: "codex_image_generate", argsRaw: "{}" })).toEqual({
			state: "running",
			text: "",
			images: [],
		});
	});

	it("extracts text and durable image references from a settled result", () => {
		const model = codexImageToolModel({
			isError: false,
			content: [
				{ type: "text", text: "Generated 1 Codex image with gpt-image-2." },
				{ type: "image", attachment },
			],
		});
		expect(model.state).toBe("ready");
		expect(model.text).toBe("Generated 1 Codex image with gpt-image-2.");
		expect(model.images).toEqual([attachment]);
	});

	it("walks nested tool-result content", () => {
		const model = codexImageToolModel({
			content: [{ type: "tool-result", content: [{ type: "image", attachment }] }],
		});
		expect(model.state).toBe("ready");
		expect(model.images).toHaveLength(1);
	});

	it("declines unsupported or incomplete image references", () => {
		const model = codexImageToolModel({
			content: [
				{ type: "image", attachment: { ...attachment, mediaType: "image/svg+xml" } },
				{ type: "image", attachment: { ...attachment, width: 0 } },
			],
		});
		expect(model.state).toBe("empty");
		expect(model.images).toEqual([]);
	});

	it("keeps the error message on failed calls", () => {
		const model = codexImageToolModel({
			isError: true,
			error: { name: "LlmError", code: "TIMEOUT", message: "Codex backend request aborted" },
			content: [{ type: "text", text: "ignored" }],
		});
		expect(model.state).toBe("error");
		expect(model.error).toBe("Codex backend request aborted");
	});
});

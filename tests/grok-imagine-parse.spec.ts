import { describe, expect, it } from "vitest";
import {
	clampImagineImageIds,
	GrokImagineError,
	IMAGINE_IMAGE_IDS_MAX,
	IMAGINE_IMAGE_ROUTE_PREFIX,
	isSafeImagineAttachmentId,
	parseImagineImagePath,
	parseVideoRequestId,
} from "../src/grok-imagine.ts";

describe("grok-imagine parse helpers", () => {
	it("accepts safe attachment ids and rejects path separators", () => {
		expect(isSafeImagineAttachmentId("sha256:abcdef0123456789")).toBe(true);
		expect(isSafeImagineAttachmentId("../etc/passwd")).toBe(false);
		expect(isSafeImagineAttachmentId("a/b")).toBe(false);
		expect(isSafeImagineAttachmentId("")).toBe(false);
	});

	it("parses same-origin imagine image paths", () => {
		const id = "sha256:abcdef0123456789";
		expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}${encodeURIComponent(id)}`)).toBe(id);
		expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}../escape`)).toBeUndefined();
		expect(parseImagineImagePath("/other/path")).toBeUndefined();
	});

	it("validates video request ids at the tool boundary", () => {
		expect(parseVideoRequestId("req_ABC-123")).toBe("req_ABC-123");
		expect(() => parseVideoRequestId("bad id")).toThrow(GrokImagineError);
		expect(() => parseVideoRequestId(42)).toThrow(GrokImagineError);
	});

	it("clamps imagine image id arrays", () => {
		expect(clampImagineImageIds(["a"])).toEqual(["a"]);
		expect(() => clampImagineImageIds([])).toThrow(GrokImagineError);
		expect(() => clampImagineImageIds(Array.from({ length: IMAGINE_IMAGE_IDS_MAX + 1 }, (_, i) => `id${i}`))).toThrow(
			GrokImagineError,
		);
		expect(() => clampImagineImageIds([""])).toThrow(GrokImagineError);
	});
});

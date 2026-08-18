import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTrustedImagineAuthz,
	IMAGINE_MEDIA_ROUTE_PREFIX,
	imagineMediaPath,
	isSafeMediaArtifactId,
	isTrustedImaginePeer,
	MEDIA_STORE_MAX_BYTES,
	MEDIA_STORE_RETENTION_MS,
	MediaStore,
	MediaStoreError,
	openTrustedMediaDownload,
	parseImagineMediaPath,
	parseMediaArtifactId,
} from "../../src/capability/media-store.ts";

const temporaryDirectories: string[] = [];
let clock = 1_700_000_000_000;

afterEach(async () => {
	clock = 1_700_000_000_000;
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function tempStore(options: ConstructorParameters<typeof MediaStore>[1] = {}): Promise<MediaStore> {
	const dir = await mkdtemp(join(tmpdir(), "dsh-media-store-"));
	temporaryDirectories.push(dir);
	return new MediaStore(dir, { now: () => clock, ...options });
}

function sampleVideo(tag = "clip"): Uint8Array {
	return new TextEncoder().encode(`ftypisom-test-video-${tag}-${"x".repeat(32)}`);
}

function digestOf(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

const trusted = () => createTrustedImagineAuthz({ authorized: true });

describe("MediaStore", () => {
	it("saves, looks up, and reads a content-addressed video under owner-only modes", async () => {
		const store = await tempStore();
		const data = sampleVideo();
		const digest = digestOf(data);
		const meta = await store.save({ data, mediaType: "video/mp4", name: "/tmp/unsafe/name.mp4" });

		expect(isSafeMediaArtifactId(meta.artifactId)).toBe(true);
		expect(meta.artifactId).not.toBe(digest);
		expect(meta).not.toHaveProperty("sha256");
		expect(meta.bytes).toBe(data.byteLength);
		expect(meta.mediaType).toBe("video/mp4");
		expect(meta.name).toBe("name.mp4");
		expect(meta.expiresAt - meta.createdAt).toBe(MEDIA_STORE_RETENTION_MS);
		expect(JSON.stringify(meta)).not.toContain(store.root);
		expect(JSON.stringify(meta)).not.toContain(digest);
		expect(JSON.stringify(meta)).not.toContain("objects/");

		const looked = await store.lookup(meta.artifactId);
		expect(looked).toEqual(meta);
		const stored = await store.read(meta.artifactId);
		expect(stored.data).toEqual(data);
		expect(stored.meta).not.toHaveProperty("sha256");

		if (process.platform !== "win32") {
			expect((await stat(store.root)).mode & 0o777).toBe(0o700);
			const object = join(store.root, "objects", digest.slice(0, 2), digest);
			const index = join(store.root, "index", meta.artifactId.slice(0, 2), `${meta.artifactId}.json`);
			expect((await stat(object)).mode & 0o777).toBe(0o600);
			expect((await stat(index)).mode & 0o777).toBe(0o600);
			expect((await stat(join(store.root, "objects"))).mode & 0o777).toBe(0o700);
			expect((await stat(join(store.root, "index"))).mode & 0o777).toBe(0o700);
		}
	});

	it("deduplicates bytes while issuing distinct opaque ids", async () => {
		const store = await tempStore();
		const data = sampleVideo("same");
		const first = await store.save({ data, mediaType: "video/mp4" });
		const second = await store.save({ data, mediaType: "video/webm" });
		expect(first.artifactId).not.toBe(second.artifactId);
		expect(await store.delete(first.artifactId)).toBe(true);
		expect((await store.read(second.artifactId)).data).toEqual(data);
	});

	it("rejects oversized, empty, and unsupported payloads", async () => {
		const store = await tempStore({ maxBytes: 16 });
		await expect(store.save({ data: new Uint8Array(), mediaType: "video/mp4" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(store.save({ data: new Uint8Array(17), mediaType: "video/mp4" })).rejects.toMatchObject({
			code: "TOO_LARGE",
		});
		await expect(store.save({ data: sampleVideo(), mediaType: "image/png" as "video/mp4" })).rejects.toMatchObject({
			code: "UNSUPPORTED_TYPE",
		});
		expect(store.maxBytes).toBe(16);
		expect(MEDIA_STORE_MAX_BYTES).toBe(256 * 1024 * 1024);
	});

	it("hard-clamps maxBytes and retention to the ship-safe ceilings", async () => {
		const store = await tempStore({
			maxBytes: MEDIA_STORE_MAX_BYTES * 4,
			maxTotalBytes: MEDIA_STORE_MAX_BYTES * 4,
			retentionMs: MEDIA_STORE_RETENTION_MS * 4,
		});
		expect(store.maxBytes).toBe(MEDIA_STORE_MAX_BYTES);
		expect(store.maxTotalBytes).toBe(MEDIA_STORE_MAX_BYTES);
		expect(store.retentionMs).toBe(MEDIA_STORE_RETENTION_MS);
	});

	it("caps aggregate unique object bytes while allowing deduplicated ids", async () => {
		const firstData = sampleVideo("quota-first");
		const secondData = sampleVideo("quota-second");
		const store = await tempStore({
			maxBytes: Math.max(firstData.byteLength, secondData.byteLength),
			maxTotalBytes: firstData.byteLength,
		});
		const first = await store.save({ data: firstData, mediaType: "video/mp4" });
		const duplicate = await store.save({ data: firstData, mediaType: "video/webm" });
		expect(duplicate.artifactId).not.toBe(first.artifactId);
		await expect(store.save({ data: secondData, mediaType: "video/mp4" })).rejects.toMatchObject({
			code: "TOO_LARGE",
		});
	});

	it("cleans expired objects before enforcing the aggregate quota", async () => {
		const firstData = sampleVideo("quota-expired");
		const secondData = sampleVideo("quota-fresh");
		const store = await tempStore({
			maxBytes: Math.max(firstData.byteLength, secondData.byteLength),
			maxTotalBytes: Math.max(firstData.byteLength, secondData.byteLength),
			retentionMs: 10,
		});
		await store.save({ data: firstData, mediaType: "video/mp4" });
		clock += 11;
		await expect(store.save({ data: secondData, mediaType: "video/mp4" })).resolves.toMatchObject({
			bytes: secondData.byteLength,
		});
	});

	it("shortens existing retention live without resurrecting it, while raises affect only new artifacts", async () => {
		const store = await tempStore({ retentionMs: 100 });
		const first = await store.save({ data: sampleVideo("first"), mediaType: "video/mp4" });
		clock += 10;
		await expect(store.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 });
		expect(await store.lookup(first.artifactId)).toMatchObject({ expiresAt: first.createdAt + 20 });

		await store.applyRetentionMs(200);
		expect(await store.lookup(first.artifactId)).toMatchObject({ expiresAt: first.createdAt + 20 });
		const second = await store.save({ data: sampleVideo("second"), mediaType: "video/mp4" });
		expect(second.expiresAt - second.createdAt).toBe(200);

		clock += 11;
		expect(await store.lookup(first.artifactId)).toBeUndefined();
		expect(await store.lookup(second.artifactId)).toMatchObject({ artifactId: second.artifactId });
		await store.applyRetentionMs(MEDIA_STORE_RETENTION_MS * 2);
		expect(store.retentionMs).toBe(MEDIA_STORE_RETENTION_MS);
		await expect(store.applyRetentionMs(0)).rejects.toThrow(/positive finite/iu);
	});

	it("immediately deletes artifacts made stale by a lower live retention ceiling", async () => {
		const store = await tempStore({ retentionMs: 100 });
		const meta = await store.save({ data: sampleVideo("retention-expired"), mediaType: "video/webm" });
		clock += 50;
		await expect(store.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 1, removedObjects: 1 });
		expect(await store.lookup(meta.artifactId)).toBeUndefined();
	});

	it("reconciles persisted expiries on the first equal retention update after startup", async () => {
		const original = await tempStore({ retentionMs: 100 });
		const meta = await original.save({ data: sampleVideo("retention-restart"), mediaType: "video/mp4" });
		clock += 50;
		const restarted = new MediaStore(original.root, { now: () => clock, retentionMs: 20 });
		await expect(restarted.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 1, removedObjects: 1 });
		expect(await restarted.lookup(meta.artifactId)).toBeUndefined();
	});

	it("treats expired and unknown ids as missing and refuses path-shaped lookups", async () => {
		const store = await tempStore({ retentionMs: 10 });
		const meta = await store.save({ data: sampleVideo("exp"), mediaType: "video/webm" });
		clock += 11;
		expect(await store.lookup(meta.artifactId)).toBeUndefined();
		await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: "EXPIRED" });
		expect(await store.lookup("../objects/ab")).toBeUndefined();
		expect(await store.lookup("not-hex")).toBeUndefined();
		expect(await store.lookup(`${meta.artifactId}/../${meta.artifactId}`)).toBeUndefined();
		await expect(store.read("../secret")).rejects.toMatchObject({ code: "INVALID_ID" });
		expect(await store.delete("../secret")).toBe(false);
	});

	it("cleans expired indexes before save and deletes a live artifact", async () => {
		const store = await tempStore({ retentionMs: 10 });
		const live = await store.save({ data: sampleVideo("live"), mediaType: "video/mp4" });
		const stale = await store.save({ data: sampleVideo("stale"), mediaType: "video/mp4" });
		clock += 11;
		const refreshed = await store.save({ data: sampleVideo("fresh"), mediaType: "video/mp4" });
		const report = await store.cleanup();
		expect(report.expiredArtifacts).toBe(0);
		expect(await store.lookup(live.artifactId)).toBeUndefined();
		expect(await store.lookup(stale.artifactId)).toBeUndefined();
		expect(await store.lookup(refreshed.artifactId)).toMatchObject({ artifactId: refreshed.artifactId });
		expect(await store.delete(refreshed.artifactId)).toBe(true);
		expect(await store.lookup(refreshed.artifactId)).toBeUndefined();
	});

	it("detects a corrupt object after the index is rewritten", async () => {
		const store = await tempStore();
		const data = sampleVideo("corrupt");
		const meta = await store.save({ data, mediaType: "video/mp4" });
		const digest = digestOf(data);
		const object = join(store.root, "objects", digest.slice(0, 2), digest);
		await writeFile(object, "tampered", { mode: 0o600 });
		await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: "CORRUPT" });
	});

	it("exposes trusted same-origin download primitives without hashes or upstream URLs", async () => {
		const store = await tempStore();
		const meta = await store.save({ data: sampleVideo("dl"), mediaType: "video/webm" });
		const path = imagineMediaPath(meta.artifactId);
		expect(path).toBe(`${IMAGINE_MEDIA_ROUTE_PREFIX}${meta.artifactId}`);
		expect(parseImagineMediaPath(path)).toBe(meta.artifactId);
		expect(parseImagineMediaPath(`${IMAGINE_MEDIA_ROUTE_PREFIX}../${meta.artifactId}`)).toBeUndefined();
		expect(parseMediaArtifactId(meta.artifactId)).toBe(meta.artifactId);

		await expect(openTrustedMediaDownload(store, meta.artifactId, {} as never)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(() => createTrustedImagineAuthz({ remoteAddress: "10.0.0.2" })).toThrow(MediaStoreError);

		const view = await openTrustedMediaDownload(store, meta.artifactId, trusted());
		expect(view.body).toEqual(sampleVideo("dl"));
		expect(view.headers["Content-Type"]).toBe("video/webm");
		expect(view.headers["Content-Disposition"]).toContain(`imagine-${meta.artifactId}.webm`);
		expect(view.headers["Cache-Control"]).toContain("no-store");
		expect(view.meta).not.toHaveProperty("sha256");
		expect(JSON.stringify(view.headers)).not.toMatch(/https?:\/\//);
		expect(JSON.stringify(view.meta)).not.toMatch(/https?:\/\//);
		expect(JSON.stringify(view.meta)).not.toMatch(/[a-f0-9]{64}/);
		expect(JSON.stringify(view.meta)).not.toContain("objects/");
		await expect(openTrustedMediaDownload(store, "../x", trusted())).rejects.toMatchObject({ code: "INVALID_ID" });
	});

	it("classifies only loopback peers as trusted download clients", () => {
		expect(isTrustedImaginePeer("127.0.0.1")).toBe(true);
		expect(isTrustedImaginePeer("::1")).toBe(true);
		expect(isTrustedImaginePeer("::ffff:127.0.0.1")).toBe(true);
		expect(isTrustedImaginePeer("10.0.0.2")).toBe(false);
		expect(isTrustedImaginePeer(undefined)).toBe(false);
	});

	it("rejects a store rooted at an empty path", () => {
		expect(() => new MediaStore("")).toThrow(MediaStoreError);
	});

	it("still reads after an existing directory is widened then rewritten owner-only", async () => {
		const store = await tempStore();
		await mkdir(join(store.root, "objects"), { recursive: true, mode: 0o755 });
		const meta = await store.save({ data: sampleVideo("chmod"), mediaType: "video/mp4" });
		if (process.platform !== "win32") {
			expect((await stat(store.root)).mode & 0o777).toBe(0o700);
			await chmod(join(store.root, "index", meta.artifactId.slice(0, 2), `${meta.artifactId}.json`), 0o600);
		}
		expect((await store.read(meta.artifactId)).meta.artifactId).toBe(meta.artifactId);
		const indexText = await readFile(
			join(store.root, "index", meta.artifactId.slice(0, 2), `${meta.artifactId}.json`),
			"utf8",
		);
		expect(JSON.parse(indexText).version).toBe(1);
		expect(JSON.stringify(await store.lookup(meta.artifactId))).not.toContain(JSON.parse(indexText).sha256);
	});

	it("serializes concurrent saves that force the same id and never overwrites the winner", async () => {
		const forced = "aa".repeat(16);
		const store = await tempStore({ randomId: () => forced });
		const firstData = sampleVideo("force-a");
		const secondData = sampleVideo("force-b");
		const results = await Promise.allSettled([
			store.save({ data: firstData, mediaType: "video/mp4" }),
			store.save({ data: secondData, mediaType: "video/mp4" }),
		]);
		type Saved = Awaited<ReturnType<MediaStore["save"]>>;
		const fulfilled = results.filter((result): result is PromiseFulfilledResult<Saved> => {
			return result.status === "fulfilled";
		});
		const rejected = results.filter((result) => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INVALID_ID" });
		const winner = fulfilled[0]!.value;
		expect(winner.artifactId).toBe(forced);
		const stored = await store.read(forced);
		const matchesFirst = Buffer.from(stored.data).equals(Buffer.from(firstData));
		const matchesSecond = Buffer.from(stored.data).equals(Buffer.from(secondData));
		expect(matchesFirst || matchesSecond).toBe(true);
		expect(matchesFirst && matchesSecond).toBe(false);
	});

	it.skipIf(process.platform === "win32")("rejects a symlink store root and does not follow symlink dirs", async () => {
		const base = await mkdtemp(join(tmpdir(), "dsh-media-symlink-"));
		temporaryDirectories.push(base);
		const real = join(base, "real");
		const linked = join(base, "linked");
		await mkdir(real);
		await symlink(real, linked);
		const linkedStore = new MediaStore(linked, { now: () => clock });
		await expect(linkedStore.save({ data: sampleVideo("root"), mediaType: "video/mp4" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});

		const store = new MediaStore(join(base, "store"), { now: () => clock });
		const outside = join(base, "outside");
		await mkdir(outside);
		const secret = join(outside, "secret");
		await writeFile(secret, "do-not-delete");
		const first = await store.save({ data: sampleVideo("inside"), mediaType: "video/mp4" });
		await rm(join(store.root, "objects"), { recursive: true, force: true });
		await symlink(outside, join(store.root, "objects"));
		await expect(store.save({ data: sampleVideo("escape"), mediaType: "video/mp4" })).rejects.toMatchObject({
			code: "CORRUPT",
		});
		await expect(store.cleanup()).rejects.toMatchObject({ code: "CORRUPT" });
		expect(await readFile(secret, "utf8")).toBe("do-not-delete");
		expect(await store.lookup(first.artifactId)).toMatchObject({ artifactId: first.artifactId });
	});

	it.skipIf(process.platform === "win32")("refuses to follow a symlink index leaf", async () => {
		const store = await tempStore();
		const meta = await store.save({ data: sampleVideo("leaf"), mediaType: "video/mp4" });
		const index = join(store.root, "index", meta.artifactId.slice(0, 2), `${meta.artifactId}.json`);
		await rm(index);
		const outside = join(store.root, "..", `escape-${meta.artifactId}`);
		await writeFile(outside, '{"version":1}');
		await symlink(outside, index);
		expect(await store.lookup(meta.artifactId)).toBeUndefined();
		await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await readFile(outside, "utf8")).toBe('{"version":1}');
	});
});

describe("Content-Disposition filename sanitization", () => {
	it("emits a plain ASCII filename parameter for safe artifact ids", async () => {
		const store = await tempStore();
		const meta = await store.save({ data: sampleVideo("fname"), mediaType: "video/mp4" });
		const { mediaDownloadHeaders } = await import("../../src/capability/media-store.ts");
		const headers = mediaDownloadHeaders(meta);
		expect(headers["Content-Disposition"]).toBe(`attachment; filename="imagine-${meta.artifactId}.mp4"`);
		expect(headers["Content-Type"]).toBe("video/mp4");
		expect(headers["Cache-Control"]).toContain("no-store");
		expect(headers["X-Content-Type-Options"]).toBe("nosniff");
	});

	it("uses an ASCII fallback plus RFC 5987 for a requested Unicode or header-shaped name", async () => {
		const store = await tempStore();
		const meta = await store.save({
			data: sampleVideo("unsafe-name"),
			mediaType: "video/webm",
			name: '录屏";evil.webm',
		});
		const { mediaDownloadHeaders } = await import("../../src/capability/media-store.ts");
		const header = mediaDownloadHeaders(meta)["Content-Disposition"];
		expect(header).toMatch(/^attachment; filename="evil\.webm"; filename\*=UTF-8''/u);
		expect(header).toContain("%22%3B");
		expect(header).not.toContain("录屏");
		expect(header).not.toContain("\r");
		expect(header).not.toContain("\n");

		const unicodeOnly = await store.save({
			data: sampleVideo("unicode-name"),
			mediaType: "video/mp4",
			name: "视频",
		});
		const unicodeHeader = mediaDownloadHeaders(unicodeOnly)["Content-Disposition"];
		expect(unicodeHeader).toContain(`filename="imagine-${unicodeOnly.artifactId}.mp4"`);
		expect(unicodeHeader).toContain("filename*=UTF-8''");
	});
});

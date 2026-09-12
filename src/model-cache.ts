import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

/** 缓存选择和目录共享串行提交；失败不会阻止后续用户重试。 */
export class ModelCacheQueue {
	private pending: Promise<unknown> = Promise.resolve();
	run<T>(action: () => Promise<T>): Promise<T> {
		const next = this.pending.then(action);
		this.pending = next.catch(() => undefined);
		return next;
	}
}

export async function writeModelCache(file: string, document: object): Promise<void> {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	try {
		const old: unknown = JSON.parse(await readFile(file, "utf8"));
		if (typeof old === "object" && old !== null && !("selectionMode" in old)) {
			try {
				await copyFile(file, `${file}.pre-selection-mode`, constants.COPYFILE_EXCL);
				await chmod(`${file}.pre-selection-mode`, 0o600);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
	}
	await writeFileAtomic(file, `${JSON.stringify(document)}\n`, { mode: 0o600, dirMode: 0o700 });
}

/** Same-origin JSON helpers for the Coding OAuth plugin HTTP API. */

import { CONSUMED_PREVIEW_CODES, SOURCES_CANCEL_PATH } from "./constants.ts";
import type { PluginRequestError } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPluginRequestError(error: unknown): error is PluginRequestError {
	return error instanceof Error && error.name === "PluginRequestError" && "status" in error;
}

export function isConflictError(error: unknown): boolean {
	if (!isPluginRequestError(error)) {
		return (
			error instanceof Error && /SETTINGS_CONFLICT|settings-conflict|changed since it was read/iu.test(error.message)
		);
	}
	return error.status === 409 || error.code === "SETTINGS_CONFLICT" || /conflict/iu.test(error.message);
}

export function isConsumedPreviewError(error: unknown): boolean {
	if (!isPluginRequestError(error)) return false;
	if (error.code !== undefined && CONSUMED_PREVIEW_CODES.has(error.code)) return true;
	return error.status === 404 || error.status === 410;
}

export function cancelPreviewTicket(previewId: string, keepalive = false): void {
	void fetch(SOURCES_CANCEL_PATH, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ previewId }),
		...(keepalive ? { keepalive: true } : {}),
	}).catch(() => undefined);
}

export async function jsonRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
		credentials: "same-origin",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const record = isRecord(value) ? value : undefined;
		const message =
			record !== undefined && typeof record["error"] === "string"
				? record["error"]
				: record !== undefined && typeof record["message"] === "string"
					? record["message"]
					: `HTTP ${response.status}`;
		const code = record !== undefined && typeof record["code"] === "string" ? record["code"] : undefined;
		const error = new Error(message) as PluginRequestError;
		error.name = "PluginRequestError";
		error.status = response.status;
		if (code !== undefined) error.code = code;
		throw error;
	}
	return value as T;
}

export async function copyText(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to execCommand
	}
	try {
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.left = "-9999px";
		document.body.appendChild(area);
		area.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(area);
		return ok;
	} catch {
		return false;
	}
}

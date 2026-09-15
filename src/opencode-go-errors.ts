/**
 * Classify OpenCode Go upstream HTTP failures at the network boundary.
 * RegionError must not be treated as an invalid API key.
 */

const REGION_OPT_IN_RE = /requires explicit opt[- ]?in/i;
const MESSAGE_MAX = 1000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function truncate(message: string): string {
	return message.length <= MESSAGE_MAX ? message : message.slice(0, MESSAGE_MAX);
}

/** Return the upstream RegionError message when the body is a China opt-in rejection. */
export function parseOpenCodeGoRegionError(bodyText: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText) as unknown;
	} catch {
		return REGION_OPT_IN_RE.test(bodyText) ? truncate(bodyText.trim()) || undefined : undefined;
	}
	const root = asRecord(parsed);
	const error = asRecord(root?.["error"]);
	const errorType = asText(error?.["type"]) ?? asText(root?.["type"]);
	const message = asText(error?.["message"]) ?? asText(root?.["message"]);
	if (errorType === "RegionError" || (message !== undefined && REGION_OPT_IN_RE.test(message))) {
		return truncate(
			message ?? "This OpenCode Go model is China-hosted and requires explicit workspace opt-in",
		);
	}
	return undefined;
}

export type OpenCodeGoUpstreamErrorClass = {
	readonly code: "region-opt-in-required" | "credential-rejected" | "upstream-failed";
	readonly message: string;
};

/** Shared parser for directory and chat-path upstream failures. */
export function classifyOpenCodeGoUpstreamError(status: number, bodyText: string): OpenCodeGoUpstreamErrorClass {
	const regionMessage = parseOpenCodeGoRegionError(bodyText);
	if (regionMessage !== undefined) {
		return { code: "region-opt-in-required", message: regionMessage };
	}
	if (status === 401 || status === 403) {
		return {
			code: "credential-rejected",
			message: `OpenCode Go returned HTTP ${status}`,
		};
	}
	return {
		code: "upstream-failed",
		message: `OpenCode Go returned HTTP ${status}`,
	};
}

/** Directory fetch maps the shared class onto connection error codes. */
export function classifyOpenCodeGoDirectoryFailure(
	status: number,
	bodyText: string,
): { code: string; message: string } {
	const classified = classifyOpenCodeGoUpstreamError(status, bodyText);
	if (classified.code === "region-opt-in-required") {
		return { code: classified.code, message: classified.message };
	}
	if (classified.code === "credential-rejected") {
		return {
			code: "credential-rejected",
			message: `OpenCode Go model directory returned HTTP ${status}`,
		};
	}
	return {
		code: "model-directory-failed",
		message: `OpenCode Go model directory returned HTTP ${status}`,
	};
}

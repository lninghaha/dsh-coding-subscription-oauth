/** Remove token-like strings from an external OAuth diagnostic. */

/**
 * An opaque credential value run. We require the surrounding label to be one of
 * the known credential field names AND the value to be at least this many
 * characters so that ordinary prose ("code is fun", "token missing") is left
 * alone. The minimum also keeps the regex from matching in code-style
 * strings like `code: a`.
 */
const OPAQUE_TOKEN_MIN_LENGTH = 16;

/** The opaque-value class: at least the minimum chars of URL-safe alphabet. */
const OPAQUE_TOKEN_RUN = `[A-Za-z0-9_\\-.+]{${OPAQUE_TOKEN_MIN_LENGTH},}`;

/** Known sensitive field names that may precede an opaque credential value. */
const SENSITIVE_LABEL =
	"(?:token|bearer|code|user_code|access_token|refresh_token|id_token|api[_-]?key|secret|password|client[_-]?secret|authorization)";

/**
 * Sweep additional opaque tokens that follow a known credential label. We
 * require the value to be long and URL-safe-shaped so that ordinary prose
 * ("code is fun", "token missing") is left alone. This complements the short
 * and structured sweep above — it catches longer opaque tokens that survive
 * the more specific regexes.
 */
function redactOpaqueTokens(input: string): string {
	let output = input.replace(
		new RegExp(`(["']?${SENSITIVE_LABEL}["']?\\s*:\\s*["'])(${OPAQUE_TOKEN_RUN})(["'])`, "giu"),
		`$1[redacted]$3`,
	);
	output = output.replace(
		new RegExp(`\\b(${SENSITIVE_LABEL})=(${OPAQUE_TOKEN_RUN})(?=[&\\s"']|$)`, "giu"),
		`$1=[redacted]`,
	);
	output = output.replace(
		new RegExp(`\\b(${SENSITIVE_LABEL}\\s*:\\s*)(${OPAQUE_TOKEN_RUN})(?=[\\s"',}]|$)`, "giu"),
		`$1[redacted]`,
	);
	output = output.replace(new RegExp(`\\b(Authorization)\\s+(${OPAQUE_TOKEN_RUN})\\b`, "giu"), `$1 [redacted]`);
	return output;
}

export function safeMessage(error: unknown): string {
	let text = (error instanceof Error ? error.message : String(error))
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]")
		.replace(/\bsk-ant-oat[A-Za-z0-9_-]*\b/giu, "[redacted token]")
		.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[redacted token]")
		.replace(/\bxai-[A-Za-z0-9._-]{8,}\b/gu, "[redacted token]")
		.replace(/(\bBearer\s+)[^\s"',}]+/giu, "$1[redacted]")
		.replace(/(\b(?:code|user_code|token|id_token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]")
		.replace(/(["']?(?:code|user_code|id_token|refresh_token|access_token)["']?\s*:\s*["'])[^"']+/giu, "$1[redacted]");
	// Generic opaque sweep catches long values preceded by labels such as
	// client_secret, api_key, password, or Authorization. The minimum length
	// guards against ordinary prose and the case-insensitive pass handles repeats.
	text = redactOpaqueTokens(text);
	return text.slice(0, 1000);
}

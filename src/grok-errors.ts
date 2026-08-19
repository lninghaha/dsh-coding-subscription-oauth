/**
 * xAI / Grok Build error remapping.
 * @module dsh-coding-subscription-oauth/grok-errors
 */

/**
 * xAI returns capacity / overload messages that pi-ai classifies as
 * `PI_AI_ERROR` (or occasionally mislabels as AUTH) because the payload has
 * `error.code: null` and no HTTP 429 / rate-limit wording. Without a remap the
 * harness retry policy never runs.
 */
const XAI_CAPACITY = /\b(?:at\s+capacity|high\s+demand|priority\s+processing|overloaded)\b/i;

export function isXaiCapacityError(detail: string): boolean {
	return XAI_CAPACITY.test(detail);
}

export function remapXaiCapacityFailure(failure: { message: string; code: string }): {
	message: string;
	code: string;
} {
	if (!isXaiCapacityError(failure.message)) return failure;
	return { ...failure, code: "RATE_LIMIT" };
}

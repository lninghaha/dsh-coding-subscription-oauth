/**
 * Kimi Code error remapping.
 * @module dsh-coding-subscription-oauth/kimi-errors
 */

import { CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError } from "@deepseek-ai/dsh-llm";

/**
 * Kimi Code returns HTTP 401 `authentication_error` for context overflow, e.g.
 * `k3-256k supports only 256K context.` The harness pi-ai classifier sees the
 * status and labels it AUTH, which would invalidate a still-valid token and
 * retry a request that cannot succeed.
 */
const KIMI_CONTEXT_CAPACITY = /\bsupports only\s+\d+\s*k\s+context\b/i;

export function isMisclassifiedContextWindowError(detail: string): boolean {
	return isContextWindowExceededError(detail) || KIMI_CONTEXT_CAPACITY.test(detail);
}

export function remapAuthFailureIfContextOverflow(failure: { message: string; code: string }): {
	message: string;
	code: string;
} {
	if (failure.code !== "AUTH" || !isMisclassifiedContextWindowError(failure.message)) return failure;
	return { ...failure, code: CONTEXT_WINDOW_EXCEEDED_CODE };
}

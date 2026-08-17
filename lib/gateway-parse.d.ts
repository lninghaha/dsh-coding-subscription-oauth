/**
 * Parse OpenAI / Anthropic request bodies into the gateway completion shape.
 * @module dsh-coding-subscription-oauth/gateway-parse
 */
import type { GatewayCompletionRequest } from "./gateway-protocol.js";
export declare function parseOpenAiChatRequest(payload: Record<string, unknown>): GatewayCompletionRequest;
export declare function parseOpenAiResponsesRequest(payload: Record<string, unknown>): GatewayCompletionRequest;
export declare function parseAnthropicMessagesRequest(payload: Record<string, unknown>): GatewayCompletionRequest;
export declare function anthropicMaxTokens(payload: Record<string, unknown>): number;
//# sourceMappingURL=gateway-parse.d.ts.map
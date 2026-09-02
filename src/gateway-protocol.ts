/** Compatibility facade — implementation lives in `src/runtime/` (mirrored from Hub vendor core). */

export type {
	GatewayChatMessage,
	GatewayCompletionRequest,
	GatewayStreamPart,
	GatewayThinkingLevel,
	GatewayTool,
	GatewayToolCall,
} from "./runtime/gateway-protocol.ts";
export { isThinkingLevel } from "./runtime/gateway-protocol.ts";

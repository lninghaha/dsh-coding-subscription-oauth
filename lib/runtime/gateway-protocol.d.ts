/**
 * Shared request/stream types for the local coding-subscription gateway.
 * @module dsh-coding-oauth-core/gateway-protocol
 */
export interface GatewayToolCall {
    id: string;
    name: string;
    arguments: string;
}
export interface GatewayTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export interface GatewayChatMessage {
    role: string;
    content: string;
    tool_calls?: readonly GatewayToolCall[];
    reasoning_content?: string;
    tool_call_id?: string;
    tool_name?: string;
}
export interface GatewayCompletionRequest {
    model: string;
    messages: readonly GatewayChatMessage[];
    tools?: readonly GatewayTool[];
    reasoning?: string;
}
export type GatewayStreamPart = {
    type: "text";
    text: string;
} | {
    type: "thinking";
    text: string;
} | {
    type: "tool_call";
    index: number;
    id: string;
    name: string;
    arguments: string;
} | {
    type: "done";
    finish: "stop" | "tool_calls" | "length";
};
export type GatewayThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export declare function isThinkingLevel(value: string): value is GatewayThinkingLevel;
//# sourceMappingURL=gateway-protocol.d.ts.map
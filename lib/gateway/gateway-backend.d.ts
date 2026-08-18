/**
 * Session-backed model listing and event streaming for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-backend
 */
import type { Api, Context, Message, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import type { OAuthProviderSession } from "../oauth/oauth-session.js";
import type { GrokBuildSession } from "../oauth/session.js";
import { type GatewayChatMessage, type GatewayCompletionRequest, type GatewayStreamPart, type GatewayTool } from "./gateway-protocol.js";
export interface GatewayListedModel {
    id: string;
    owned_by: string;
}
export interface GatewayBackend {
    listModels(): Promise<readonly GatewayListedModel[]>;
    stream(request: GatewayCompletionRequest): AsyncIterable<GatewayStreamPart>;
    streamText(modelId: string, messages: readonly GatewayChatMessage[]): AsyncIterable<string>;
}
export declare class GatewayRequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
interface OwnedModel {
    owned_by: string;
    model: Model<Api>;
    stream: (model: Model<Api>, context: Context, options?: {
        reasoning?: ThinkingLevel;
    }) => AsyncIterable<{
        type: string;
        delta?: string;
        errorMessage?: string;
        reason?: string;
        toolCall?: {
            id: string;
            name: string;
            arguments?: unknown;
        };
        partial?: {
            content?: readonly {
                type?: string;
                id?: string;
                name?: string;
            }[];
        };
    }>;
}
export declare function createSessionGatewayBackend(grok: GrokBuildSession, subscriptions: readonly OAuthProviderSession[]): GatewayBackend;
export declare function selectOwnedModel(owned: readonly OwnedModel[], modelId: string): OwnedModel;
export declare function buildGatewayContext(messages: readonly GatewayChatMessage[], tools?: readonly GatewayTool[]): Context;
export declare function assistantReplay(message: GatewayChatMessage): Message;
export declare function gatewayErrorEnvelope(error: unknown): {
    status: number;
    body: {
        error: {
            message: string;
            type: string;
            code: string;
        };
    };
};
export {};
//# sourceMappingURL=gateway-backend.d.ts.map
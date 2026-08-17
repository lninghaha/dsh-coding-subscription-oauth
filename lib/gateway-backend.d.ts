/**
 * Session-backed model listing and text streaming for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-backend
 */
import type { OAuthProviderSession } from "./oauth-session.js";
import type { GrokBuildSession } from "./session.js";
export interface GatewayListedModel {
    id: string;
    owned_by: string;
}
export interface GatewayChatMessage {
    role: string;
    content: string;
}
export interface GatewayBackend {
    listModels(): Promise<readonly GatewayListedModel[]>;
    streamText(modelId: string, messages: readonly GatewayChatMessage[]): AsyncIterable<string>;
}
export declare class GatewayRequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function createSessionGatewayBackend(grok: GrokBuildSession, subscriptions: readonly OAuthProviderSession[]): GatewayBackend;
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
//# sourceMappingURL=gateway-backend.d.ts.map
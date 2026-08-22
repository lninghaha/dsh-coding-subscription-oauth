/**
 * Start, stop, and rotate the opt-in local coding-subscription API gateway.
 * @module dsh-coding-subscription-oauth/gateway
 */
import { type GatewayBackend } from "./gateway-backend.js";
import { type GatewayConfig } from "./gateway-config.js";
import type { OAuthProviderSession } from "./oauth-session.js";
import type { GrokBuildSession } from "./session.js";
export declare const GATEWAY_TOS_WARNING = "local API gateway is enabled; exposing a subscription as a local API can violate provider ToS and consumes your quota";
export interface StartGatewayOptions {
    config?: Partial<GatewayConfig>;
    dshHome?: string;
    backend?: GatewayBackend;
    grok?: GrokBuildSession;
    subscriptions?: readonly OAuthProviderSession[];
    onError?: (error: unknown) => void;
}
export interface StartedGateway {
    close(): Promise<void>;
    readonly bind: string;
    readonly port: number;
}
export interface GatewayPublicStatus {
    enabled: boolean;
    running: boolean;
    bind: string;
    port: number;
    model: string | null;
    keyConfigured: boolean;
    keyAvailable: boolean;
    keyHint: string;
    models: string[];
    warning: string;
}
export interface CodingOAuthGatewayController {
    status(): Promise<GatewayPublicStatus>;
    startIfEnabled(): Promise<StartedGateway | undefined>;
    setEnabled(enabled: boolean): Promise<GatewayPublicStatus>;
    setPort(port: number): Promise<GatewayPublicStatus>;
    revealKey(): Promise<{
        apiKey: string;
        keyHint: string;
    }>;
    rotateKey(): Promise<{
        apiKey: string;
        keyHint: string;
    }>;
    stop(): Promise<void>;
}
export declare function startCodingOAuthGateway(options: StartGatewayOptions): Promise<StartedGateway | undefined>;
export declare function createCodingOAuthGatewayController(options: StartGatewayOptions): CodingOAuthGatewayController;
//# sourceMappingURL=gateway.d.ts.map
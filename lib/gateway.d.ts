/**
 * Start and stop the opt-in local coding-subscription API gateway.
 * @module dsh-coding-subscription-oauth/gateway
 */
import { type GatewayBackend } from "./gateway-backend.js";
import { type GatewayConfig } from "./gateway-config.js";
import type { OAuthProviderSession } from "./oauth-session.js";
import type { GrokBuildSession } from "./session.js";
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
export declare function startCodingOAuthGateway(options: StartGatewayOptions): Promise<StartedGateway | undefined>;
//# sourceMappingURL=gateway.d.ts.map
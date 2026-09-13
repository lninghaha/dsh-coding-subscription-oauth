export declare const GO_PROTOCOL_PATHS: {
    readonly "openai-completions": "/v1/chat/completions";
    readonly "openai-responses": "/v1/responses";
    readonly "anthropic-messages": "/v1/messages";
};
export type GoProtocol = keyof typeof GO_PROTOCOL_PATHS;
export interface GatewayGoRoute {
    credentialRef: string;
    models: Array<{
        id: string;
        protocol: GoProtocol;
    }>;
}
export declare function parseGatewayGoRoute(value: unknown): GatewayGoRoute | null;
/** Prefer the isolated plugin provider; fall back to legacy takeover for migration preview. */
export declare function gatewayGoPreview(settings: {
    describe(options?: {
        redactSecrets?: boolean;
    }): readonly {
        ns: string;
        value?: unknown;
    }[];
} | undefined): GatewayGoRoute | null;
//# sourceMappingURL=gateway-go-routing.d.ts.map
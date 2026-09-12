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
/** 只向用户预览宿主明确配置的协议；目录没有披露协议时不猜测。 */
export declare function gatewayGoPreview(settings: {
    describe(options?: {
        redactSecrets?: boolean;
    }): readonly {
        ns: string;
        value?: unknown;
    }[];
} | undefined): GatewayGoRoute | null;
//# sourceMappingURL=gateway-go-routing.d.ts.map
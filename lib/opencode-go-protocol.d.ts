export declare const GO_APIS: readonly ["openai-completions", "openai-responses", "anthropic-messages"];
export type GoApi = (typeof GO_APIS)[number];
export declare function isGoApi(value: unknown): value is GoApi;
export declare function knownGoApi(id: string): GoApi | undefined;
export declare function protocolMismatch(ids: readonly string[], api: GoApi): boolean;
/** Anthropic SDK 自行追加 /v1/messages；OpenAI SDK 从 /v1 开始。 */
export declare function goBaseURL(api: GoApi): string;
//# sourceMappingURL=opencode-go-protocol.d.ts.map
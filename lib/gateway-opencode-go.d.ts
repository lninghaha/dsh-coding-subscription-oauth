/**
 * Opt-in OpenCode Go chat completions proxy for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-opencode-go
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare const OPENCODE_GO_ORIGIN = "https://opencode.ai";
export declare const OPENCODE_GO_CHAT_COMPLETIONS_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export interface OpencodeGoSessionMap {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    readonly size: number;
}
export declare function createOpencodeGoSessionMap(maxEntries?: number): OpencodeGoSessionMap;
export declare function resolveSessionId(req: IncomingMessage, bodyRecord: Record<string, unknown>, sessionMap: OpencodeGoSessionMap): string;
export interface OpencodeGoChatCompletionsDeps {
    fetchImpl: typeof fetch;
    sessionMap: OpencodeGoSessionMap;
    getUpstreamApiKey: () => string;
    isEnabled: () => boolean;
}
export declare function handleOpencodeGoChatCompletions(req: IncomingMessage, res: ServerResponse, deps: OpencodeGoChatCompletionsDeps): Promise<void>;
//# sourceMappingURL=gateway-opencode-go.d.ts.map
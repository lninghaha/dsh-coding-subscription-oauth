/**
 * Opt-in OpenCode Go chat completions proxy for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-opencode-go
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type GatewayGoRoute } from "./gateway-go-routing.js";
export declare const OPENCODE_GO_ORIGIN = "https://opencode.ai";
export declare const OPENCODE_GO_CHAT_COMPLETIONS_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export interface OpencodeGoSessionMap {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    readonly size: number;
}
export declare function createOpencodeGoSessionMap(maxEntries?: number): OpencodeGoSessionMap;
export declare function resolveSessionId(req: IncomingMessage, bodyRecord: Record<string, unknown>, sessionMap: OpencodeGoSessionMap): string | undefined;
/** 仅显式前缀模型进入这里。密钥、模型及协议均由已确认路由解析。 */
export declare function handleOpencodeGoInference(req: IncomingMessage, res: ServerResponse, payload: Record<string, unknown>, path: string, deps: {
    route: GatewayGoRoute | null;
    resolveCredential: (ref: string) => Promise<string | undefined>;
    fetchImpl: typeof fetch;
}): Promise<void>;
//# sourceMappingURL=gateway-opencode-go.d.ts.map
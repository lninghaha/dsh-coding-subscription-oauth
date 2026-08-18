/**
 * OpenAI-compatible chat completions for the local gateway.
 * @module dsh-coding-subscription-oauth/gateway-openai-chat
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type GatewayBackend } from "./gateway-backend.js";
export declare function handleOpenAiChatCompletions(req: IncomingMessage, res: ServerResponse, backend: GatewayBackend): Promise<void>;
//# sourceMappingURL=gateway-openai-chat.d.ts.map
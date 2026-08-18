import type { IncomingMessage } from "node:http";
export declare const JSON_BODY_LIMIT_BYTES: number;
export declare class JsonRequestError extends Error {
    readonly statusCode: 400 | 413;
    constructor(statusCode: 400 | 413, message: string);
}
/** Read one JSON request body with a strict in-memory ceiling. */
export declare function readJsonRequest(request: IncomingMessage, limit?: number): Promise<unknown>;
export declare function requestErrorStatus(error: unknown, fallback: number): number;
//# sourceMappingURL=http-json.d.ts.map
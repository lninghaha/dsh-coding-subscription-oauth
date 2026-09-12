import type { Context } from "@deepseek-ai/cordis";
export type OpenCodeGoCallResult = "no-call" | "success" | "failure" | "missing-session";
export interface OpenCodeGoStatus {
    active: boolean;
    lastCall: OpenCodeGoCallResult;
    httpStatus: "no-call" | "accepted" | "rejected" | "network-error";
    streamStatus: "no-call" | "completed" | "failed" | "cancelled" | "missing-session";
    updatedAt: number | null;
    pending?: boolean;
    configurationConflict?: boolean;
}
/** 每次 LLM 调用单独关联 HTTP 与流终态，迟到调用不覆盖新的状态。 */
export declare class OpenCodeGoHeaderState {
    private generation;
    private value;
    snapshot(): OpenCodeGoStatus;
    setActive(active: boolean): void;
    invalidate(): void;
    begin(): number;
    recordHttp(result: OpenCodeGoStatus["httpStatus"], call?: number): void;
    recordStream(result: OpenCodeGoStatus["streamStatus"], call?: number): void;
    conflict(call: number): void;
}
export declare function installOpenCodeGoHeaderCompatibility(ctx: Context, state: OpenCodeGoHeaderState): () => void;
//# sourceMappingURL=opencode-go-header.d.ts.map
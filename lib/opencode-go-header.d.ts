import type { Context } from "@deepseek-ai/cordis";
export type OpenCodeGoCallResult = "no-call" | "success" | "failure" | "missing-session";
export interface OpenCodeGoStatus {
    active: boolean;
    lastCall: OpenCodeGoCallResult;
    httpStatus: "no-call" | "accepted" | "rejected" | "network-error";
    streamStatus: "no-call" | "completed" | "failed" | "cancelled" | "missing-session";
    updatedAt: number | null;
}
/** Owner-private, deliberately secret-free diagnostic state. */
export declare class OpenCodeGoHeaderState {
    private active;
    private lastCall;
    private httpStatus;
    private streamStatus;
    private updatedAt;
    snapshot(): OpenCodeGoStatus;
    setActive(active: boolean): void;
    record(result: Exclude<OpenCodeGoCallResult, "no-call">): void;
    recordHttp(result: Exclude<OpenCodeGoStatus["httpStatus"], "no-call">): void;
    recordStream(result: Exclude<OpenCodeGoStatus["streamStatus"], "no-call">): void;
}
/**
 * Adds the DSH session id only while an OpenCode Go LLM stream is actually
 * iterated. The fetch wrapper remains inert for every other request.
 */
export declare function installOpenCodeGoHeaderCompatibility(ctx: Context, state: OpenCodeGoHeaderState): () => void;
//# sourceMappingURL=opencode-go-header.d.ts.map
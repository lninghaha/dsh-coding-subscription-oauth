/** Narrow adapter around the DSH host API used by the standalone participant. */
import type { Context } from "@deepseek-ai/cordis";
import { type OwnerAccessMode } from "dsh-coding-oauth-core";
import type { CodingOAuthParticipantDiagnosticSource, DshCompatibility, DshCompatibilityDiagnostic } from "./compatibility.js";
import type { OwnerRequestPolicy } from "./web-origin.js";
export interface DshHostAdapter extends CodingOAuthParticipantDiagnosticSource {
    readonly context: Context;
    scope(): object;
    ownerRequestPolicy(): OwnerRequestPolicy | undefined;
    compatibility(options?: {
        readonly accessMode?: OwnerAccessMode;
        readonly uiOwner?: "hub" | "standalone" | null;
        readonly diagnostics?: readonly DshCompatibilityDiagnostic[];
    }): DshCompatibility;
    assertCompatible(): void;
}
export declare function createDshHostAdapter(context: Context): DshHostAdapter;
//# sourceMappingURL=dsh-host-adapter.d.ts.map
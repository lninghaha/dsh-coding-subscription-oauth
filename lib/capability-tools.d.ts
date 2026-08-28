/**
 * Optional Codex / Grok Imagine tool definitions. The factory only returns
 * public `ToolDefinition` objects — it never registers on `ctx.tools`.
 * Feature flags and `imageCount` are re-read from `current()` at execute time.
 * @module dsh-coding-subscription-oauth/capability-tools
 */
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { type CapabilitySettings } from "./capability-settings.js";
import type { CodexAuthSession } from "./codex-http.js";
import { type CodexImageAttachmentStore, type CodexImageController, type CodexImageRoute, type CodexImageRoutePolicy, type CodexImageSessionContext } from "./codex-images.js";
import { type GrokImagineClient } from "./grok-imagine.js";
export declare const CODEX_IMAGE_GENERATE_TOOL = "codex_image_generate";
export declare const CODEX_IMAGE_EDIT_TOOL = "codex_image_edit";
export { GROK_IMAGINE_IMAGE_TOOL, GROK_IMAGINE_VIDEO_STATUS_TOOL, GROK_IMAGINE_VIDEO_TOOL, } from "./grok-imagine.js";
/** Shared client surface; production passes one `GrokImagineClient` so video status can see started jobs. */
export type CapabilityImagineClient = Pick<GrokImagineClient, "generateImage" | "startVideo" | "videoStatus">;
/** Per-exec Codex controller factory. Tests inject a fake; production binds auth + attachments. */
export type CreateCodexImageController = (session: CodexImageSessionContext, routePolicy: CodexImageRoutePolicy) => CodexImageController;
/**
 * Route gate for the Codex image tools. `codexImagesAnyModel` relaxes the
 * Codex-route requirement; otherwise the gate stays `codex-capable`.
 */
export declare function codexImageRoutePolicy(settings: CapabilitySettings): CodexImageRoutePolicy;
/** Resolve authoritative host model metadata for the calling route. */
export type ResolveCodexImageRoute = (exec: ToolRunContext) => Promise<CodexImageRoute | undefined>;
/** Exact provider/model identity from the live request header, then agent options. */
export declare function callingRouteIdentity(exec: ToolRunContext): {
    provider: string;
    model: string;
} | undefined;
/**
 * Copy host-resolved modalities onto the calling identity. Never invents
 * `inputModalities`; lookup failures keep the identity and omit the field so
 * the image-capability gate fails closed.
 */
export declare function resolveCodexImageRouteFromLlm(exec: ToolRunContext, resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<{
    inputModalities?: readonly string[];
}>): Promise<CodexImageRoute | undefined>;
export interface CapabilityToolsOptions {
    /** Live capability section. Re-read on every execute so a disable takes effect immediately. */
    current(): CapabilitySettings;
    readonly auth: CodexAuthSession;
    readonly attachments: CodexImageAttachmentStore;
    readonly imagine: CapabilityImagineClient;
    readonly createCodexController?: CreateCodexImageController;
    readonly resolveCodexImageRoute?: ResolveCodexImageRoute;
}
/**
 * Build the five optional capability tools. Callers register the returned
 * definitions; this function has no Cordis / registry side effects. The tools
 * peer is loaded only after Cordis has composed the optional `tools` service.
 */
export declare function createCapabilityTools(options: CapabilityToolsOptions): Promise<readonly ToolDefinition[]>;
export declare const CAPABILITY_TOOL_NAMES: readonly ["codex_image_generate", "codex_image_edit", "grok_imagine_image", "grok_imagine_video", "grok_imagine_video_status"];
//# sourceMappingURL=capability-tools.d.ts.map
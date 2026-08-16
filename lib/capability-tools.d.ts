/**
 * Optional Codex / Grok Imagine tool definitions. The factory only returns
 * public `ToolDefinition` objects — it never registers on `ctx.tools`.
 * Feature flags and `imageCount` are re-read from `current()` at execute time.
 * @module dsh-coding-subscription-oauth/capability-tools
 */
import { type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { type CapabilitySettings } from "./capability-settings.ts";
import type { CodexAuthSession } from "./codex-http.ts";
import { type CodexImageAttachmentStore, type CodexImageController, type CodexImageSessionContext } from "./codex-images.ts";
import { type GrokImagineClient } from "./grok-imagine.ts";
export declare const CODEX_IMAGE_GENERATE_TOOL = "codex_image_generate";
export declare const CODEX_IMAGE_EDIT_TOOL = "codex_image_edit";
export { GROK_IMAGINE_IMAGE_TOOL, GROK_IMAGINE_VIDEO_STATUS_TOOL, GROK_IMAGINE_VIDEO_TOOL, } from "./grok-imagine.ts";
/** Shared client surface; production passes one `GrokImagineClient` so video status can see started jobs. */
export type CapabilityImagineClient = Pick<GrokImagineClient, "generateImage" | "startVideo" | "videoStatus">;
/** Per-exec Codex controller factory. Tests inject a fake; production binds auth + attachments. */
export type CreateCodexImageController = (session: CodexImageSessionContext) => CodexImageController;
export interface CapabilityToolsOptions {
    /** Live capability section. Re-read on every execute so a disable takes effect immediately. */
    current(): CapabilitySettings;
    readonly auth: CodexAuthSession;
    readonly attachments: CodexImageAttachmentStore;
    readonly imagine: CapabilityImagineClient;
    readonly createCodexController?: CreateCodexImageController;
}
/**
 * Build the five optional capability tools. Callers register the returned
 * definitions; this function has no Cordis / registry side effects.
 */
export declare function createCapabilityTools(options: CapabilityToolsOptions): readonly ToolDefinition[];
export declare const CAPABILITY_TOOL_NAMES: readonly ["codex_image_generate", "codex_image_edit", "grok_imagine_image", "grok_imagine_video", "grok_imagine_video_status"];
//# sourceMappingURL=capability-tools.d.ts.map
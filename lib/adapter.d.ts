/** Coding-subscription adapter assembled from public dsh-llm-pi-ai extension points. */
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { RetryPolicyConfig } from "@deepseek-ai/dsh-llm";
import { type LlmAdapter } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import type { OAuthProviderSession } from "./oauth-session.ts";
import type { GrokBuildSession } from "./session.ts";
/** Prefer grok-4.6 when the current (live or baseline) list has it. */
export declare function preferredGrokBuildModel(models?: readonly {
    id: string;
}[]): string;
/** Existing Grok-only constructor retained for public API compatibility. */
export declare function createGrokBuildAdapter(session: GrokBuildSession, resolveAttachments: () => AttachmentStore | undefined): PiAiAdapter;
/** Create the four-route OAuth adapter while preserving each pi-ai native id. */
export declare function createCodingOAuthAdapter(grok: GrokBuildSession, subscriptions: readonly OAuthProviderSession[], resolveAttachments: () => AttachmentStore | undefined, retryPolicy?: RetryPolicyConfig | undefined): LlmAdapter;
//# sourceMappingURL=adapter.d.ts.map
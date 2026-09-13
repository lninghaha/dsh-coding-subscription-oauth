import { type CredentialProvider } from "@deepseek-ai/dsh-credentials";
import type { OpenCodeGoStatus } from "./opencode-go-header.js";
import { type GoApi } from "./opencode-go-protocol.js";
import { type ProviderDirectoryModel } from "./provider-auth-catalog.js";
import type { OwnerRequestPolicy } from "./web-origin.js";
import { type PluginWebRouteRegistry } from "./web-routes.js";
export declare const OPENCODE_GO_CONNECTION_PATH = "/plugins/dsh-grok-build/opencode-go";
export declare const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export declare const OPENCODE_GO_API = "openai-completions";
export declare const OPENCODE_GO_PROVIDER_ID = "opencode-go";
type SettingsOp = {
    op: "set";
    path: readonly string[];
    value: unknown;
} | {
    op: "unset";
    path: readonly string[];
};
export interface OpenCodeGoSettingsProvider {
    readonly writable?: boolean;
    describe(options?: {
        redactSecrets?: boolean;
    }): readonly {
        ns: string;
        value?: unknown;
        revision?: number;
    }[];
    mutate(ns: string, ops: readonly SettingsOp[], expectedRevision?: number): Promise<void>;
}
export interface OpenCodeGoModel extends ProviderDirectoryModel {
    readonly id: string;
}
export type OpenCodeGoConnectionStatus = ReturnType<typeof statusDocument> extends Promise<infer T> ? T : never;
interface Options {
    credentials: CredentialProvider;
    settings: OpenCodeGoSettingsProvider;
    callStatus: () => OpenCodeGoStatus;
    onConfigurationChange?: () => void;
    fetchImpl?: typeof fetch;
}
declare function statusDocument(options: Options, preferredRef?: string): Promise<{
    credential: {
        selectedRef: string;
        configured: boolean;
        writable: boolean;
        source: string | null;
        requiresChoice: boolean;
        candidates: {
            ref: string;
            configured: boolean;
            writable: boolean;
            source: string | null;
        }[];
    };
    configuration: {
        revision: number | null;
        writable: boolean;
        api: string | null;
        baseURL: string | null;
        models: OpenCodeGoModel[];
        ready: boolean;
        conflicts: ("protocol" | "base-url" | "static-session-header")[];
    };
    call: OpenCodeGoStatus;
}>;
export declare function createOpenCodeGoConnectionController(options: Options): {
    status: (preferredRef?: string) => Promise<{
        credential: {
            selectedRef: string;
            configured: boolean;
            writable: boolean;
            source: string | null;
            requiresChoice: boolean;
            candidates: {
                ref: string;
                configured: boolean;
                writable: boolean;
                source: string | null;
            }[];
        };
        configuration: {
            revision: number | null;
            writable: boolean;
            api: string | null;
            baseURL: string | null;
            models: OpenCodeGoModel[];
            ready: boolean;
            conflicts: ("protocol" | "base-url" | "static-session-header")[];
        };
        call: OpenCodeGoStatus;
    }>;
    models(preferredRef?: string): Promise<ProviderDirectoryModel[]>;
    saveCredential(input: {
        credentialRef: string;
        apiKey?: string;
    }): Promise<{
        credential: {
            selectedRef: string;
            configured: boolean;
            writable: boolean;
            source: string | null;
            requiresChoice: boolean;
            candidates: {
                ref: string;
                configured: boolean;
                writable: boolean;
                source: string | null;
            }[];
        };
        configuration: {
            revision: number | null;
            writable: boolean;
            api: string | null;
            baseURL: string | null;
            models: OpenCodeGoModel[];
            ready: boolean;
            conflicts: ("protocol" | "base-url" | "static-session-header")[];
        };
        call: OpenCodeGoStatus;
    }>;
    /**
     * If DSH native model settings created/updated `opencode-go` without
     * `apiKeyEnv`, reinject the selected configured credential reference.
     */
    reinjectCredential(input?: {
        credentialRef?: string;
        expectedRevision?: number;
    }): Promise<{
        credential: {
            selectedRef: string;
            configured: boolean;
            writable: boolean;
            source: string | null;
            requiresChoice: boolean;
            candidates: {
                ref: string;
                configured: boolean;
                writable: boolean;
                source: string | null;
            }[];
        };
        configuration: {
            revision: number | null;
            writable: boolean;
            api: string | null;
            baseURL: string | null;
            models: OpenCodeGoModel[];
            ready: boolean;
            conflicts: ("protocol" | "base-url" | "static-session-header")[];
        };
        call: OpenCodeGoStatus;
    }>;
    applyConfiguration(input: {
        api?: GoApi;
        credentialRef: string;
        model?: OpenCodeGoModel;
        models?: readonly OpenCodeGoModel[];
        expectedRevision: number;
        confirmConflicts: boolean;
    }): Promise<{
        credential: {
            selectedRef: string;
            configured: boolean;
            writable: boolean;
            source: string | null;
            requiresChoice: boolean;
            candidates: {
                ref: string;
                configured: boolean;
                writable: boolean;
                source: string | null;
            }[];
        };
        configuration: {
            revision: number | null;
            writable: boolean;
            api: string | null;
            baseURL: string | null;
            models: OpenCodeGoModel[];
            ready: boolean;
            conflicts: ("protocol" | "base-url" | "static-session-header")[];
        };
        call: OpenCodeGoStatus;
    }>;
};
/**
 * Watch DSH model settings and reinject the Go credential when the native
 * Models page adds/updates `opencode-go` without `apiKeyEnv`.
 */
export declare function installOpenCodeGoCredentialReinject(ctx: {
    on(event: string, listener: (...args: never[]) => unknown): () => unknown;
}, controller: ReturnType<typeof createOpenCodeGoConnectionController>): () => void;
export declare function registerOpenCodeGoConnectionRoute(ctx: {
    webServer: PluginWebRouteRegistry;
    effect(callback: () => () => void, label?: string): unknown;
}, controller: ReturnType<typeof createOpenCodeGoConnectionController>, policy: OwnerRequestPolicy): () => void;
export {};
//# sourceMappingURL=opencode-go-connection.d.ts.map
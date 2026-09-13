import { type CredentialProvider } from "@deepseek-ai/dsh-credentials";
import type { OpenCodeGoStatus } from "./opencode-go-header.js";
import { type GoApi } from "./opencode-go-protocol.js";
import { type ProviderDirectoryModel } from "./provider-auth-catalog.js";
import type { OwnerRequestPolicy } from "./web-origin.js";
import { type PluginWebRouteRegistry } from "./web-routes.js";
export declare const OPENCODE_GO_CONNECTION_PATH = "/plugins/dsh-grok-build/opencode-go";
export declare const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export declare const OPENCODE_GO_API = "openai-completions";
export { OPENCODE_GO_LEGACY_PROVIDER_ID, OPENCODE_GO_PROVIDER_ID } from "./opencode-go-ids.js";
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
    providerId: "coding-opencode-go";
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
    legacy: {
        providerId: "opencode-go";
        present: boolean;
        migratable: boolean;
        targetProviderId: "coding-opencode-go";
    };
    call: OpenCodeGoStatus;
}>;
export declare function createOpenCodeGoConnectionController(options: Options): {
    status: (preferredRef?: string) => Promise<{
        providerId: "coding-opencode-go";
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
        legacy: {
            providerId: "opencode-go";
            present: boolean;
            migratable: boolean;
            targetProviderId: "coding-opencode-go";
        };
        call: OpenCodeGoStatus;
    }>;
    models(preferredRef?: string): Promise<ProviderDirectoryModel[]>;
    saveCredential(input: {
        credentialRef: string;
        apiKey?: string;
    }): Promise<{
        providerId: "coding-opencode-go";
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
        legacy: {
            providerId: "opencode-go";
            present: boolean;
            migratable: boolean;
            targetProviderId: "coding-opencode-go";
        };
        call: OpenCodeGoStatus;
    }>;
    /**
     * If DSH model settings created/updated the isolated plugin provider
     * without `apiKeyEnv`, reinject the selected configured credential reference.
     */
    reinjectCredential(input?: {
        credentialRef?: string;
        expectedRevision?: number;
    }): Promise<{
        providerId: "coding-opencode-go";
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
        legacy: {
            providerId: "opencode-go";
            present: boolean;
            migratable: boolean;
            targetProviderId: "coding-opencode-go";
        };
        call: OpenCodeGoStatus;
    }>;
    /**
     * Copy a prior plugin-shaped `opencode-go` takeover into the isolated
     * `coding-opencode-go` provider. Leaves the builtin slot untouched.
     */
    migrateLegacyConfiguration(input?: {
        expectedRevision?: number;
        confirmConflicts?: boolean;
    }): Promise<{
        providerId: "coding-opencode-go";
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
        legacy: {
            providerId: "opencode-go";
            present: boolean;
            migratable: boolean;
            targetProviderId: "coding-opencode-go";
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
        providerId: "coding-opencode-go";
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
        legacy: {
            providerId: "opencode-go";
            present: boolean;
            migratable: boolean;
            targetProviderId: "coding-opencode-go";
        };
        call: OpenCodeGoStatus;
    }>;
};
/**
 * Watch DSH model settings and reinject the Go credential when the isolated
 * plugin provider is updated without `apiKeyEnv`. Does not touch builtin
 * `opencode-go`.
 */
export declare function installOpenCodeGoCredentialReinject(ctx: {
    on(event: string, listener: (...args: never[]) => unknown): () => unknown;
}, controller: ReturnType<typeof createOpenCodeGoConnectionController>): () => void;
export declare function registerOpenCodeGoConnectionRoute(ctx: {
    webServer: PluginWebRouteRegistry;
    effect(callback: () => () => void, label?: string): unknown;
}, controller: ReturnType<typeof createOpenCodeGoConnectionController>, policy: OwnerRequestPolicy): () => void;
//# sourceMappingURL=opencode-go-connection.d.ts.map
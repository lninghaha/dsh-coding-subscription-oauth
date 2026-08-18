import Schema from "@deepseek-ai/schemastery";
/**
 * Integration-ready capability settings controller for the
 * `coding-subscription-oauth` namespace. Schema defaults sit under the
 * composition/YAML `base`, and the user section layers on top. The controller
 * talks to an injected structural settings service while registering a real
 * Schemastery section that the Host settings service can render and validate.
 * @module dsh-coding-subscription-oauth/capability-settings
 */
/** Settings namespace owned by this plugin. */
export declare const CAPABILITY_SETTINGS_NAMESPACE = "coding-subscription-oauth";
/** Default-off capability flags. Presence in the user section marks an override. */
export declare const CAPABILITY_FLAG_KEYS: readonly ["codexSearch", "codexImages", "codexImageEdits", "codexUsage", "codexFast", "grokImagineImage", "grokImagineVideo"];
/** Conservative numeric limits persisted beside the flags. */
export declare const CAPABILITY_LIMIT_KEYS: readonly ["searchResults", "imageCount", "videoArtifactTtlMs"];
/** Every key the controller admits into secret-free state. */
export declare const CAPABILITY_SETTINGS_KEYS: readonly ["codexSearch", "codexImages", "codexImageEdits", "codexUsage", "codexFast", "grokImagineImage", "grokImagineVideo", "searchResults", "imageCount", "videoArtifactTtlMs"];
export type CapabilityFlagKey = (typeof CAPABILITY_FLAG_KEYS)[number];
export type CapabilityLimitKey = (typeof CAPABILITY_LIMIT_KEYS)[number];
export type CapabilitySettingsKey = (typeof CAPABILITY_SETTINGS_KEYS)[number];
/** Resolved, secret-free capability section. */
export interface CapabilitySettings {
    readonly codexSearch: boolean;
    readonly codexImages: boolean;
    readonly codexImageEdits: boolean;
    readonly codexUsage: boolean;
    readonly codexFast: boolean;
    readonly grokImagineImage: boolean;
    readonly grokImagineVideo: boolean;
    readonly searchResults: number;
    readonly imageCount: number;
    readonly videoArtifactTtlMs: number;
}
/** Sparse overlay used for YAML/composition `base` and the user section. */
export type CapabilitySettingsPatch = Partial<CapabilitySettings>;
/** Inclusive bounds and schema defaults for each numeric limit. */
export declare const CAPABILITY_SETTINGS_BOUNDS: {
    readonly searchResults: {
        readonly min: 1;
        readonly max: 20;
        readonly default: 5;
    };
    readonly imageCount: {
        readonly min: 1;
        readonly max: 4;
        readonly default: 1;
    };
    readonly videoArtifactTtlMs: {
        readonly min: number;
        readonly max: number;
        readonly default: number;
    };
};
/** Schema defaults: every flag off, every limit at its conservative default. */
export declare const DEFAULT_CAPABILITY_SETTINGS: CapabilitySettings;
/**
 * Real Schemastery schema registered with the Host settings service. Defaults
 * remain conservative, and bounds are enforced before a user document commits.
 */
export declare const CapabilitySettingsSchema: Schema<Schemastery.ObjectS<{
    codexSearch: Schema<boolean, boolean>;
    codexImages: Schema<boolean, boolean>;
    codexImageEdits: Schema<boolean, boolean>;
    codexUsage: Schema<boolean, boolean>;
    codexFast: Schema<boolean, boolean>;
    grokImagineImage: Schema<boolean, boolean>;
    grokImagineVideo: Schema<boolean, boolean>;
    searchResults: Schema<number, number>;
    imageCount: Schema<number, number>;
    videoArtifactTtlMs: Schema<number, number>;
}>, Schemastery.ObjectT<{
    codexSearch: Schema<boolean, boolean>;
    codexImages: Schema<boolean, boolean>;
    codexImageEdits: Schema<boolean, boolean>;
    codexUsage: Schema<boolean, boolean>;
    codexFast: Schema<boolean, boolean>;
    grokImagineImage: Schema<boolean, boolean>;
    grokImagineVideo: Schema<boolean, boolean>;
    searchResults: Schema<number, number>;
    imageCount: Schema<number, number>;
    videoArtifactTtlMs: Schema<number, number>;
}>>;
/** Serialized schema metadata consumed by Settings UI tests and diagnostics. */
export declare const CAPABILITY_SETTINGS_SCHEMA_JSON: Schema<Schemastery.ObjectS<{
    codexSearch: Schema<boolean, boolean>;
    codexImages: Schema<boolean, boolean>;
    codexImageEdits: Schema<boolean, boolean>;
    codexUsage: Schema<boolean, boolean>;
    codexFast: Schema<boolean, boolean>;
    grokImagineImage: Schema<boolean, boolean>;
    grokImagineVideo: Schema<boolean, boolean>;
    searchResults: Schema<number, number>;
    imageCount: Schema<number, number>;
    videoArtifactTtlMs: Schema<number, number>;
}>, Schemastery.ObjectT<{
    codexSearch: Schema<boolean, boolean>;
    codexImages: Schema<boolean, boolean>;
    codexImageEdits: Schema<boolean, boolean>;
    codexUsage: Schema<boolean, boolean>;
    codexFast: Schema<boolean, boolean>;
    grokImagineImage: Schema<boolean, boolean>;
    grokImagineVideo: Schema<boolean, boolean>;
    searchResults: Schema<number, number>;
    imageCount: Schema<number, number>;
    videoArtifactTtlMs: Schema<number, number>;
}>>;
export type CapabilitySettingsSchemaType = typeof CapabilitySettingsSchema;
/** Revision-bearing, secret-free snapshot used for CAS writes and UI. */
export interface CapabilitySettingsSnapshot {
    readonly ns: typeof CAPABILITY_SETTINGS_NAMESPACE;
    readonly value: CapabilitySettings;
    readonly base?: CapabilitySettingsPatch;
    readonly user?: CapabilitySettingsPatch;
    readonly revision: number;
    readonly writable: boolean;
    readonly applies: "live";
    readonly secrets: readonly [];
}
/** Owner-facing subset of `ctx.settings.register()` used when the parent injects a provider. */
export interface CapabilitySettingsScope {
    get(): unknown;
    watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void;
    update(patch: object): Promise<void>;
    replace(section: object): Promise<void>;
}
/** One namespace descriptor as returned by a structural `describe()`. */
export interface CapabilitySettingsDescriptor {
    readonly ns: string;
    readonly value?: unknown;
    readonly base?: unknown;
    readonly user?: unknown;
    readonly revision?: number;
    readonly applies?: "live" | "restart";
    readonly secrets?: readonly {
        readonly path?: readonly string[];
        readonly set?: boolean;
    }[];
}
/**
 * Duck-typed settings service. A real `ctx.settings` satisfies this without a
 * compile-time dependency on `@deepseek-ai/dsh-settings`.
 */
export interface CapabilitySettingsService {
    readonly writable?: boolean;
    describe?(options?: {
        readonly redactSecrets?: boolean;
    }): readonly CapabilitySettingsDescriptor[];
    get?(ns: string): unknown;
    update?(ns: string, patch: object, expectedRevision?: number): Promise<void>;
    replace?(ns: string, section: object, expectedRevision?: number): Promise<void>;
    register?(ns: string, schema: CapabilitySettingsSchemaType, options?: {
        readonly base?: CapabilitySettingsPatch;
        readonly applies?: "live" | "restart";
        readonly validate?: (value: CapabilitySettings) => void;
    }): CapabilitySettingsScope;
}
/** Construction options. `base` is the YAML / composition entry layered under the user section. */
export interface CapabilitySettingsControllerOptions {
    readonly settings?: CapabilitySettingsService | undefined;
    readonly base?: CapabilitySettingsPatch | undefined;
    /** Contain both synchronous and asynchronous observer failures. */
    readonly onListenerError?: ((error: unknown) => void) | undefined;
}
/** Listener invoked after a committed snapshot change. */
export type CapabilitySettingsListener = (snapshot: CapabilitySettingsSnapshot) => void | Promise<void>;
/**
 * A write refused because the namespace moved since the caller read it.
 * `code` matches the Host settings seam so a later wire layer can map it.
 */
export declare class CapabilitySettingsConflictError extends Error {
    readonly code = "SETTINGS_CONFLICT";
    readonly ns = "coding-subscription-oauth";
    readonly expected: number;
    readonly actual: number;
    constructor(expected: number, actual: number);
}
/** A write refused because no writable settings provider is attached. */
export declare class CapabilitySettingsReadOnlyError extends Error {
    readonly code: "SETTINGS_PROVIDER_ABSENT" | "SETTINGS_READ_ONLY" | "SETTINGS_DISPOSED";
    readonly ns = "coding-subscription-oauth";
    readonly reason: "absent" | "read-only" | "disposed";
    constructor(reason: "absent" | "read-only" | "disposed");
}
export declare function isCapabilitySettingsConflictError(error: unknown): error is CapabilitySettingsConflictError;
export declare function isCapabilitySettingsReadOnlyError(error: unknown): error is CapabilitySettingsReadOnlyError;
/** Pick every independently default-off flag from a resolved section. */
export declare function capabilityFlags(settings: CapabilitySettings): Pick<CapabilitySettings, CapabilityFlagKey>;
/** Pick the conservative numeric limits from a resolved section. */
export declare function capabilityLimits(settings: CapabilitySettings): Pick<CapabilitySettings, CapabilityLimitKey>;
/** Layer schema defaults, then YAML/composition `base`, then the user section. */
export declare function resolveCapabilitySettings(base?: CapabilitySettingsPatch | undefined, user?: CapabilitySettingsPatch | undefined): CapabilitySettings;
/**
 * Admit a candidate section: known keys only, flags default off, limits clamped,
 * secret-shaped keys dropped. Used for both reads and the structural schema.
 */
export declare function normalizeCapabilitySettings(input?: unknown): CapabilitySettings;
/**
 * Normalize a sparse overlay. Invalid or secret fields are omitted so a lower
 * layer (YAML base / schema default) remains authoritative for that key.
 */
export declare function normalizeCapabilitySettingsPatch(input?: unknown): CapabilitySettingsPatch;
/**
 * Strictly admit a caller-authored sparse section before normalizing it. Reads
 * remain compatibility-tolerant, but writes must never silently drop unknown
 * fields, coerce types, truncate decimals, or clamp out-of-range limits.
 */
export declare function assertCapabilitySettingsPatch(input: unknown, label?: string): asserts input is CapabilitySettingsPatch;
/** Reject a resolved section the owner could not act on. Schema-valid by construction after normalize. */
export declare function assertServiceableCapabilitySettings(value: CapabilitySettings): void;
/**
 * Live capability-settings controller. Without an injected provider the
 * resolved state is the YAML/default layer and every write fails explicitly.
 */
export declare class CapabilitySettingsController {
    readonly ns = "coding-subscription-oauth";
    private readonly settings;
    private readonly base;
    private readonly onListenerError;
    private readonly listeners;
    private scope;
    private scopeDisposer;
    private localRevision;
    private lastSnapshot;
    private disposed;
    constructor(options?: CapabilitySettingsControllerOptions);
    /** Current revision-bearing snapshot. Re-reads the injected provider when present. */
    snapshot(): CapabilitySettingsSnapshot;
    /** Resolved capability section (schema defaults ← YAML base ← user). */
    current(): CapabilitySettings;
    /**
     * Merge a secret-free patch into the user layer using compare-and-swap on
     * `expectedRevision` from a previously read {@link snapshot}.
     */
    patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
    /**
     * Replace the user section wholesale (`{}` re-inherits YAML base and defaults).
     * Compare-and-swap uses the same revision token as {@link patch}.
     */
    replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>;
    /**
     * Observe committed snapshot changes. The disposer removes this listener;
     * an invocation already running still settles.
     */
    subscribe(listener: CapabilitySettingsListener): () => void;
    /**
     * Re-read the injected provider (or the local YAML/default layer) and notify
     * listeners when the secret-free snapshot moved.
     */
    reconcile(): CapabilitySettingsSnapshot;
    /** Drop the register() watcher and every listener. Further writes fail. */
    dispose(): void;
    private attachScope;
    private writeReason;
    private isWritable;
    private write;
    private readSnapshot;
    private readResolvedFromService;
    private readDescribed;
    private publish;
}
/** Construct a {@link CapabilitySettingsController}. */
export declare function createCapabilitySettingsController(options?: CapabilitySettingsControllerOptions): CapabilitySettingsController;
//# sourceMappingURL=capability-settings.d.ts.map
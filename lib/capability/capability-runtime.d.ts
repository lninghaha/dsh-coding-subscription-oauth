/**
 * Side-effect coordination for default-off optional capabilities.
 *
 * This module contains no Cordis service lookup. The parent supplies structural
 * registries, which keeps live flag transitions deterministic and unit-testable.
 * @module dsh-coding-subscription-oauth/capability-runtime
 */
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { CodexModelCapabilities } from "../codex/codex-model-capabilities.js";
import type { CodexSearchProvider } from "../codex/codex-search.js";
import { type CapabilitySettings } from "./capability-settings.js";
export type CapabilityRuntimeListener = (settings: CapabilitySettings) => void | Promise<void>;
/** Process-local live projection shared by optional service fibers. */
export declare class CapabilityRuntimeState {
    private value;
    private readonly listeners;
    private readonly onListenerError;
    constructor(initial?: CapabilitySettings, onListenerError?: (error: unknown) => void);
    current(): CapabilitySettings;
    set(next: unknown): CapabilitySettings;
    /** Re-run live bindings after an external dependency (for example OAuth) changed. */
    refresh(): void;
    reset(): CapabilitySettings;
    subscribe(listener: CapabilityRuntimeListener, emitCurrent?: boolean): () => void;
}
export interface CapabilitySearchRegistry {
    registerSearchProvider(provider: CodexSearchProvider): () => void;
}
/** Dynamically expose search and clamp every request to the live result limit. */
export declare function bindCapabilitySearch(state: CapabilityRuntimeState, registry: CapabilitySearchRegistry, provider: CodexSearchProvider): () => void;
export interface CapabilityToolRegistry {
    register(definition: ToolDefinition): () => void;
}
/** Return whether one optional tool should currently be advertised. */
export declare function capabilityToolEnabled(name: string, settings: CapabilitySettings): boolean;
/** Dynamically advertise only enabled tools; execute-time guards remain in each definition. */
export declare function bindCapabilityTools(state: CapabilityRuntimeState, registry: CapabilityToolRegistry, definitions: readonly ToolDefinition[]): () => void;
export interface ReplaceableAdapterRegistration {
    replace(routes: string[]): void;
}
export interface CapabilityTimer {
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}
export interface CodexFastBindingOptions {
    readonly refreshIntervalMs?: number;
    readonly timer?: CapabilityTimer;
    readonly onError?: (error: unknown) => void;
}
/**
 * Publish the Fast route only after a fresh live catalog explicitly lists at
 * least one priority-eligible model. Disabling is synchronous; stale or failed
 * refreshes atomically withdraw the optional route.
 */
export declare function bindCodexFastRoute(state: CapabilityRuntimeState, capabilities: CodexModelCapabilities, registration: ReplaceableAdapterRegistration, options?: CodexFastBindingOptions): () => void;
//# sourceMappingURL=capability-runtime.d.ts.map
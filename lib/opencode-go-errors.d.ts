/**
 * Classify OpenCode Go upstream HTTP failures at the network boundary.
 * RegionError must not be treated as an invalid API key.
 */
/** Return the upstream RegionError message when the body is a China opt-in rejection. */
export declare function parseOpenCodeGoRegionError(bodyText: string): string | undefined;
export type OpenCodeGoUpstreamErrorClass = {
    readonly code: "region-opt-in-required" | "credential-rejected" | "upstream-failed";
    readonly message: string;
};
/** Shared parser for directory and chat-path upstream failures. */
export declare function classifyOpenCodeGoUpstreamError(status: number, bodyText: string): OpenCodeGoUpstreamErrorClass;
/** Directory fetch maps the shared class onto connection error codes. */
export declare function classifyOpenCodeGoDirectoryFailure(status: number, bodyText: string): {
    code: string;
    message: string;
};
//# sourceMappingURL=opencode-go-errors.d.ts.map
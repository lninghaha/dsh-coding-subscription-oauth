/**
 * Plugin-owned OpenCode Go identifiers.
 *
 * Isolated from the pi-ai builtin provider id `opencode-go` so DSH-native Go
 * and this plugin's connect → apply → chat path do not share settings or
 * session-header hooks.
 */
export declare const OPENCODE_GO_PROVIDER_ID: "coding-opencode-go";
/** Historical plugin takeover target / pi-ai builtin id. */
export declare const OPENCODE_GO_LEGACY_PROVIDER_ID: "opencode-go";
export declare const OPENCODE_GO_GATEWAY_PREFIX: "coding-opencode-go/";
export declare const OPENCODE_GO_LEGACY_GATEWAY_PREFIX: "opencode-go/";
export declare function isOpenCodeGoGatewayModel(model: string): boolean;
export declare function stripOpenCodeGoGatewayPrefix(model: string): string | undefined;
export declare function openCodeGoGatewayModelId(modelId: string): string;
//# sourceMappingURL=opencode-go-ids.d.ts.map
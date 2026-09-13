import { GatewayRequestError } from "./gateway-backend.ts";
import { OPENCODE_GO_LEGACY_PROVIDER_ID, OPENCODE_GO_PROVIDER_ID } from "./opencode-go-ids.ts";
import { goBaseURL, isGoApi } from "./opencode-go-protocol.ts";

export const GO_PROTOCOL_PATHS = {
	"openai-completions": "/v1/chat/completions",
	"openai-responses": "/v1/responses",
	"anthropic-messages": "/v1/messages",
} as const;
export type GoProtocol = keyof typeof GO_PROTOCOL_PATHS;
export interface GatewayGoRoute {
	credentialRef: string;
	models: Array<{ id: string; protocol: GoProtocol }>;
}
export function parseGatewayGoRoute(value: unknown): GatewayGoRoute | null {
	if (value === null) return null;
	const invalid = (): never => {
		throw new GatewayRequestError(
			400,
			"invalid_go_route",
			"Choose a Go credential reference and explicit model/protocol mappings",
		);
	};
	if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
	const row = value as Record<string, unknown>;
	if (typeof row["credentialRef"] !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(row["credentialRef"]))
		return invalid();
	if (!Array.isArray(row["models"]) || row["models"].length === 0) return invalid();
	const seen = new Set<string>();
	const models = row["models"].map((entry: unknown) => {
		if (!entry || typeof entry !== "object") return invalid();
		const { id, protocol } = entry as Record<string, unknown>;
		if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) || seen.has(id)) return invalid();
		if (typeof protocol !== "string" || !Object.hasOwn(GO_PROTOCOL_PATHS, protocol)) return invalid();
		seen.add(id);
		return { id, protocol: protocol as GoProtocol };
	});
	return { credentialRef: row["credentialRef"], models };
}

function previewFromProvider(
	provider:
		| { apiKeyEnv?: string; baseURL?: string; api?: string; models?: Array<{ id: string; api?: string }> }
		| undefined,
): GatewayGoRoute | null {
	if (!provider || !isGoApi(provider.api) || provider.baseURL?.replace(/\/+$/u, "") !== goBaseURL(provider.api))
		return null;
	try {
		return parseGatewayGoRoute({
			credentialRef: provider.apiKeyEnv,
			models: provider.models?.map((model) => ({ id: model.id, protocol: provider.api })),
		});
	} catch {
		return null;
	}
}

/** Prefer the isolated plugin provider; fall back to legacy takeover for migration preview. */
export function gatewayGoPreview(
	settings: { describe(options?: { redactSecrets?: boolean }): readonly { ns: string; value?: unknown }[] } | undefined,
): GatewayGoRoute | null {
	const value = settings?.describe({ redactSecrets: true }).find((entry) => entry.ns === "llm-pi-ai")?.value as
		| {
				providers?: Record<
					string,
					{ apiKeyEnv?: string; baseURL?: string; api?: string; models?: Array<{ id: string; api?: string }> }
				>;
		  }
		| undefined;
	return (
		previewFromProvider(value?.providers?.[OPENCODE_GO_PROVIDER_ID]) ??
		previewFromProvider(value?.providers?.[OPENCODE_GO_LEGACY_PROVIDER_ID])
	);
}

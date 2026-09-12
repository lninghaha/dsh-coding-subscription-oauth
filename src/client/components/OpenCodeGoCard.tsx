import { useCallback, useEffect, useState } from "react";
import { jsonRequest } from "../api.ts";
import { OPENCODE_GO_CONNECTION_PATH } from "../constants.ts";
import type { GrokBuildSettingsKey } from "../locales.ts";
import type { CodingOAuthStatus, GrokBuildSettingsInjected } from "../types.ts";
import { type GoModel, type GoSnapshot, OpenCodeGoConnectionView } from "./OpenCodeGoConnectionView.tsx";
export function OpenCodeGoCard({
	t,
	fallback,
	onStartConversation,
}: {
	t: GrokBuildSettingsInjected["t"];
	fallback: CodingOAuthStatus["opencodeGo"];
	onStartConversation?: (() => void) | undefined;
}) {
	const [status, setStatus] = useState<GoSnapshot>();
	const [error, setError] = useState<string>();
	const accept = useCallback((next: GoSnapshot) => {
		setStatus((current) =>
			!current || (next.configuration.revision ?? 0) >= (current.configuration.revision ?? 0) ? next : current,
		);
		return next;
	}, []);
	const reload = useCallback(async () => {
		try {
			const next = await jsonRequest<GoSnapshot>(OPENCODE_GO_CONNECTION_PATH);
			accept(next);
			setError(undefined);
			return next;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : t("requestFailed"));
			return undefined;
		}
	}, [accept, t]);
	useEffect(() => {
		void reload();
	}, [reload]);
	useEffect(() => {
		const focus = () => {
			void reload();
		};
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [reload]);
	const call = (fallback.updatedAt ?? 0) >= (status?.call.updatedAt ?? 0) ? fallback : status?.call;
	return (
		<OpenCodeGoConnectionView
			status={status}
			{...(call ? { call } : {})}
			{...(error ? { loadError: error } : {})}
			t={(key, params) =>
				t(
					(key.startsWith("status.")
						? "opencodeGoStatus." + key.slice(7)
						: "opencodeGo" + key[0]!.toUpperCase() + key.slice(1)) as GrokBuildSettingsKey,
					params,
				)
			}
			onReload={reload}
			onSaveCredential={async (input) =>
				accept(await jsonRequest<GoSnapshot>(OPENCODE_GO_CONNECTION_PATH, "POST", { action: "credential", ...input }))
			}
			onLoadModels={(ref) =>
				jsonRequest<{ status: GoSnapshot; models: GoModel[] }>(
					`${OPENCODE_GO_CONNECTION_PATH}?models=1&credentialRef=${encodeURIComponent(ref)}`,
				)
			}
			onApply={async (input) =>
				accept(await jsonRequest<GoSnapshot>(OPENCODE_GO_CONNECTION_PATH, "POST", { action: "apply", ...input }))
			}
			onStartConversation={onStartConversation}
		/>
	);
}

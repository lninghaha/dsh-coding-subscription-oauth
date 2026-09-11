import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonRequest } from "../api.ts";
import { OPENCODE_GO_CONNECTION_PATH } from "../constants.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	errorStyle,
	inputStyle,
	primaryButtonStyle,
	rowStyle,
	titleStyle,
} from "../styles.ts";
import type { CodingOAuthStatus, GrokBuildSettingsInjected } from "../types.ts";
import { Badge } from "./Badge.tsx";

interface Model {
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
}
interface ConnectionStatus {
	credential: {
		selectedRef: string;
		configured: boolean;
		writable: boolean;
		requiresChoice: boolean;
		candidates: Array<{ ref: string; configured: boolean }>;
	};
	configuration: { revision: number | null; writable: boolean; ready: boolean; conflicts: string[]; models: Model[] };
	call: CodingOAuthStatus["opencodeGo"];
}

export function OpenCodeGoCard({
	t,
	fallback,
}: {
	t: GrokBuildSettingsInjected["t"];
	fallback: CodingOAuthStatus["opencodeGo"];
}) {
	const [status, setStatus] = useState<ConnectionStatus>();
	const [credentialRef, setCredentialRef] = useState("OPENCODE_GO_API_KEY");
	const [apiKey, setApiKey] = useState("");
	const [models, setModels] = useState<Model[]>([]);
	const [modelId, setModelId] = useState("");
	const [confirmConflicts, setConfirmConflicts] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const currentCall = status?.call ?? fallback;
	const choices = useMemo(() => (models.length > 0 ? models : (status?.configuration.models ?? [])), [models, status]);

	const run = useCallback(
		async (action: () => Promise<ConnectionStatus>): Promise<ConnectionStatus | undefined> => {
			setBusy(true);
			setError(undefined);
			try {
				const next = await action();
				setStatus(next);
				return next;
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : t("requestFailed"));
				return undefined;
			} finally {
				setBusy(false);
			}
		},
		[t],
	);
	useEffect(() => {
		void run(() => jsonRequest<ConnectionStatus>(OPENCODE_GO_CONNECTION_PATH));
	}, [run]);
	const selectedRef = status?.credential.selectedRef;
	useEffect(() => {
		if (selectedRef !== undefined) setCredentialRef(selectedRef);
	}, [selectedRef]);
	useEffect(() => {
		if (modelId === "" && choices.length > 0)
			setModelId(
				choices.some((entry) => entry.id === "deepseek-v4.1-flash") ? "deepseek-v4.1-flash" : (choices[0]?.id ?? ""),
			);
	}, [choices, modelId]);

	const saveCredential = () =>
		void run(async () => {
			const next = await jsonRequest<ConnectionStatus>(OPENCODE_GO_CONNECTION_PATH, "POST", {
				action: "credential",
				credentialRef,
				...(apiKey === "" ? {} : { apiKey }),
			});
			setApiKey("");
			return next;
		});
	const fetchModels = () =>
		void (async () => {
			setBusy(true);
			setError(undefined);
			try {
				const result = await jsonRequest<{ status: ConnectionStatus; models: Model[] }>(
					`${OPENCODE_GO_CONNECTION_PATH}?models=1&credentialRef=${encodeURIComponent(credentialRef)}`,
				);
				setStatus(result.status);
				setModels(result.models);
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : t("requestFailed"));
			} finally {
				setBusy(false);
			}
		})();
	const apply = () =>
		void run(() =>
			jsonRequest<ConnectionStatus>(OPENCODE_GO_CONNECTION_PATH, "POST", {
				action: "apply",
				credentialRef,
				model: choices.find((entry) => entry.id === modelId) ?? { id: modelId.trim() },
				expectedRevision: status?.configuration.revision,
				confirmConflicts,
			}),
		);

	return (
		<div style={cardStyle} data-opencode-go-status={currentCall.lastCall}>
			<div style={rowStyle}>
				<div>
					<h3 style={{ ...titleStyle, fontSize: 16 }}>{t("opencodeGoTitle")}</h3>
					<p style={{ ...bodyStyle, marginTop: 4 }}>{t("opencodeGoDescription")}</p>
					<p style={{ ...bodyStyle, marginTop: 4 }}>{t(`opencodeGoStatus.${currentCall.lastCall}`)}</p>
					<p style={{ ...bodyStyle, marginTop: 4 }}>{t("opencodeGoCompatibilityNote")}</p>
				</div>
				<Badge
					label={
						status?.configuration.ready
							? t("opencodeGoReady")
							: fallback.active
								? t("opencodeGoActive")
								: t("opencodeGoInactive")
					}
					tone={status?.configuration.ready ? "success" : "neutral"}
					installed={status?.configuration.ready === true}
				/>
			</div>
			<label style={bodyStyle}>
				{t("opencodeGoCredential")}
				<select
					style={{ ...inputStyle, marginTop: 5 }}
					value={credentialRef}
					disabled={busy}
					onChange={(event) => setCredentialRef(event.target.value)}
				>
					{(status?.credential.candidates ?? [{ ref: credentialRef, configured: false }]).map((candidate) => (
						<option key={candidate.ref} value={candidate.ref}>
							{candidate.ref}
							{candidate.configured ? ` · ${t("opencodeGoConfigured")}` : ""}
						</option>
					))}
				</select>
			</label>
			{status?.credential.requiresChoice ? <p style={errorStyle}>{t("opencodeGoChooseCredential")}</p> : null}
			<label style={bodyStyle}>
				{t("opencodeGoApiKey")}
				<input
					style={{ ...inputStyle, marginTop: 5 }}
					type="password"
					autoComplete="off"
					value={apiKey}
					placeholder={status?.credential.configured ? t("opencodeGoReuseHint") : "sk-…"}
					disabled={busy}
					onChange={(event) => setApiKey(event.target.value)}
				/>
			</label>
			<div style={rowStyle}>
				<button
					type="button"
					style={buttonStyle}
					disabled={busy || (apiKey === "" && status?.credential.configured !== true)}
					onClick={saveCredential}
				>
					{apiKey === "" ? t("opencodeGoReuse") : t("opencodeGoSaveKey")}
				</button>
				<button
					type="button"
					style={buttonStyle}
					disabled={busy || status?.credential.configured !== true}
					onClick={fetchModels}
				>
					{t("opencodeGoFetchModels")}
				</button>
			</div>
			<label style={bodyStyle}>
				{t("opencodeGoModel")}
				<input
					list="standalone-opencode-go-models"
					style={{ ...inputStyle, marginTop: 5 }}
					value={modelId}
					disabled={busy}
					onChange={(event) => setModelId(event.target.value)}
				/>
				<datalist id="standalone-opencode-go-models">
					{choices.map((entry) => (
						<option key={entry.id} value={entry.id}>
							{entry.name ?? entry.id}
						</option>
					))}
				</datalist>
			</label>
			{(status?.configuration.conflicts.length ?? 0) > 0 ? (
				<label style={bodyStyle}>
					<input
						type="checkbox"
						checked={confirmConflicts}
						onChange={(event) => setConfirmConflicts(event.target.checked)}
					/>{" "}
					{t("opencodeGoConfirmConflict", { conflicts: status?.configuration.conflicts.join(", ") ?? "" })}
				</label>
			) : null}
			<button
				type="button"
				style={primaryButtonStyle}
				disabled={
					busy ||
					status?.credential.configured !== true ||
					status.configuration.revision === null ||
					modelId.trim() === "" ||
					((status.configuration.conflicts.length ?? 0) > 0 && !confirmConflicts)
				}
				onClick={apply}
			>
				{t("opencodeGoApply")}
			</button>
			{status?.configuration.ready ? <p style={bodyStyle}>{t("opencodeGoStartHint")}</p> : null}
			{error === undefined ? null : (
				<p role="alert" style={errorStyle}>
					{error}
				</p>
			)}
		</div>
	);
}

import { useEffect, useRef, useState } from "react";
import { GO_APIS, type GoApi, isGoApi, knownGoApi } from "../../opencode-go-protocol.ts";

export interface GoModel {
	readonly id: string;
	readonly name?: string | undefined;
	readonly contextWindow?: number | undefined;
	readonly maxTokens?: number | undefined;
	readonly protocol?: string | undefined;
	readonly reasoningEfforts?: false | Record<string, string | null> | undefined;
}
export interface GoSnapshot {
	readonly credential: {
		readonly selectedRef: string;
		readonly configured: boolean;
		readonly writable: boolean;
		readonly requiresChoice: boolean;
		readonly candidates: readonly { readonly ref: string; readonly configured: boolean; readonly writable: boolean }[];
	};
	readonly configuration: {
		readonly api?: string | null | undefined;
		readonly revision: number | null;
		readonly writable: boolean;
		readonly ready: boolean;
		readonly conflicts: readonly string[];
		readonly models: readonly GoModel[];
	};
	readonly call: {
		readonly active: boolean;
		readonly lastCall: "no-call" | "success" | "failure" | "missing-session";
		readonly updatedAt: number | null;
		readonly pending?: boolean | undefined;
		readonly streamStatus?: string | undefined;
		readonly configurationConflict?: boolean | undefined;
	};
}
export type GoViewKey =
	| "protocol"
	| "protocolHint"
	| "title"
	| "description"
	| "configured"
	| "credential"
	| "apiKey"
	| "reuseHint"
	| "reuse"
	| "saveKey"
	| "fetchModels"
	| "model"
	| "modelsHint"
	| "modelsEmpty"
	| "selectMatching"
	| "clearModels"
	| "chooseCredential"
	| "apply"
	| "startConversation"
	| "edit"
	| "cancel"
	| "reload"
	| "credentialSaved"
	| "directoryLoaded"
	| "applied"
	| "readOnly"
	| "configurationChanged"
	| "conflictPreview"
	| "confirmConflict"
	| "status.no-call"
	| "status.success"
	| "status.failure"
	| "status.missing-session"
	| "status.pending"
	| "status.cancelled"
	| "status.conflict";
export interface GoViewProps {
	readonly status: GoSnapshot | undefined;
	readonly call?: GoSnapshot["call"];
	readonly loadError?: string;
	readonly t: (key: GoViewKey, params?: Record<string, string | number>) => string;
	readonly onReload: () => Promise<GoSnapshot | undefined>;
	readonly onSaveCredential: (input: { credentialRef: string; apiKey?: string }) => Promise<GoSnapshot>;
	readonly onLoadModels: (ref: string) => Promise<{ models: readonly GoModel[] }>;
	readonly onApply: (input: {
		api?: GoApi;
		credentialRef: string;
		models: readonly GoModel[];
		expectedRevision: number;
		confirmConflicts: boolean;
	}) => Promise<GoSnapshot>;
	readonly onStartConversation?: (() => void) | undefined;
}

const field = { display: "flex", flexDirection: "column", gap: 5 } as const;
const actions = { display: "flex", flexWrap: "wrap", gap: 8 } as const;
const control = {
	padding: "7px 10px",
	font: "inherit",
	borderRadius: 6,
	border: "1px solid var(--dsw-alias-border-subtle, #777)",
	color: "inherit",
	background: "var(--dsw-alias-bg-layer-1, transparent)",
} as const;
const modelListStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 4,
	maxHeight: 220,
	overflow: "auto",
	padding: 8,
	border: "1px solid var(--dsw-alias-border-subtle, #777)",
	borderRadius: 6,
	minWidth: 0,
} as const;

/** 两个独立插件使用同一操作契约；已保存快照与当前表单草稿分开。 */
export function OpenCodeGoConnectionView({
	status,
	call,
	loadError,
	t,
	onReload,
	onSaveCredential,
	onLoadModels,
	onApply,
	onStartConversation,
}: GoViewProps) {
	const [editing, setEditing] = useState<boolean | null>(null);
	const [dirty, setDirty] = useState(false);
	const [credentialRef, setCredentialRef] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [enabledIds, setEnabledIds] = useState<string[]>([]);
	const [api, setApi] = useState<GoApi>("openai-completions");
	const [revision, setRevision] = useState<number | null>(null);
	const [catalog, setCatalog] = useState<readonly GoModel[]>([]);
	const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
	const confirmed = confirmedRevision !== null && confirmedRevision === status?.configuration.revision;
	const setConfirmed = (value: boolean): void =>
		setConfirmedRevision(value ? (status?.configuration.revision ?? null) : null);
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<GoViewKey>();
	const [pending, setPending] = useState(false);
	const running = useRef(false);
	const showingForm = editing ?? (status !== undefined && !status.configuration.ready);
	const candidate = status?.credential.candidates.find((item) => item.ref === credentialRef);
	const choices = catalog.length ? catalog : (status?.configuration.models ?? []);
	const visibleChoices = choices.filter((model) => {
		const suggested = knownGoApi(model.id) ?? (isGoApi(model.protocol) ? model.protocol : undefined);
		return suggested === undefined || suggested === api;
	});
	const conflicts = [...(status?.configuration.conflicts ?? [])];
	if (status?.configuration.api && api !== status.configuration.api && !conflicts.includes("protocol"))
		conflicts.push("protocol");
	const currentCall = call ?? status?.call;
	const callKey: GoViewKey = currentCall?.pending
		? "status.pending"
		: currentCall?.configurationConflict
			? "status.conflict"
			: currentCall?.streamStatus === "cancelled"
				? "status.cancelled"
				: `status.${currentCall?.lastCall ?? "no-call"}`;
	useEffect(() => {
		if (!status || dirty || pending) return;
		setCredentialRef(status.credential.requiresChoice ? "" : status.credential.selectedRef);
		setRevision(status.configuration.revision);
		setEnabledIds(status.configuration.models.map((model) => model.id));
		setApi(isGoApi(status.configuration.api) ? status.configuration.api : "openai-completions");
	}, [status, dirty, pending]);
	const change = (): void => {
		setDirty(true);
		setNotice(undefined);
	};
	const run = (action: () => Promise<void>): void => {
		if (running.current) return;
		running.current = true;
		setPending(true);
		setError(undefined);
		void action()
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t("status.failure")))
			.finally(() => {
				running.current = false;
				setPending(false);
			});
	};
	const toggleModel = (id: string, checked: boolean): void => {
		change();
		setEnabledIds((current) => {
			if (checked) return current.includes(id) ? current : [...current, id];
			return current.filter((entry) => entry !== id);
		});
		setConfirmed(false);
	};
	return (
		<article
			className="dus-oauth-card"
			data-opencode-go-status={currentCall?.lastCall ?? "loading"}
			data-unsaved={dirty || apiKey !== "" ? "true" : undefined}
			style={{
				padding: 16,
				display: "flex",
				flexDirection: "column",
				gap: 12,
				border: "1px solid var(--dsw-alias-border-subtle, #777)",
				borderRadius: 10,
				minWidth: 0,
			}}
		>
			<div style={{ ...actions, justifyContent: "space-between", alignItems: "center" }}>
				<strong>{t("title")}</strong>
				{status?.configuration.ready ? <span>{t("configured")}</span> : null}
			</div>
			<p style={{ margin: 0 }}>{t(callKey)}</p>
			{status?.configuration.ready ? (
				<p style={{ margin: 0, overflowWrap: "anywhere" }}>
					{status.configuration.models.map((model) => model.name ?? model.id).join(" · ")}
				</p>
			) : (
				<p style={{ margin: 0 }}>{t("description")}</p>
			)}
			<div style={actions}>
				{status?.configuration.ready && onStartConversation ? (
					<button type="button" style={control} disabled={pending || dirty} onClick={onStartConversation}>
						{t("startConversation")}
					</button>
				) : null}
				{!showingForm && status ? (
					<button type="button" style={control} onClick={() => setEditing(true)}>
						{t("edit")}
					</button>
				) : null}
			</div>
			{showingForm ? (
				<div style={{ ...field, gap: 12 }}>
					<label style={field}>
						{t("credential")}
						<select
							style={control}
							value={credentialRef}
							disabled={pending}
							onChange={(event) => {
								change();
								setCredentialRef(event.target.value);
							}}
						>
							<option value="">{t("chooseCredential")}</option>
							{status?.credential.candidates.map((item) => (
								<option key={item.ref} value={item.ref}>
									{item.ref}
									{item.configured ? ` · ${t("configured")}` : ""}
								</option>
							))}
						</select>
					</label>
					<label style={field}>
						{t("apiKey")}
						<input
							style={control}
							type="password"
							autoComplete="off"
							value={apiKey}
							disabled={pending || candidate?.writable !== true}
							placeholder={candidate?.configured ? t("reuseHint") : ""}
							onChange={(event) => {
								change();
								setApiKey(event.target.value);
							}}
						/>
					</label>
					{candidate?.writable === false || status?.configuration.writable === false ? <p>{t("readOnly")}</p> : null}
					<div style={actions}>
						<button
							style={control}
							type="button"
							disabled={pending || !credentialRef || (apiKey ? !candidate?.writable : !candidate?.configured)}
							onClick={() =>
								run(async () => {
									if (!credentialRef || (apiKey ? !candidate?.writable : !candidate?.configured)) return;
									await onSaveCredential({ credentialRef, ...(apiKey ? { apiKey } : {}) });
									setApiKey("");
									setNotice("credentialSaved");
								})
							}
						>
							{apiKey ? t("saveKey") : t("reuse")}
						</button>
						<button
							style={control}
							type="button"
							disabled={pending || !candidate?.configured}
							onClick={() =>
								run(async () => {
									if (!candidate?.configured) return;
									const result = await onLoadModels(credentialRef);
									setCatalog(result.models);
									setDirty(true);
									const matching = result.models.filter((model) => {
										const suggested = knownGoApi(model.id);
										return suggested === undefined || suggested === api;
									});
									if (enabledIds.length === 0) {
										const preferred = matching.find((model) => model.id === "deepseek-v4.1-flash") ?? matching[0];
										setEnabledIds(preferred ? [preferred.id] : []);
									}
									setNotice("directoryLoaded");
								})
							}
						>
							{t("fetchModels")}
						</button>
					</div>
					<label style={field}>
						{t("protocol")}
						<select
							aria-label={t("protocol")}
							style={control}
							value={api}
							disabled={pending || !status?.configuration.writable}
							onChange={(event) => {
								change();
								const next = event.target.value as GoApi;
								setApi(next);
								setEnabledIds((current) =>
									current.filter((id) => {
										const suggested = knownGoApi(id);
										return suggested === undefined || suggested === next;
									}),
								);
								setConfirmed(false);
							}}
						>
							{GO_APIS.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<p>{t("protocolHint")}</p>
					<div style={field}>
						<span>{t("model")}</span>
						<p style={{ margin: 0 }}>{t("modelsHint")}</p>
						<div style={actions}>
							<button
								type="button"
								style={control}
								disabled={pending || status?.configuration.writable !== true || visibleChoices.length === 0}
								onClick={() => {
									change();
									setEnabledIds(visibleChoices.map((model) => model.id));
									setConfirmed(false);
								}}
							>
								{t("selectMatching")}
							</button>
							<button
								type="button"
								style={control}
								disabled={pending || status?.configuration.writable !== true || enabledIds.length === 0}
								onClick={() => {
									change();
									setEnabledIds([]);
									setConfirmed(false);
								}}
							>
								{t("clearModels")}
							</button>
						</div>
						<fieldset
							aria-label={t("model")}
							style={{ ...modelListStyle, border: "none", margin: 0, padding: 0, minWidth: 0 }}
						>
							{visibleChoices.length === 0 ? (
								<p style={{ margin: 0 }}>{t("modelsEmpty")}</p>
							) : (
								visibleChoices.map((model) => {
									const label = model.name ?? model.id;
									const efforts = model.reasoningEfforts;
									// Show selectable levels: off may be null; other levels need a wire string.
									const thinking =
										efforts && typeof efforts === "object"
											? Object.entries(efforts)
													.filter(
														([level, wire]) => level === "off" || (typeof wire === "string" && wire.trim() !== ""),
													)
													.map(([level]) => level)
											: [];
									return (
										<label key={model.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
											<input
												type="checkbox"
												checked={enabledIds.includes(model.id)}
												disabled={pending || status?.configuration.writable !== true}
												onChange={(event) => toggleModel(model.id, event.target.checked)}
											/>
											<span style={{ overflowWrap: "anywhere" }}>
												{label}
												{thinking.length > 0 ? ` · thinking: ${thinking.join("/")}` : ""}
											</span>
										</label>
									);
								})
							)}
						</fieldset>
					</div>
					{status && revision !== status.configuration.revision ? (
						<p role="status">{t("configurationChanged")}</p>
					) : null}
					{conflicts.length ? (
						<div>
							<p>{t("conflictPreview", { conflicts: conflicts.join(", ") })}</p>
							<label>
								<input
									type="checkbox"
									checked={confirmed}
									disabled={pending}
									onChange={(event) => setConfirmed(event.target.checked)}
								/>{" "}
								{t("confirmConflict")}
							</label>
						</div>
					) : null}
					<div style={actions}>
						<button
							style={control}
							type="button"
							disabled={
								pending ||
								!candidate?.configured ||
								!status?.configuration.writable ||
								revision === null ||
								(!!conflicts.length && !confirmed)
							}
							onClick={() =>
								run(async () => {
									if (
										!candidate?.configured ||
										!status?.configuration.writable ||
										revision === null ||
										(conflicts.length && !confirmed)
									)
										return;
									const byId = new Map(choices.map((item) => [item.id, item]));
									const saved = await onApply({
										api,
										credentialRef,
										models: enabledIds.map((id) => byId.get(id) ?? { id }),
										expectedRevision: revision,
										confirmConflicts: confirmed,
									});
									setRevision(saved.configuration.revision);
									setDirty(false);
									setEditing(false);
									setNotice("applied");
								})
							}
						>
							{t("apply")}
						</button>
						<button
							style={control}
							type="button"
							disabled={pending}
							onClick={() =>
								run(async () => {
									const latest = await onReload();
									if (latest) setRevision(latest.configuration.revision);
									setConfirmed(false);
								})
							}
						>
							{t("reload")}
						</button>
						<button
							style={control}
							type="button"
							disabled={pending}
							onClick={() =>
								run(async () => {
									await onReload();
									setApiKey("");
									setDirty(false);
									setEditing(false);
									setNotice(undefined);
								})
							}
						>
							{t("cancel")}
						</button>
					</div>
				</div>
			) : null}
			{notice ? (
				<p role="status" style={{ margin: 0 }}>
					{t(notice)}
				</p>
			) : null}
			{error || loadError ? (
				<div role="alert">
					<p>{error ?? loadError}</p>
					{!showingForm ? (
						<button
							style={control}
							type="button"
							onClick={() =>
								run(async () => {
									await onReload();
								})
							}
						>
							{t("reload")}
						</button>
					) : null}
				</div>
			) : null}
		</article>
	);
}

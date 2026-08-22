/** Single provider account card for the Accounts tab. */

import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_REASON_KEY } from "../constants.ts";
import { methodLabel, orderedLoginMethods, shouldShowPerCardSourceReason } from "../display.ts";
import { formatEpoch, modelFields, usageHasVisibleFields } from "../parsers.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	checkRowStyle,
	codeStyle,
	compactButtonStyle,
	hintStyle,
	inputStyle,
	listStyle,
	monoStyle,
	nestedStyle,
	primaryButtonStyle,
	rowStyle,
	stepActiveStyle,
	stepNumberActiveStyle,
	stepNumberStyle,
	stepRowStyle,
	titleStyle,
	visuallyHiddenStyle,
} from "../styles.ts";
import type {
	GrokBuildSettingsInjected,
	GrokStatus,
	LoginMethod,
	ProviderCardDefinition,
	ProviderStatus,
	SourceStatus,
	UsageView,
} from "../types.ts";
import { Badge } from "./Badge.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { ProgressBar } from "./ProgressBar.tsx";

export interface ProviderCardProps {
	t: GrokBuildSettingsInjected["t"];
	definition: ProviderCardDefinition;
	providerStatus: ProviderStatus;
	busy: boolean;
	sourcesBusy: boolean;
	remote: boolean;
	codeInput: string;
	popupBlocked: boolean;
	expanded: boolean;
	source: SourceStatus | undefined;
	showUsage: boolean;
	usage: UsageView | undefined;
	usageError: string | undefined;
	usageLoading: boolean;
	onSignIn: (method: LoginMethod) => void;
	onSignOut: () => void;
	onCancelLogin: () => void;
	onSubmitCode: () => void;
	onCodeChange: (value: string) => void;
	onToggleExpanded: () => void;
	onPreviewSource: () => void;
	onSaveModels: (selected: string[]) => void;
}

function SignInSteps({
	t,
	activeMethod,
	userCode,
	url,
	popupBlocked,
}: {
	t: GrokBuildSettingsInjected["t"];
	activeMethod: LoginMethod;
	userCode: string | undefined;
	url: string | undefined;
	popupBlocked: boolean;
}) {
	const hasCode = userCode !== undefined && userCode.length > 0;
	const hasUrl = url !== undefined && url.length > 0;
	const needsPaste = activeMethod !== "device";

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div style={hasUrl ? stepActiveStyle : stepRowStyle}>
				<span style={hasUrl ? stepNumberActiveStyle : stepNumberStyle} aria-hidden="true">
					1
				</span>
				<span>{t("signInStepOpen")}</span>
			</div>
			{hasUrl ? (
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 32 }}>
					<a href={url} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
						{t("openAuthUrl")}
					</a>
					<CopyButton text={url} idleLabel={t("copy")} copiedLabel={t("copied")} failedLabel={t("copyFailed")} />
				</div>
			) : null}
			{popupBlocked && hasUrl ? <p style={hintStyle}>{t("popupBlocked")}</p> : null}
			{hasCode ? (
				<>
					<div style={stepActiveStyle}>
						<span style={stepNumberActiveStyle} aria-hidden="true">
							2
						</span>
						<span>{t("signInStepCode")}</span>
					</div>
					<div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingLeft: 32 }}>
						<span style={codeStyle}>{userCode}</span>
						<CopyButton
							text={userCode}
							idleLabel={t("copyUserCode")}
							copiedLabel={t("copied")}
							failedLabel={t("copyFailed")}
							primary
						/>
					</div>
				</>
			) : null}
			<div style={stepActiveStyle}>
				<span style={stepNumberActiveStyle} aria-hidden="true">
					{hasCode ? 3 : 2}
				</span>
				<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
					<span
						aria-hidden="true"
						style={{
							width: 14,
							height: 14,
							border: "2px solid var(--dsw-alias-brand-primary, #1677ff)",
							borderTopColor: "transparent",
							borderRadius: "50%",
							animation: "dsh-coding-oauth-spin 0.8s linear infinite",
						}}
					/>
					{t("signInStepWait")}
				</span>
			</div>
			{needsPaste ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 32 }}>
					<p style={bodyStyle}>{t(activeMethod === "browser" ? "pasteBrowserCodeHint" : "pasteCodeHint")}</p>
				</div>
			) : null}
		</div>
	);
}

export function ProviderCard({
	t,
	definition,
	providerStatus,
	busy,
	sourcesBusy,
	remote,
	codeInput,
	popupBlocked,
	expanded,
	source,
	showUsage,
	usage,
	usageError,
	usageLoading,
	onSignIn,
	onSignOut,
	onCancelLogin,
	onSubmitCode,
	onCodeChange,
	onToggleExpanded,
	onPreviewSource,
	onSaveModels,
}: ProviderCardProps) {
	const [showAltMethods, setShowAltMethods] = useState(false);
	const [modelFilter, setModelFilter] = useState("");
	const [logoutConfirm, setLogoutConfirm] = useState(false);
	const logoutTrigger = useRef<HTMLButtonElement>(null);
	const logoutConfirmAction = useRef<HTMLButtonElement>(null);
	const restoreLogoutFocus = useRef(false);

	const ordered = orderedLoginMethods(definition, remote);
	const primaryMethod: LoginMethod = ordered[0] ?? definition.recommended;
	const altMethods = ordered.filter((method) => method !== primaryMethod);

	const statusLabel =
		providerStatus.status === "signed-in"
			? t("signedIn")
			: providerStatus.status === "signing-in"
				? t("signingIn")
				: providerStatus.status === "error"
					? t("requestFailed")
					: t("signedOut");
	const activeMethod = providerStatus.status === "signing-in" ? providerStatus.method : primaryMethod;
	const { available, selected } = useMemo(() => modelFields(providerStatus), [providerStatus]);
	const [modelDraft, setModelDraft] = useState<string[]>(selected);
	useEffect(() => {
		setModelDraft(selected);
	}, [selected]);
	useEffect(() => {
		if (providerStatus.status !== "signed-in") setLogoutConfirm(false);
	}, [providerStatus.status]);
	useEffect(() => {
		if (logoutConfirm) {
			logoutConfirmAction.current?.focus();
			return;
		}
		if (!restoreLogoutFocus.current) return;
		restoreLogoutFocus.current = false;
		if (providerStatus.status === "signed-in") {
			logoutTrigger.current?.focus();
			return;
		}
		document.getElementById(`coding-oauth-login-${definition.slug}`)?.focus();
	}, [definition.slug, logoutConfirm, providerStatus.status]);
	const modelDraftDirty =
		modelDraft.length !== selected.length || modelDraft.some((model, index) => model !== selected[index]);
	const grokProviderStatus = definition.slug === "grok" ? (providerStatus as GrokStatus) : undefined;
	const showSourceReason = shouldShowPerCardSourceReason(source);

	const filteredModels = useMemo(() => {
		const query = modelFilter.trim().toLowerCase();
		if (query.length === 0) return available;
		return available.filter((id) => id.toLowerCase().includes(query));
	}, [available, modelFilter]);

	const usagePercent =
		definition.slug === "codex" && showUsage
			? usage?.individualRemainingPercent === undefined
				? usage?.rateLimits[0]?.windows[0]?.usedPercent
				: 100 - usage.individualRemainingPercent
			: undefined;
	const fetchedAt = formatEpoch(usage?.fetchedAt);

	return (
		<div style={cardStyle}>
			<div style={rowStyle}>
				<div>
					<h3 style={{ ...titleStyle, fontSize: 16 }}>{t(definition.titleKey)}</h3>
					{providerStatus.status === "signed-in" && !expanded ? (
						<p style={{ ...hintStyle, marginTop: 4 }}>
							{t("modelsSummary", { selected: selected.length, total: available.length })}
							{usagePercent === undefined ? "" : ` · ${t("usageUsedShort", { value: `${String(usagePercent)}%` })}`}
						</p>
					) : (
						<>
							<p style={{ ...bodyStyle, marginTop: 4 }}>{t(definition.descriptionKey)}</p>
							<p style={{ ...bodyStyle, marginTop: 4 }}>
								<span style={monoStyle}>{definition.route}</span>
							</p>
						</>
					)}
				</div>
				<Badge label={statusLabel} providerStatus={providerStatus.status} />
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{providerStatus.status === "signed-in" ? (
					<>
						{logoutConfirm ? (
							<fieldset style={{ ...nestedStyle, margin: 0, minWidth: 0 }}>
								<legend style={visuallyHiddenStyle}>{t("logoutConfirmTitle")}</legend>
								<p style={bodyStyle}>{t("logoutConfirmHint")}</p>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
									<button
										ref={logoutConfirmAction}
										type="button"
										style={primaryButtonStyle}
										disabled={busy}
										onClick={() => {
											restoreLogoutFocus.current = true;
											onSignOut();
										}}
									>
										{busy ? t("working") : t("logoutConfirmAction")}
									</button>
									<button
										type="button"
										style={buttonStyle}
										disabled={busy}
										onClick={() => {
											restoreLogoutFocus.current = true;
											setLogoutConfirm(false);
										}}
									>
										{t("cancel")}
									</button>
								</div>
							</fieldset>
						) : (
							<button
								ref={logoutTrigger}
								type="button"
								style={buttonStyle}
								disabled={busy}
								onClick={() => setLogoutConfirm(true)}
							>
								{t("logout")}
							</button>
						)}
						<button
							id={`coding-oauth-models-toggle-${definition.slug}`}
							type="button"
							style={buttonStyle}
							aria-expanded={expanded}
							aria-controls={expanded ? `coding-oauth-models-${definition.slug}` : undefined}
							onClick={onToggleExpanded}
						>
							{expanded ? t("collapseModels") : t("expandModels")}
						</button>
						{source?.available === true ? (
							<button
								id={`coding-oauth-source-pull-${definition.slug}`}
								type="button"
								style={buttonStyle}
								disabled={sourcesBusy}
								onClick={onPreviewSource}
							>
								{t("sourcesPullCopy")}
							</button>
						) : null}
					</>
				) : providerStatus.status === "signing-in" ? (
					<>
						<button type="button" style={buttonStyle} disabled={busy} onClick={onCancelLogin}>
							{t("cancelLogin")}
						</button>
						{altMethods.length > 0 ? (
							<button
								type="button"
								style={compactButtonStyle}
								disabled={busy}
								onClick={() => {
									setShowAltMethods((current) => !current);
								}}
							>
								{showAltMethods ? t("hideOtherLoginMethods") : t("otherLoginMethods")}
							</button>
						) : null}
						{showAltMethods
							? altMethods.map((method) => (
									<button
										key={method}
										type="button"
										style={compactButtonStyle}
										disabled={busy}
										onClick={() => {
											onSignIn(method);
										}}
									>
										{methodLabel(method, t, { remote, primary: false })}
									</button>
								))
							: null}
					</>
				) : (
					<>
						<button
							id={`coding-oauth-login-${definition.slug}`}
							type="button"
							style={primaryButtonStyle}
							disabled={busy}
							onClick={() => {
								onSignIn(primaryMethod);
							}}
						>
							{busy ? t("working") : methodLabel(primaryMethod, t, { remote, primary: true })}
						</button>
						{altMethods.length > 0 ? (
							<button
								type="button"
								style={compactButtonStyle}
								disabled={busy}
								onClick={() => {
									setShowAltMethods((current) => !current);
								}}
							>
								{showAltMethods ? t("hideOtherLoginMethods") : t("otherLoginMethods")}
							</button>
						) : null}
						{showAltMethods
							? altMethods.map((method) => (
									<button
										key={method}
										type="button"
										style={compactButtonStyle}
										disabled={busy}
										onClick={() => {
											onSignIn(method);
										}}
									>
										{methodLabel(method, t, { remote, primary: false })}
									</button>
								))
							: null}
						{source?.available === true ? (
							<button
								id={`coding-oauth-source-pull-${definition.slug}`}
								type="button"
								style={buttonStyle}
								disabled={sourcesBusy}
								onClick={onPreviewSource}
							>
								{t("sourcesPullCopy")}
							</button>
						) : showSourceReason && source?.reason !== undefined ? (
							<span style={hintStyle}>{t(SOURCE_REASON_KEY[source.reason])}</span>
						) : null}
					</>
				)}
			</div>
			{providerStatus.status === "error" ? (
				<p style={{ ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" }}>{providerStatus.message}</p>
			) : null}
			{providerStatus.status === "signing-in" ? (
				<SignInSteps
					t={t}
					activeMethod={activeMethod}
					userCode={providerStatus.userCode}
					url={providerStatus.url}
					popupBlocked={popupBlocked}
				/>
			) : null}
			{providerStatus.status === "signing-in" && activeMethod !== "device" ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<label htmlFor={`coding-oauth-code-${definition.slug}`} style={visuallyHiddenStyle}>
							{t("pasteCodeLabel")}
						</label>
						<input
							id={`coding-oauth-code-${definition.slug}`}
							style={{ ...inputStyle, flex: "1 1 360px" }}
							value={codeInput}
							placeholder={t("pasteCodePlaceholder")}
							disabled={busy}
							onChange={(event) => {
								onCodeChange(event.target.value);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									onSubmitCode();
								}
							}}
						/>
						<button
							type="button"
							style={primaryButtonStyle}
							disabled={busy || codeInput.trim().length === 0}
							onClick={onSubmitCode}
						>
							{t("submitCode")}
						</button>
					</div>
				</div>
			) : null}
			{providerStatus.status === "signed-in" && expanded ? (
				<div id={`coding-oauth-models-${definition.slug}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<div style={rowStyle}>
						<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("models")}</h4>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
							<button
								type="button"
								style={compactButtonStyle}
								disabled={busy}
								onClick={() => {
									setModelDraft([]);
								}}
							>
								{t("deselectAll")}
							</button>
							<button
								type="button"
								style={compactButtonStyle}
								disabled={busy}
								onClick={() => {
									setModelDraft([...available]);
								}}
							>
								{t("selectAll")}
							</button>
							<button
								type="button"
								style={compactButtonStyle}
								disabled={busy}
								onClick={() => {
									setModelDraft(available.length > 0 ? [available[0]!] : []);
								}}
							>
								{t("resetModelsDefault")}
							</button>
						</div>
					</div>
					<label htmlFor={`coding-oauth-model-filter-${definition.slug}`} style={visuallyHiddenStyle}>
						{t("modelFilterLabel", { provider: t(definition.titleKey) })}
					</label>
					<input
						id={`coding-oauth-model-filter-${definition.slug}`}
						type="search"
						style={inputStyle}
						value={modelFilter}
						placeholder={t("modelFilterPlaceholder")}
						disabled={busy}
						onChange={(event) => {
							setModelFilter(event.target.value);
						}}
					/>
					{grokProviderStatus?.status === "signed-in" ? (
						<p style={bodyStyle}>
							{grokProviderStatus.catalogSource === "live"
								? t("catalogLive")
								: grokProviderStatus.catalogSource === "cache"
									? t("catalogCache")
									: t("catalogFallback")}
						</p>
					) : null}
					<p style={bodyStyle}>
						{t("modelHint")} <span style={monoStyle}>{definition.route}/&lt;id&gt;</span>
					</p>
					<ul style={listStyle}>
						{filteredModels.map((id) => {
							const checked = modelDraft.includes(id);
							return (
								<li key={id}>
									<label style={checkRowStyle}>
										<input
											type="checkbox"
											checked={checked}
											disabled={busy}
											onChange={() => {
												const current = new Set(modelDraft);
												if (checked) current.delete(id);
												else current.add(id);
												setModelDraft([...available].filter((model) => current.has(model)));
											}}
										/>
										<span style={monoStyle}>{id}</span>
									</label>
								</li>
							);
						})}
					</ul>
					<div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
						<button
							type="button"
							style={primaryButtonStyle}
							disabled={busy || !modelDraftDirty}
							onClick={() => onSaveModels(modelDraft)}
						>
							{busy ? t("working") : t("applyModelDraft")}
						</button>
						{modelDraftDirty ? <span style={hintStyle}>{t("modelDraftPending")}</span> : null}
					</div>
					{filteredModels.length === 0 ? <p style={hintStyle}>{t("modelFilterPlaceholder")}</p> : null}
					{grokProviderStatus?.status === "signed-in" && grokProviderStatus.catalogError !== undefined ? (
						<p style={{ ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" }}>{t("catalogError")}</p>
					) : null}
					{definition.slug === "codex" && showUsage ? (
						<div style={nestedStyle}>
							<p style={{ ...bodyStyle, color: "var(--dsw-alias-label-primary)" }}>{t("usageTitle")}</p>
							{usageError === undefined ? null : (
								<p style={{ ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" }} role="alert">
									{usageError}
								</p>
							)}
							{usageLoading && usage === undefined ? (
								<p style={hintStyle}>{t("usageLoading")}</p>
							) : usage === undefined || !usageHasVisibleFields(usage) ? (
								<p style={hintStyle}>{t("usageEmpty")}</p>
							) : (
								<>
									{fetchedAt === undefined ? null : <p style={hintStyle}>{t("usageFetchedAt", { time: fetchedAt })}</p>}
									{usagePercent !== undefined ? (
										<ProgressBar
											value={usagePercent}
											label={t("usageRateLimit")}
											meta={t("usageUsed", { value: `${String(usagePercent)}%` })}
										/>
									) : null}
									{usage.rateLimits.map((limit) => {
										const window = limit.windows[0];
										const used = window?.usedPercent;
										const resetsAt = formatEpoch(window?.resetsAt);
										return (
											<div key={limit.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
												{used === undefined ? (
													<p style={hintStyle}>{limit.name ?? t("usageRateLimit")}</p>
												) : (
													<ProgressBar
														value={used}
														label={limit.name ?? t("usageRateLimit")}
														meta={
															resetsAt === undefined
																? t("usageUsed", { value: `${String(used)}%` })
																: `${t("usageUsed", { value: `${String(used)}%` })} · ${t("usageResets", { time: resetsAt })}`
														}
													/>
												)}
											</div>
										);
									})}
								</>
							)}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

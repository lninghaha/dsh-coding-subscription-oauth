/** Single provider account card for the Accounts tab. */

import { SOURCE_REASON_KEY } from "../constants.ts";
import { methodLabel, orderedLoginMethods, shouldShowPerCardSourceReason } from "../display.ts";
import { formatEpoch, modelFields, usageHasVisibleFields } from "../parsers.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	checkRowStyle,
	codeStyle,
	dotStyle,
	errorStyle,
	hintStyle,
	inputStyle,
	linkStyle,
	listStyle,
	monoStyle,
	nestedStyle,
	primaryButtonStyle,
	rowStyle,
	statusStyle,
	titleStyle,
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
	const ordered = orderedLoginMethods(definition, remote);
	const statusLabel =
		providerStatus.status === "signed-in"
			? t("signedIn")
			: providerStatus.status === "signing-in"
				? t("signingIn")
				: providerStatus.status === "error"
					? t("requestFailed")
					: t("signedOut");
	const activeMethod = providerStatus.status === "signing-in" ? providerStatus.method : ordered[0];
	const { available, selected } = modelFields(providerStatus);
	const grokProviderStatus = definition.slug === "grok" ? (providerStatus as GrokStatus) : undefined;
	const showSourceReason = shouldShowPerCardSourceReason(source);
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
				<div style={statusStyle} role="status">
					<span aria-hidden="true" style={dotStyle(providerStatus.status)} />
					<span>{statusLabel}</span>
				</div>
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{providerStatus.status === "signed-in" ? (
					<>
						<button type="button" style={buttonStyle} disabled={busy} onClick={onSignOut}>
							{busy ? t("working") : t("logout")}
						</button>
						<button type="button" style={buttonStyle} onClick={onToggleExpanded}>
							{expanded ? t("collapseModels") : t("expandModels")}
						</button>
						{source?.available === true ? (
							<button type="button" style={buttonStyle} disabled={sourcesBusy} onClick={onPreviewSource}>
								{t("sourcesPullCopy")}
							</button>
						) : null}
					</>
				) : providerStatus.status === "signing-in" ? (
					<>
						{ordered
							.filter((method) => method !== activeMethod)
							.map((method) => (
								<button
									key={method}
									type="button"
									style={buttonStyle}
									disabled={busy}
									onClick={() => {
										onSignIn(method);
									}}
								>
									{methodLabel(method, t, { remote, primary: method === ordered[0] })}
								</button>
							))}
						<button type="button" style={buttonStyle} disabled={busy} onClick={onCancelLogin}>
							{t("cancelLogin")}
						</button>
					</>
				) : (
					<>
						{ordered.map((method, index) => (
							<button
								key={method}
								type="button"
								style={index === 0 ? primaryButtonStyle : buttonStyle}
								disabled={busy}
								onClick={() => {
									onSignIn(method);
								}}
							>
								{busy ? t("working") : methodLabel(method, t, { remote, primary: index === 0 })}
							</button>
						))}
						{source?.available === true ? (
							<button type="button" style={buttonStyle} disabled={sourcesBusy} onClick={onPreviewSource}>
								{t("sourcesPullCopy")}
							</button>
						) : showSourceReason && source?.reason !== undefined ? (
							<span style={hintStyle}>{t(SOURCE_REASON_KEY[source.reason])}</span>
						) : null}
					</>
				)}
			</div>
			{providerStatus.status === "error" ? <p style={errorStyle}>{providerStatus.message}</p> : null}
			{providerStatus.status === "signing-in" && providerStatus.userCode !== undefined ? (
				<p style={bodyStyle}>
					{t("userCode")} <span style={codeStyle}>{providerStatus.userCode}</span>
				</p>
			) : null}
			{providerStatus.status === "signing-in" && providerStatus.url !== undefined ? (
				<p style={bodyStyle}>
					{popupBlocked ? t("popupBlocked") : t("openUrl")}{" "}
					<a href={providerStatus.url} target="_blank" rel="noreferrer" style={linkStyle}>
						{providerStatus.url}
					</a>
				</p>
			) : null}
			{providerStatus.status === "signing-in" && activeMethod !== "device" ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<p style={bodyStyle}>{t(activeMethod === "browser" ? "pasteBrowserCodeHint" : "pasteCodeHint")}</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<input
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
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<div style={rowStyle}>
						<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("models")}</h4>
						<button
							type="button"
							style={buttonStyle}
							disabled={busy}
							onClick={() => {
								onSaveModels([]);
							}}
						>
							{t("selectAll")}
						</button>
					</div>
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
						{available.map((id) => {
							const checked = selected.includes(id);
							return (
								<li key={id}>
									<label style={checkRowStyle}>
										<input
											type="checkbox"
											checked={checked}
											disabled={busy}
											onChange={() => {
												const current = new Set(selected);
												if (checked) current.delete(id);
												else current.add(id);
												onSaveModels([...current]);
											}}
										/>
										<span style={monoStyle}>{id}</span>
									</label>
								</li>
							);
						})}
					</ul>
					{grokProviderStatus?.status === "signed-in" && grokProviderStatus.catalogError !== undefined ? (
						<p style={errorStyle}>{t("catalogError")}</p>
					) : null}
					{definition.slug === "codex" && showUsage ? (
						<div style={nestedStyle}>
							<p style={{ ...bodyStyle, color: "var(--dsw-alias-label-primary)" }}>{t("usageTitle")}</p>
							{usageError === undefined ? null : (
								<p style={errorStyle} role="alert">
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
									{usage.rateLimits.map((limit) => {
										const resetsAt = formatEpoch(limit.windows[0]?.resetsAt);
										return (
											<p key={limit.id} style={hintStyle}>
												{limit.name ?? t("usageRateLimit")}
												{limit.windows[0]?.usedPercent === undefined
													? ""
													: ` · ${t("usageUsed", { value: `${String(limit.windows[0].usedPercent)}%` })}`}
												{resetsAt === undefined ? "" : ` · ${t("usageResets", { time: resetsAt })}`}
											</p>
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

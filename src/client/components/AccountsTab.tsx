/** Accounts tab: provider cards, CLI tips, and pull preview. */

import { PROVIDERS } from "../constants.ts";
import { allOfficialCliMissing, anyOfficialCliAvailable } from "../display.ts";
import {
	accountGridStyle,
	bodyStyle,
	buttonStyle,
	cardStyle,
	dotStyle,
	errorStyle,
	hintStyle,
	monoStyle,
	rowStyle,
	skeletonStyle,
	statusStyle,
	tipStyle,
	titleStyle,
} from "../styles.ts";
import type {
	CodingOAuthStatus,
	GrokBuildSettingsInjected,
	LoginMethod,
	ProviderSlug,
	SourcePreview,
	SourceStatus,
	UsageView,
} from "../types.ts";
import { CliPullPreview } from "./CliPullPreview.tsx";
import { ProviderCard } from "./ProviderCard.tsx";

export interface AccountsTabProps {
	t: GrokBuildSettingsInjected["t"];
	status: CodingOAuthStatus | undefined;
	remote: boolean;
	remoteTipDismissed: boolean;
	onDismissRemoteTip: () => void;
	sources: readonly SourceStatus[] | undefined;
	sourcesError: string | undefined;
	sourcesNotice: string | undefined;
	sourcesBusy: boolean;
	preview: SourcePreview | undefined;
	confirmOverwrite: boolean;
	busyProvider: ProviderSlug | undefined;
	codeInputs: Partial<Record<ProviderSlug, string>>;
	popupBlocked: Partial<Record<ProviderSlug, boolean>>;
	expandedProviders: Partial<Record<ProviderSlug, boolean>>;
	showUsage: boolean;
	usage: UsageView | undefined;
	usageError: string | undefined;
	usageLoading: boolean;
	onSignIn: (slug: ProviderSlug, method: LoginMethod) => void;
	onSignOut: (slug: ProviderSlug) => void;
	onCancelLogin: (slug: ProviderSlug) => void;
	onSubmitCode: (slug: ProviderSlug) => void;
	onCodeChange: (slug: ProviderSlug, value: string) => void;
	onToggleExpanded: (slug: ProviderSlug) => void;
	onPreviewSource: (slug: ProviderSlug) => void;
	onSaveModels: (slug: ProviderSlug, selected: string[]) => void;
	onConfirmOverwriteChange: (checked: boolean) => void;
	onCommitSource: () => void;
	onCancelSourcePreview: () => void;
	onRefreshSources: () => void;
}

export function AccountsTab({
	t,
	status,
	remote,
	remoteTipDismissed,
	onDismissRemoteTip,
	sources,
	sourcesError,
	sourcesNotice,
	sourcesBusy,
	preview,
	confirmOverwrite,
	busyProvider,
	codeInputs,
	popupBlocked,
	expandedProviders,
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
	onConfirmOverwriteChange,
	onCommitSource,
	onCancelSourcePreview,
	onRefreshSources,
}: AccountsTabProps) {
	if (status === undefined) {
		return (
			<div style={skeletonStyle} role="status" aria-busy="true">
				<div style={statusStyle}>
					<span aria-hidden="true" style={dotStyle("loading")} />
					{t("loadingAccount")}
				</div>
			</div>
		);
	}

	return (
		<>
			{remote && !remoteTipDismissed ? (
				<div
					style={{ ...tipStyle, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
				>
					<p style={{ ...bodyStyle, margin: 0, color: "var(--dsw-alias-label-primary)" }}>{t("remoteAccountsTip")}</p>
					<button type="button" style={buttonStyle} onClick={onDismissRemoteTip}>
						{t("remoteTipDismiss")}
					</button>
				</div>
			) : null}
			{allOfficialCliMissing(sources) ? (
				<div
					style={{ ...tipStyle, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
				>
					<p style={{ ...bodyStyle, margin: 0, color: "var(--dsw-alias-label-primary)" }}>
						{t("sourcesAllMissingHint")}
					</p>
					<button type="button" style={buttonStyle} disabled={sourcesBusy} onClick={onRefreshSources}>
						{t("sourcesCheckAgain")}
					</button>
				</div>
			) : null}
			{anyOfficialCliAvailable(sources) ? <p style={hintStyle}>{t("sourcesAvailableHint")}</p> : null}
			{sourcesError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{sourcesError}
				</p>
			)}
			{sourcesNotice === undefined ? null : (
				<p style={bodyStyle} role="status">
					{sourcesNotice}
				</p>
			)}
			<div style={accountGridStyle}>
				{PROVIDERS.map((definition) => {
					const providerStatus = status.providers[definition.slug];
					const expanded = providerStatus.status === "signing-in" || expandedProviders[definition.slug] === true;
					return (
						<ProviderCard
							key={definition.slug}
							t={t}
							definition={definition}
							providerStatus={providerStatus}
							busy={busyProvider === definition.slug}
							sourcesBusy={sourcesBusy}
							remote={remote}
							codeInput={codeInputs[definition.slug] ?? ""}
							popupBlocked={popupBlocked[definition.slug] === true}
							expanded={expanded}
							source={sources?.find((entry) => entry.kind === definition.slug)}
							showUsage={showUsage}
							usage={usage}
							usageError={usageError}
							usageLoading={usageLoading}
							onSignIn={(method) => {
								onSignIn(definition.slug, method);
							}}
							onSignOut={() => {
								onSignOut(definition.slug);
							}}
							onCancelLogin={() => {
								onCancelLogin(definition.slug);
							}}
							onSubmitCode={() => {
								onSubmitCode(definition.slug);
							}}
							onCodeChange={(value) => {
								onCodeChange(definition.slug, value);
							}}
							onToggleExpanded={() => {
								onToggleExpanded(definition.slug);
							}}
							onPreviewSource={() => {
								onPreviewSource(definition.slug);
							}}
							onSaveModels={(selected) => {
								onSaveModels(definition.slug, selected);
							}}
						/>
					);
				})}
				<div style={cardStyle}>
					<div style={rowStyle}>
						<div>
							<h3 style={{ ...titleStyle, fontSize: 16 }}>{t("antigravityTitle")}</h3>
							<p style={{ ...bodyStyle, marginTop: 4 }}>{t("antigravityDescription")}</p>
							<p style={{ ...bodyStyle, marginTop: 4 }}>
								<span style={monoStyle}>{status.antigravity.route}</span>
							</p>
						</div>
						<div style={statusStyle} role="status">
							<span aria-hidden="true" style={dotStyle("signed-out", status.antigravity.installed)} />
							<span>{status.antigravity.installed ? t("antigravityInstalled") : t("antigravityMissing")}</span>
						</div>
					</div>
					<p style={bodyStyle}>{t("antigravityCliHint")}</p>
					<code style={{ ...monoStyle, fontSize: 12, overflowWrap: "anywhere" }}>{t("antigravityCliCommand")}</code>
				</div>
			</div>
			{preview === undefined ? null : (
				<CliPullPreview
					t={t}
					preview={preview}
					confirmOverwrite={confirmOverwrite}
					sourcesBusy={sourcesBusy}
					onConfirmOverwriteChange={onConfirmOverwriteChange}
					onCommit={onCommitSource}
					onCancel={onCancelSourcePreview}
				/>
			)}
		</>
	);
}

/** CLI credential pull preview panel. */

import { SOURCE_CONFLICT_KEY, SOURCE_KIND_KEY, SOURCE_PREVIEW_ACTION_KEY } from "../constants.ts";
import { formatEpoch } from "../parsers.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	checkRowStyle,
	hintStyle,
	listStyle,
	monoStyle,
	primaryButtonStyle,
} from "../styles.ts";
import type { GrokBuildSettingsInjected, SourcePreview } from "../types.ts";

export interface CliPullPreviewProps {
	t: GrokBuildSettingsInjected["t"];
	preview: SourcePreview;
	confirmOverwrite: boolean;
	sourcesBusy: boolean;
	onConfirmOverwriteChange: (checked: boolean) => void;
	onCommit: () => void;
	onCancel: () => void;
}

export function CliPullPreview({
	t,
	preview,
	confirmOverwrite,
	sourcesBusy,
	onConfirmOverwriteChange,
	onCommit,
	onCancel,
}: CliPullPreviewProps) {
	const expiresAt = formatEpoch(preview.expiresAt);
	const ticketExpiresAt = formatEpoch(preview.ticketExpiresAt);

	return (
		<section
			id={`coding-oauth-source-preview-${preview.kind}`}
			style={cardStyle}
			aria-labelledby={`coding-oauth-source-preview-title-${preview.kind}`}
			aria-live="polite"
			tabIndex={-1}
		>
			<p id={`coding-oauth-source-preview-title-${preview.kind}`} style={bodyStyle}>
				{t("sourcesPreviewTitle")} · {t(SOURCE_KIND_KEY[preview.kind])}
			</p>
			<p style={hintStyle}>
				<span style={monoStyle}>{preview.displayPath}</span>
			</p>
			<p style={bodyStyle}>
				{t("sourcesConflict", {
					detail: t(
						preview.conflict === undefined ? "sourceConflictUnrecognized" : SOURCE_CONFLICT_KEY[preview.conflict],
					),
				})}
			</p>
			<p style={bodyStyle}>
				{t("sourcesAction", {
					detail: t(
						preview.action === undefined ? "sourceActionUnrecognized" : SOURCE_PREVIEW_ACTION_KEY[preview.action],
					),
				})}
			</p>
			{expiresAt === undefined ? null : <p style={hintStyle}>{t("sourcesPreviewExpires", { time: expiresAt })}</p>}
			{ticketExpiresAt === undefined ? null : (
				<p style={hintStyle}>{t("sourcesTicketExpires", { time: ticketExpiresAt })}</p>
			)}
			{preview.warnings.length === 0 ? null : (
				<ul style={{ ...listStyle, gap: 4 }} aria-label={t("sourcesWarnings")}>
					{preview.warnings.map((warning) => (
						<li key={warning} style={hintStyle}>
							{warning}
						</li>
					))}
				</ul>
			)}
			{preview.confirmOverwriteRequired ? (
				<label style={checkRowStyle}>
					<input
						aria-describedby={`coding-oauth-source-overwrite-hint-${preview.kind}`}
						type="checkbox"
						checked={confirmOverwrite}
						disabled={sourcesBusy || preview.action === "blocked"}
						onChange={(event) => {
							onConfirmOverwriteChange(event.target.checked);
						}}
					/>
					<span>
						{t("sourcesConfirmOverwrite")}
						<span id={`coding-oauth-source-overwrite-hint-${preview.kind}`} style={{ display: "block", ...hintStyle }}>
							{t("sourcesConfirmOverwriteHint")}
						</span>
					</span>
				</label>
			) : null}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				<button
					type="button"
					style={primaryButtonStyle}
					disabled={
						sourcesBusy || preview.action === "blocked" || (preview.confirmOverwriteRequired && !confirmOverwrite)
					}
					onClick={onCommit}
				>
					{t("sourcesCommit")}
				</button>
				<button type="button" style={buttonStyle} disabled={sourcesBusy} onClick={onCancel}>
					{t("sourcesCancelPreview")}
				</button>
			</div>
		</section>
	);
}

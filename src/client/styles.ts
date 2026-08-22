/** Shared inline styles using DSH design tokens. */

import type { CSSProperties } from "react";
import type { ProviderStatus } from "./types.ts";

export const TRANSITION = "all 0.15s ease";

export const pageStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 };
export const titleStyle: CSSProperties = {
	margin: 0,
	fontSize: 20,
	lineHeight: "28px",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
export const bodyStyle: CSSProperties = {
	margin: 0,
	fontSize: 14,
	lineHeight: "22px",
	color: "var(--dsw-alias-label-secondary)",
};
export const cardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 14,
	padding: "18px 20px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 12,
	background: "var(--dsw-alias-bg-module-platform)",
	transition: TRANSITION,
};
export const rowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: 12,
};
export const statusStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 9,
	fontSize: 14,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary)",
};
export const buttonStyle: CSSProperties = {
	boxSizing: "border-box",
	minHeight: 34,
	padding: "6px 14px",
	border: "1px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, 0.4))",
	borderRadius: 18,
	background: "var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-1))",
	color: "var(--dsw-alias-label-primary)",
	boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
	font: "inherit",
	fontSize: 14,
	fontWeight: 500,
	cursor: "pointer",
	transition: TRANSITION,
};
export const primaryButtonStyle: CSSProperties = {
	...buttonStyle,
	// DSH dark theme flips brand-primary to near-white; use the button/foreground
	// pair so primary CTAs stay readable in both light and dark mode.
	border: "none",
	background: "var(--dsw-alias-button-primary-fill)",
	color: "var(--dsw-alias-label-primary-foreground)",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
	fontWeight: 600,
};
export const compactButtonStyle: CSSProperties = {
	...buttonStyle,
	minHeight: 28,
	padding: "4px 10px",
	fontSize: 13,
	borderRadius: 8,
};
export const errorStyle: CSSProperties = { ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" };
export const successStyle: CSSProperties = { ...bodyStyle, color: "var(--dsw-alias-state-success-primary, #22a06b)" };
export const warningStyle: CSSProperties = {
	...bodyStyle,
	padding: "10px 12px",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
};
export const tipStyle: CSSProperties = {
	...bodyStyle,
	padding: "10px 12px",
	borderRadius: 8,
	border: "1px solid var(--dsw-alias-border-l2)",
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
};
export const noticeStyle: CSSProperties = {
	...tipStyle,
	animation: "dsh-coding-oauth-fade-in 0.2s ease",
};
export const codeStyle: CSSProperties = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
export const monoStyle: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
export const snippetStyle: CSSProperties = {
	...monoStyle,
	display: "block",
	fontSize: 12,
	lineHeight: "18px",
	padding: "10px 12px",
	borderRadius: 8,
	border: "1px solid var(--dsw-alias-border-l2)",
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	overflowWrap: "anywhere",
	whiteSpace: "pre-wrap",
};
export const linkStyle: CSSProperties = { color: "var(--dsw-alias-brand-primary)", wordBreak: "break-all" };
export const listStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	margin: 0,
	padding: 0,
	listStyle: "none",
};
export const checkRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: 8,
	fontSize: 14,
	color: "var(--dsw-alias-label-primary)",
};
export const inputStyle: CSSProperties = {
	boxSizing: "border-box",
	width: "100%",
	minHeight: 34,
	padding: "6px 12px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: 13,
	transition: TRANSITION,
};
export const nestedStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	padding: "12px 14px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
};
export const hintStyle: CSSProperties = { ...bodyStyle, fontSize: 13 };
export const segmentedNavStyle: CSSProperties = {
	display: "inline-flex",
	flexWrap: "wrap",
	gap: 2,
	padding: 3,
	borderRadius: 10,
	border: "1px solid var(--dsw-alias-border-l2)",
	background: "var(--dsw-alias-bg-layer-1)",
};
export const segmentedTabStyle: CSSProperties = {
	...buttonStyle,
	border: "none",
	borderRadius: 8,
	boxShadow: "none",
	background: "transparent",
	minHeight: 32,
	padding: "5px 12px",
	fontSize: 13,
};
export const segmentedTabActiveStyle: CSSProperties = {
	...segmentedTabStyle,
	background: "var(--dsw-alias-bg-module-platform)",
	color: "var(--dsw-alias-label-primary)",
	boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
	fontWeight: 600,
};
export const panelStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 14,
	minWidth: 0,
};
export const accountGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
	gap: 14,
};
export const copyRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: 8,
};
export const skeletonStyle: CSSProperties = {
	...cardStyle,
	minHeight: 88,
	background:
		"linear-gradient(90deg, var(--dsw-alias-bg-layer-1) 0%, var(--dsw-alias-bg-module-platform) 50%, var(--dsw-alias-bg-layer-1) 100%)",
	backgroundSize: "200% 100%",
	animation: "dsh-coding-oauth-skeleton-pulse 1.4s ease-in-out infinite",
};
export const stepRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: 10,
	fontSize: 14,
	color: "var(--dsw-alias-label-secondary)",
};
export const stepActiveStyle: CSSProperties = {
	...stepRowStyle,
	color: "var(--dsw-alias-label-primary)",
	fontWeight: 500,
};
export const stepNumberStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: 22,
	height: 22,
	borderRadius: "50%",
	flex: "0 0 auto",
	fontSize: 12,
	fontWeight: 600,
	background: "var(--dsw-alias-bg-layer-1)",
	border: "1px solid var(--dsw-alias-border-l2)",
	color: "var(--dsw-alias-label-secondary)",
};
export const stepNumberActiveStyle: CSSProperties = {
	...stepNumberStyle,
	background: "var(--dsw-alias-button-primary-fill)",
	borderColor: "var(--dsw-alias-button-primary-fill)",
	color: "var(--dsw-alias-label-primary-foreground)",
};

export type StatusTone = "success" | "error" | "warning" | "info" | "neutral";

export function statusToneColor(tone: StatusTone): string {
	switch (tone) {
		case "success":
			return "var(--dsw-alias-state-success-primary, #22a06b)";
		case "error":
			return "var(--dsw-alias-state-error-primary, #d92d20)";
		case "warning":
			// DSH token is `state-warn-*` (not `state-warning-*`).
			return "var(--dsw-alias-state-warn-primary, #e06c00)";
		case "info":
			// Accent/text color (not a solid fill + white text pair).
			return "var(--dsw-alias-brand-primary, #1677ff)";
		default:
			// Prefer tertiary over dimmed: dimmed is near-invisible on light cards
			// and too dark on dark cards.
			return "var(--dsw-alias-label-tertiary, #81858c)";
	}
}

export function badgeStyle(tone: StatusTone): CSSProperties {
	const color = statusToneColor(tone);
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		padding: "3px 10px",
		borderRadius: 999,
		fontSize: 12,
		fontWeight: 600,
		lineHeight: "18px",
		color,
		background: `color-mix(in srgb, ${color} 14%, transparent)`,
		border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
		whiteSpace: "nowrap",
	};
}

export function dotStyle(
	status: ProviderStatus["status"] | "loading" | "available" | "unavailable",
	installed = true,
): CSSProperties {
	const color = !installed
		? "var(--dsw-alias-label-tertiary, #81858c)"
		: status === "signed-in" || status === "available"
			? "var(--dsw-alias-state-success-primary, #22a06b)"
			: status === "error"
				? "var(--dsw-alias-state-error-primary, #d92d20)"
				: status === "signing-in" || status === "loading"
					? "var(--dsw-alias-brand-primary, #1677ff)"
					: "var(--dsw-alias-label-tertiary, #81858c)";
	return { width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: color };
}

export function providerStatusTone(status: ProviderStatus["status"], installed = true): StatusTone {
	if (!installed) return "neutral";
	if (status === "signed-in") return "success";
	if (status === "error") return "error";
	if (status === "signing-in") return "info";
	return "neutral";
}

/** @deprecated Use segmentedTabStyle / segmentedTabActiveStyle */
export const tabNavStyle: CSSProperties = segmentedNavStyle;
/** @deprecated Use segmentedTabStyle */
export const tabButtonStyle: CSSProperties = segmentedTabStyle;
/** @deprecated Use segmentedTabActiveStyle */
export const tabButtonActiveStyle: CSSProperties = segmentedTabActiveStyle;

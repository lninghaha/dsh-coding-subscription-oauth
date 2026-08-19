/** Shared inline styles using DSH design tokens. */

import type { CSSProperties } from "react";
import type { ProviderStatus } from "./types.ts";

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
};
export const primaryButtonStyle: CSSProperties = {
	...buttonStyle,
	borderColor: "#315fc7",
	background: "#315fc7",
	color: "#ffffff",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
	fontWeight: 600,
};
export const errorStyle: CSSProperties = { ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" };
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
export const codeStyle: CSSProperties = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
export const monoStyle: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
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
export const tabNavStyle: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: 8,
};
export const tabButtonStyle: CSSProperties = {
	...buttonStyle,
	borderRadius: 10,
};
export const tabButtonActiveStyle: CSSProperties = {
	...primaryButtonStyle,
	borderRadius: 10,
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
};

export function dotStyle(
	status: ProviderStatus["status"] | "loading" | "available" | "unavailable",
	installed = true,
): CSSProperties {
	const color = !installed
		? "var(--dsw-alias-label-dimmed, #9aa0a6)"
		: status === "signed-in" || status === "available"
			? "var(--dsw-alias-state-success-primary, #22a06b)"
			: status === "error"
				? "var(--dsw-alias-state-error-primary, #d92d20)"
				: status === "signing-in" || status === "loading"
					? "var(--dsw-alias-brand-primary, #1677ff)"
					: "var(--dsw-alias-label-dimmed, #9aa0a6)";
	return { width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: color };
}

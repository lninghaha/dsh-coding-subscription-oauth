/** Usage quota progress bar with threshold-based color. */

import { hintStyle } from "../styles.ts";

export interface ProgressBarProps {
	/** 0–100 used percentage. */
	value: number;
	label?: string;
	meta?: string;
}

function barColor(percent: number): string {
	if (percent >= 90) return "var(--dsw-alias-state-error-primary, #d92d20)";
	if (percent >= 75) return "var(--dsw-alias-state-warn-primary, #e06c00)";
	return "var(--dsw-alias-brand-primary, #1677ff)";
}

export function ProgressBar({ value, label, meta }: ProgressBarProps) {
	const clamped = Math.max(0, Math.min(100, value));
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			{label === undefined ? null : (
				<div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
					<span style={{ ...hintStyle, color: "var(--dsw-alias-label-primary)" }}>{label}</span>
					{meta === undefined ? null : <span style={hintStyle}>{meta}</span>}
				</div>
			)}
			<div
				role="progressbar"
				aria-valuenow={clamped}
				aria-valuemin={0}
				aria-valuemax={100}
				style={{
					height: 8,
					borderRadius: 4,
					background: "var(--dsw-alias-border-l2)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						width: `${String(clamped)}%`,
						height: "100%",
						borderRadius: 4,
						background: barColor(clamped),
						transition: "width 0.3s ease, background 0.3s ease",
					}}
				/>
			</div>
		</div>
	);
}

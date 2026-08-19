/** Dismissible notice banner with optional auto-hide. */

import { useEffect } from "react";
import { bodyStyle, buttonStyle, noticeStyle } from "../styles.ts";

export interface NoticeBannerProps {
	message: string;
	dismissLabel?: string;
	onDismiss?: () => void;
	autoHideMs?: number;
	tone?: "info" | "success";
}

export function NoticeBanner({ message, dismissLabel, onDismiss, autoHideMs, tone = "info" }: NoticeBannerProps) {
	useEffect(() => {
		if (autoHideMs === undefined || onDismiss === undefined) return;
		const timer = window.setTimeout(onDismiss, autoHideMs);
		return () => {
			window.clearTimeout(timer);
		};
	}, [autoHideMs, onDismiss]);

	const borderColor =
		tone === "success" ? "var(--dsw-alias-state-success-primary, #22a06b)" : "var(--dsw-alias-brand-primary, #1677ff)";

	return (
		<div
			style={{
				...noticeStyle,
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "space-between",
				gap: 12,
				borderLeft: `3px solid ${borderColor}`,
			}}
			role="status"
		>
			<p style={{ ...bodyStyle, margin: 0, color: "var(--dsw-alias-label-primary)" }}>{message}</p>
			{onDismiss === undefined || dismissLabel === undefined ? null : (
				<button type="button" style={buttonStyle} onClick={onDismiss}>
					{dismissLabel}
				</button>
			)}
		</div>
	);
}

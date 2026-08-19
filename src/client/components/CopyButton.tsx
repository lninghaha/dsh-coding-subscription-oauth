/** Compact copy button with copied / failed feedback. */

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../api.ts";
import { compactButtonStyle, primaryButtonStyle } from "../styles.ts";

export interface CopyButtonProps {
	text: string;
	idleLabel: string;
	copiedLabel: string;
	failedLabel: string;
	primary?: boolean;
	disabled?: boolean;
}

export function CopyButton({
	text,
	idleLabel,
	copiedLabel,
	failedLabel,
	primary = false,
	disabled = false,
}: CopyButtonProps) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const timerRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		return () => {
			if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
		};
	}, []);

	const handleClick = useCallback(async () => {
		const ok = await copyText(text);
		setState(ok ? "copied" : "failed");
		if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			setState("idle");
			timerRef.current = undefined;
		}, 2000);
	}, [text]);

	const label = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : idleLabel;

	return (
		<button
			type="button"
			style={primary ? primaryButtonStyle : compactButtonStyle}
			disabled={disabled || text.length === 0}
			onClick={() => {
				void handleClick();
			}}
		>
			{label}
		</button>
	);
}

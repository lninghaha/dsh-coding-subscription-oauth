/** Status capsule badge with semantic tone colors. */

import { badgeStyle, dotStyle, providerStatusTone, type StatusTone } from "../styles.ts";
import type { ProviderStatus } from "../types.ts";

export interface BadgeProps {
	label: string;
	tone?: StatusTone;
	/** When set, derives tone from provider login status. */
	providerStatus?: ProviderStatus["status"];
	installed?: boolean;
	showDot?: boolean;
}

export function Badge({ label, tone, providerStatus, installed = true, showDot = true }: BadgeProps) {
	const resolvedTone =
		tone ?? (providerStatus !== undefined ? providerStatusTone(providerStatus, installed) : "neutral");
	return (
		<span style={badgeStyle(resolvedTone)} role="status">
			{showDot ? (
				<span
					aria-hidden="true"
					style={{
						...dotStyle(providerStatus ?? (resolvedTone === "success" ? "signed-in" : "signed-out"), installed),
						width: 7,
						height: 7,
					}}
				/>
			) : null}
			<span>{label}</span>
		</span>
	);
}

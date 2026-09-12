import { useState } from "react";
import type { GoGatewayRoute } from "../go-gateway-route.ts";

export type { GoGatewayRoute } from "../go-gateway-route.ts";
export type GoGatewayKey =
	| "title"
	| "hint"
	| "migration"
	| "empty"
	| "edit"
	| "apply"
	| "disable"
	| "cancel"
	| "credential";
export function GoGatewayRouteView({
	route,
	preview,
	migration,
	busy,
	onApply,
	t,
}: {
	route?: GoGatewayRoute | null | undefined;
	preview?: GoGatewayRoute | null | undefined;
	migration?: string | undefined;
	busy: boolean;
	onApply: (value: GoGatewayRoute | null) => void;
	t: (key: GoGatewayKey) => string;
}) {
	const [editing, setEditing] = useState(false);
	const chosen = editing ? preview : route;
	return (
		<section style={{ display: "grid", gap: 8 }}>
			<h3 style={{ margin: 0, fontSize: 16 }}>{t("title")}</h3>
			<p style={{ margin: 0 }}>{t("hint")}</p>
			{migration === "required" ? <p role="status">{t("migration")}</p> : null}
			{chosen ? (
				<>
					<p>
						{t("credential")}: <code>{chosen.credentialRef}</code>
					</p>
					<ul>
						{chosen.models.map((model) => (
							<li key={model.id}>
								<code>opencode-go/{model.id}</code> · {model.protocol}
							</li>
						))}
					</ul>
				</>
			) : (
				<p>{t("empty")}</p>
			)}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{editing ? (
					<>
						<button
							type="button"
							disabled={busy || !preview}
							onClick={() => {
								if (!busy && preview) onApply(preview);
							}}
						>
							{t("apply")}
						</button>
						<button type="button" disabled={busy} onClick={() => setEditing(false)}>
							{t("cancel")}
						</button>
					</>
				) : (
					<button type="button" disabled={busy} onClick={() => setEditing(true)}>
						{t("edit")}
					</button>
				)}
				{route ? (
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (!busy) onApply(null);
						}}
					>
						{t("disable")}
					</button>
				) : null}
			</div>
		</section>
	);
}

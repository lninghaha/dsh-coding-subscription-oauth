/** Local API gateway settings tab. */

import { useState } from "react";
import { GATEWAY_PORT_MAX, GATEWAY_PORT_MIN } from "../constants.ts";
import { formatGatewayBaseUrl, parseGatewayPort, randomGatewayPort } from "../parsers.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	checkRowStyle,
	copyRowStyle,
	dotStyle,
	errorStyle,
	hintStyle,
	inputStyle,
	monoStyle,
	nestedStyle,
	primaryButtonStyle,
	skeletonStyle,
	statusStyle,
	titleStyle,
	warningStyle,
} from "../styles.ts";
import type { CopyField, GatewayView, GrokBuildSettingsInjected } from "../types.ts";

export interface GatewayTabProps {
	t: GrokBuildSettingsInjected["t"];
	gateway: GatewayView | undefined;
	gatewayError: string | undefined;
	gatewayBusy: boolean;
	gatewayOnceKey: string | undefined;
	gatewayKeyVisible: boolean;
	gatewayRotateConfirm: boolean;
	gatewayRevealError: string | undefined;
	portDraft: string;
	copiedField: CopyField | undefined;
	copyFailedField: CopyField | undefined;
	onEnabledChange: (enabled: boolean) => void;
	onPortDraftChange: (value: string) => void;
	onApplyPort: () => void;
	onRandomPort: (port: number) => void;
	onCopy: (field: CopyField, text: string) => void;
	onCopyKey: () => void;
	onToggleKeyVisible: () => void;
	onRotateConfirm: () => void;
	onRotateCancel: () => void;
	onRotate: () => void;
}

export function GatewayTab({
	t,
	gateway,
	gatewayError,
	gatewayBusy,
	gatewayOnceKey,
	gatewayKeyVisible,
	gatewayRotateConfirm,
	gatewayRevealError,
	portDraft,
	copiedField,
	copyFailedField,
	onEnabledChange,
	onPortDraftChange,
	onApplyPort,
	onRandomPort,
	onCopy,
	onCopyKey,
	onToggleKeyVisible,
	onRotateConfirm,
	onRotateCancel,
	onRotate,
}: GatewayTabProps) {
	const [enableConfirm, setEnableConfirm] = useState(false);

	const copyLabel = (field: CopyField, idle?: string): string => {
		if (copyFailedField === field) return t("copyFailed");
		if (copiedField === field) return t("copied");
		return idle ?? t("copy");
	};

	return (
		<section style={cardStyle} aria-labelledby="coding-oauth-gateway-title">
			<div>
				<h3 id="coding-oauth-gateway-title" style={{ ...titleStyle, fontSize: 16 }}>
					{t("gatewayTitle")}
				</h3>
				<p style={{ ...bodyStyle, marginTop: 4 }}>{t("gatewayIntro")}</p>
				<p style={{ ...warningStyle, marginTop: 8 }}>{t("gatewayWarning")}</p>
				<p style={{ ...hintStyle, marginTop: 8 }}>{t("gatewayLoopbackHint")}</p>
			</div>
			{gatewayError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{gatewayError}
				</p>
			)}
			{gatewayRevealError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{gatewayRevealError}
				</p>
			)}
			{gateway === undefined && gatewayError === undefined ? (
				<div style={skeletonStyle} role="status" aria-busy="true">
					<div style={statusStyle}>
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("gatewayLoading")}
					</div>
				</div>
			) : gateway === undefined ? null : (
				<div style={nestedStyle}>
					<p style={statusStyle} role="status">
						<span aria-hidden="true" style={dotStyle(gateway.running ? "available" : "unavailable")} />
						<span>{gateway.running ? t("gatewayRunning") : t("gatewayStopped")}</span>
					</p>
					{enableConfirm ? (
						<div style={nestedStyle}>
							<p style={bodyStyle}>{t("gatewayEnableConfirm")}</p>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								<button
									type="button"
									style={primaryButtonStyle}
									disabled={gatewayBusy}
									onClick={() => {
										setEnableConfirm(false);
										onEnabledChange(true);
									}}
								>
									{t("gatewayEnableConfirmAction")}
								</button>
								<button
									type="button"
									style={buttonStyle}
									disabled={gatewayBusy}
									onClick={() => {
										setEnableConfirm(false);
									}}
								>
									{t("gatewayEnableCancel")}
								</button>
							</div>
						</div>
					) : (
						<label style={checkRowStyle}>
							<input
								type="checkbox"
								checked={gateway.enabled}
								disabled={gatewayBusy}
								onChange={(event) => {
									const enabled = event.target.checked;
									if (enabled) {
										setEnableConfirm(true);
										return;
									}
									onEnabledChange(false);
								}}
							/>
							<span>{t("gatewayEnabled")}</span>
						</label>
					)}
					<div>
						<label
							htmlFor="coding-oauth-gateway-port"
							style={{ ...bodyStyle, color: "var(--dsw-alias-label-primary)" }}
						>
							{t("gatewayPort")}
						</label>
						<p id="coding-oauth-gateway-port-hint" style={hintStyle}>
							{t("gatewayPortHint")}
						</p>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
							<input
								id="coding-oauth-gateway-port"
								type="number"
								inputMode="numeric"
								min={GATEWAY_PORT_MIN}
								max={GATEWAY_PORT_MAX}
								step={1}
								value={portDraft}
								disabled={gatewayBusy}
								aria-describedby="coding-oauth-gateway-port-hint"
								style={{ ...inputStyle, width: 112, flex: "0 0 112px" }}
								onChange={(event) => {
									onPortDraftChange(event.target.value);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										onApplyPort();
									}
									if (event.key === "Escape") {
										onPortDraftChange(String(gateway.port));
									}
								}}
							/>
							<button
								type="button"
								style={primaryButtonStyle}
								disabled={
									gatewayBusy || portDraft === String(gateway.port) || parseGatewayPort(portDraft) === undefined
								}
								onClick={onApplyPort}
							>
								{t("gatewayPortApply")}
							</button>
							<button
								type="button"
								style={buttonStyle}
								disabled={gatewayBusy}
								onClick={() => {
									onRandomPort(randomGatewayPort(gateway.port));
								}}
							>
								{t("gatewayPortRandom")}
							</button>
						</div>
					</div>
					<p style={copyRowStyle}>
						<span style={hintStyle}>
							{t("gatewayOpenAiUrl")}
							<span style={{ display: "block", ...monoStyle }}>
								{`${formatGatewayBaseUrl(gateway.bind, gateway.port)}/v1`}
							</span>
						</span>
						<button
							type="button"
							style={primaryButtonStyle}
							onClick={() => {
								onCopy("openai", `${formatGatewayBaseUrl(gateway.bind, gateway.port)}/v1`);
							}}
						>
							{copyLabel("openai")}
						</button>
					</p>
					<p style={copyRowStyle}>
						<span style={hintStyle}>
							{t("gatewayAnthropicUrl")}
							<span style={{ display: "block", ...monoStyle }}>{formatGatewayBaseUrl(gateway.bind, gateway.port)}</span>
						</span>
						<button
							type="button"
							style={buttonStyle}
							onClick={() => {
								onCopy("anthropic", formatGatewayBaseUrl(gateway.bind, gateway.port));
							}}
						>
							{copyLabel("anthropic")}
						</button>
					</p>
					<p style={copyRowStyle}>
						<span style={hintStyle}>
							{t("gatewayKeyHint")}
							<span style={{ display: "block", ...monoStyle, overflowWrap: "anywhere" }}>
								{gatewayKeyVisible && gatewayOnceKey !== undefined ? gatewayOnceKey : gateway.keyHint || "—"}
							</span>
						</span>
						<span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
							<button type="button" style={primaryButtonStyle} disabled={gatewayBusy} onClick={onCopyKey}>
								{copyLabel("key", t("gatewayCopyKey"))}
							</button>
							<button type="button" style={buttonStyle} disabled={gatewayBusy} onClick={onToggleKeyVisible}>
								{gatewayKeyVisible ? t("gatewayHideKey") : t("gatewayShowKey")}
							</button>
						</span>
					</p>
					<p style={hintStyle}>{t("gatewayKeyCopyHint")}</p>
					{gatewayRotateConfirm ? (
						<div style={nestedStyle}>
							<p style={bodyStyle}>{t("gatewayRotateConfirm")}</p>
							<p style={hintStyle}>{t("gatewayRotateConfirmHint")}</p>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								<button type="button" style={buttonStyle} disabled={gatewayBusy} onClick={onRotate}>
									{t("gatewayRotateConfirmAction")}
								</button>
								<button type="button" style={buttonStyle} disabled={gatewayBusy} onClick={onRotateCancel}>
									{t("gatewayRotateCancel")}
								</button>
							</div>
						</div>
					) : (
						<button type="button" style={buttonStyle} disabled={gatewayBusy} onClick={onRotateConfirm}>
							{t("gatewayRotate")}
						</button>
					)}
				</div>
			)}
		</section>
	);
}

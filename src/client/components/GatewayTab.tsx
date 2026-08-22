/** Local API gateway settings tab. */

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { GATEWAY_PORT_MAX, GATEWAY_PORT_MIN } from "../constants.ts";
import { buildGatewaySnippets, type GatewaySnippetId } from "../gatewaySnippets.ts";
import { formatGatewayBaseUrl, parseGatewayPort, randomGatewayPort } from "../parsers.ts";
import {
	bodyStyle,
	buttonStyle,
	cardStyle,
	copyRowStyle,
	dotStyle,
	errorStyle,
	hintStyle,
	inputStyle,
	monoStyle,
	nestedStyle,
	primaryButtonStyle,
	segmentedNavStyle,
	segmentedTabActiveStyle,
	segmentedTabStyle,
	skeletonStyle,
	snippetStyle,
	statusStyle,
	titleStyle,
	warningStyle,
} from "../styles.ts";
import type { CopyField, GatewayView, GrokBuildSettingsInjected } from "../types.ts";
import { Badge } from "./Badge.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { ToggleSwitch } from "./ToggleSwitch.tsx";

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
	onRetry: () => void;
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

const SNIPPET_TABS: readonly {
	id: GatewaySnippetId;
	labelKey: "gatewaySnippetCurl" | "gatewaySnippetPython" | "gatewaySnippetIde";
}[] = [
	{ id: "curl", labelKey: "gatewaySnippetCurl" },
	{ id: "python", labelKey: "gatewaySnippetPython" },
	{ id: "ide", labelKey: "gatewaySnippetIde" },
];

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
	onRetry,
	onPortDraftChange,
	onApplyPort,
	onRandomPort,
	onCopyKey,
	onToggleKeyVisible,
	onRotateConfirm,
	onRotateCancel,
	onRotate,
}: GatewayTabProps) {
	const [enableConfirm, setEnableConfirm] = useState(false);
	const [activeSnippet, setActiveSnippet] = useState<GatewaySnippetId>("curl");
	const enableConfirmAction = useRef<HTMLButtonElement>(null);
	const rotateTrigger = useRef<HTMLButtonElement>(null);
	const rotateConfirmAction = useRef<HTMLButtonElement>(null);
	const restoreEnableFocus = useRef(false);
	const restoreRotateFocus = useRef(false);

	useEffect(() => {
		if (enableConfirm) {
			enableConfirmAction.current?.focus();
			return;
		}
		if (!restoreEnableFocus.current) return;
		restoreEnableFocus.current = false;
		document.getElementById("coding-oauth-gateway-enabled")?.focus();
	}, [enableConfirm]);
	useEffect(() => {
		if (gatewayRotateConfirm) {
			rotateConfirmAction.current?.focus();
			return;
		}
		if (!restoreRotateFocus.current) return;
		restoreRotateFocus.current = false;
		rotateTrigger.current?.focus();
	}, [gatewayRotateConfirm]);

	const portValid = parseGatewayPort(portDraft) !== undefined;
	const portChanged = gateway !== undefined && portDraft !== String(gateway.port);

	const snippets = useMemo(() => {
		if (gateway === undefined || !gatewayKeyVisible || gatewayOnceKey === undefined || gateway.models.length === 0) {
			return undefined;
		}
		const openAi = `${formatGatewayBaseUrl(gateway.bind, gateway.port)}/v1`;
		const anthropic = formatGatewayBaseUrl(gateway.bind, gateway.port);
		// A masked keyHint is display-only and can never produce an executable command.
		return buildGatewaySnippets(openAi, anthropic, gatewayOnceKey, gateway.models[0]);
	}, [gateway, gatewayKeyVisible, gatewayOnceKey]);

	const copyLabel = (field: CopyField, idle?: string): string => {
		if (copyFailedField === field) return t("copyFailed");
		if (copiedField === field) return t("copied");
		return idle ?? t("copy");
	};

	const focusSnippetTab = (index: number): void => {
		const tab = SNIPPET_TABS[index];
		if (tab === undefined) return;
		setActiveSnippet(tab.id);
		document.getElementById(`coding-oauth-snippet-tab-${tab.id}`)?.focus();
	};

	const onSnippetKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const current = SNIPPET_TABS.findIndex((tab) => tab.id === activeSnippet);
		if (current < 0) return;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			event.preventDefault();
			focusSnippetTab((current + 1) % SNIPPET_TABS.length);
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			event.preventDefault();
			focusSnippetTab((current - 1 + SNIPPET_TABS.length) % SNIPPET_TABS.length);
		} else if (event.key === "Home") {
			event.preventDefault();
			focusSnippetTab(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusSnippetTab(SNIPPET_TABS.length - 1);
		}
	};

	const openAiUrl = gateway === undefined ? "" : `${formatGatewayBaseUrl(gateway.bind, gateway.port)}/v1`;
	const anthropicUrl = gateway === undefined ? "" : formatGatewayBaseUrl(gateway.bind, gateway.port);

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
			) : gateway === undefined ? (
				<div style={nestedStyle} role="status">
					<p style={hintStyle}>{t("gatewayLoadFailed")}</p>
					<button type="button" style={buttonStyle} onClick={onRetry}>
						{t("retry")}
					</button>
				</div>
			) : (
				<div style={nestedStyle}>
					<Badge
						label={gateway.running ? t("gatewayRunning") : t("gatewayStopped")}
						tone={gateway.running ? "success" : "neutral"}
					/>
					<p style={hintStyle}>
						{gateway.models.length > 0
							? t("gatewayModelsReady", { count: gateway.models.length, model: gateway.models[0] })
							: t("gatewayModelsUnavailable")}
					</p>
					<p style={hintStyle}>{gateway.keyConfigured ? t("gatewayKeyConfigured") : t("gatewayKeyNotConfigured")}</p>
					{enableConfirm ? (
						<div style={nestedStyle}>
							<p style={bodyStyle}>{t("gatewayEnableConfirm")}</p>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								<button
									ref={enableConfirmAction}
									type="button"
									style={primaryButtonStyle}
									disabled={gatewayBusy}
									onClick={() => {
										restoreEnableFocus.current = true;
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
										restoreEnableFocus.current = true;
										setEnableConfirm(false);
									}}
								>
									{t("gatewayEnableCancel")}
								</button>
							</div>
						</div>
					) : (
						<label
							htmlFor="coding-oauth-gateway-enabled"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 12,
								fontSize: 14,
								color: "var(--dsw-alias-label-primary)",
							}}
						>
							<span>{t("gatewayEnabled")}</span>
							<ToggleSwitch
								id="coding-oauth-gateway-enabled"
								checked={gateway.enabled}
								disabled={gatewayBusy}
								onChange={(enabled) => {
									if (enabled) {
										setEnableConfirm(true);
										return;
									}
									onEnabledChange(false);
								}}
							/>
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
						{!portValid && portDraft.length > 0 ? (
							<p style={{ ...hintStyle, color: "var(--dsw-alias-state-error-primary)" }} role="alert">
								{t("gatewayPortInvalid")}
							</p>
						) : null}
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
								aria-invalid={!portValid && portDraft.length > 0}
								style={{
									...inputStyle,
									width: 112,
									flex: "0 0 112px",
									borderColor:
										!portValid && portDraft.length > 0
											? "var(--dsw-alias-state-error-primary)"
											: "var(--dsw-alias-border-l2)",
								}}
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
								disabled={gatewayBusy || !portChanged || !portValid}
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
							<span style={{ display: "block", ...monoStyle }}>{openAiUrl}</span>
						</span>
						<CopyButton
							text={openAiUrl}
							idleLabel={t("copy")}
							copiedLabel={t("copied")}
							failedLabel={t("copyFailed")}
						/>
					</p>
					<p style={copyRowStyle}>
						<span style={hintStyle}>
							{t("gatewayAnthropicUrl")}
							<span style={{ display: "block", ...monoStyle }}>{anthropicUrl}</span>
						</span>
						<CopyButton
							text={anthropicUrl}
							idleLabel={t("copy")}
							copiedLabel={t("copied")}
							failedLabel={t("copyFailed")}
						/>
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
					{gateway.enabled && snippets !== undefined ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("gatewaySnippetsTitle")}</h4>
							<div
								role="tablist"
								aria-label={t("gatewaySnippetsTitle")}
								style={segmentedNavStyle}
								onKeyDown={onSnippetKeyDown}
							>
								{SNIPPET_TABS.map((tab) => {
									const selected = activeSnippet === tab.id;
									return (
										<button
											key={tab.id}
											id={`coding-oauth-snippet-tab-${tab.id}`}
											type="button"
											role="tab"
											aria-selected={selected}
											aria-controls="coding-oauth-snippet-panel"
											tabIndex={selected ? 0 : -1}
											style={selected ? segmentedTabActiveStyle : segmentedTabStyle}
											onClick={() => {
												setActiveSnippet(tab.id);
											}}
										>
											{t(tab.labelKey)}
										</button>
									);
								})}
							</div>
							<div
								id="coding-oauth-snippet-panel"
								role="tabpanel"
								aria-labelledby={`coding-oauth-snippet-tab-${activeSnippet}`}
							>
								<code style={snippetStyle}>{snippets[activeSnippet]}</code>
							</div>
							<CopyButton
								text={snippets[activeSnippet]}
								idleLabel={t("copy")}
								copiedLabel={t("copied")}
								failedLabel={t("copyFailed")}
							/>
						</div>
					) : gateway.enabled ? (
						<p style={hintStyle}>{t("gatewaySnippetsUnavailable")}</p>
					) : null}
					{gatewayRotateConfirm ? (
						<div style={nestedStyle}>
							<p style={bodyStyle}>{t("gatewayRotateConfirm")}</p>
							<p style={hintStyle}>{t("gatewayRotateConfirmHint")}</p>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								<button
									ref={rotateConfirmAction}
									type="button"
									style={primaryButtonStyle}
									disabled={gatewayBusy}
									onClick={() => {
										restoreRotateFocus.current = true;
										onRotate();
									}}
								>
									{t("gatewayRotateConfirmAction")}
								</button>
								<button
									type="button"
									style={buttonStyle}
									disabled={gatewayBusy}
									onClick={() => {
										restoreRotateFocus.current = true;
										onRotateCancel();
									}}
								>
									{t("gatewayRotateCancel")}
								</button>
							</div>
						</div>
					) : (
						<button
							ref={rotateTrigger}
							type="button"
							style={buttonStyle}
							disabled={gatewayBusy}
							onClick={onRotateConfirm}
						>
							{t("gatewayRotate")}
						</button>
					)}
				</div>
			)}
		</section>
	);
}

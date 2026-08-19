/** Capabilities tab: Codex toggles, Grok Imagine, and limits. */

import { CAPABILITY_LIMITS, CAPABILITY_TOGGLES } from "../constants.ts";
import { imagineSourceLabel } from "../parsers.ts";
import {
	bodyStyle,
	cardStyle,
	dotStyle,
	errorStyle,
	hintStyle,
	inputStyle,
	listStyle,
	nestedStyle,
	rowStyle,
	skeletonStyle,
	statusStyle,
	titleStyle,
} from "../styles.ts";
import type {
	CapabilitySettingKey,
	CapabilitySnapshot,
	GrokBuildSettingsInjected,
	ImagineCredentialView,
} from "../types.ts";
import { Badge } from "./Badge.tsx";
import { ToggleSwitch } from "./ToggleSwitch.tsx";

export interface CapabilitiesTabProps {
	t: GrokBuildSettingsInjected["t"];
	capabilities: CapabilitySnapshot | undefined;
	capabilitiesError: string | undefined;
	capabilitiesBusy: boolean;
	imagine: ImagineCredentialView | undefined;
	imagineError: string | undefined;
	onPatchCapability: (key: CapabilitySettingKey, value: boolean | number) => Promise<boolean | undefined> | undefined;
}

export function CapabilitiesTab({
	t,
	capabilities,
	capabilitiesError,
	capabilitiesBusy,
	imagine,
	imagineError,
	onPatchCapability,
}: CapabilitiesTabProps) {
	const codexToggles = CAPABILITY_TOGGLES.filter((item) => !item.key.startsWith("grokImagine"));
	const imagineToggles = CAPABILITY_TOGGLES.filter((item) => item.key.startsWith("grokImagine"));

	return (
		<section style={cardStyle} aria-labelledby="coding-oauth-capabilities-title">
			<div>
				<h3 id="coding-oauth-capabilities-title" style={{ ...titleStyle, fontSize: 16 }}>
					{t("capabilitiesTitle")}
				</h3>
				<p style={{ ...bodyStyle, marginTop: 4 }}>{t("capabilitiesIntro")}</p>
			</div>
			{imagineError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{imagineError}
				</p>
			)}
			{imagine === undefined && imagineError === undefined ? (
				<div style={skeletonStyle} role="status" aria-busy="true">
					<div style={statusStyle}>
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("imagineLoading")}
					</div>
				</div>
			) : imagine === undefined ? null : (
				<div style={nestedStyle}>
					<Badge
						label={imagine.configured ? t("imagineConfigured") : t("imagineNotConfigured")}
						tone={imagine.configured ? "success" : "neutral"}
					/>
					<p style={hintStyle}>{t("imagineSource", { source: imagineSourceLabel(imagine.source, t) })}</p>
				</div>
			)}
			{capabilitiesError === undefined ? null : (
				<p style={errorStyle} role="alert">
					{capabilitiesError}
				</p>
			)}
			{capabilities === undefined ? (
				<div style={skeletonStyle} role="status" aria-busy="true">
					<div style={statusStyle}>
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("capabilitiesLoading")}
					</div>
				</div>
			) : (
				<fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
					<legend style={{ ...bodyStyle, position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
						{t("capabilitiesTitle")}
					</legend>
					{capabilities.writable ? null : <p style={hintStyle}>{t("capabilitiesReadOnly")}</p>}
					<ul style={listStyle}>
						{codexToggles.map((item) => {
							const checked = capabilities.value[item.key];
							const imagesOff = item.requiresImages === true && !capabilities.value.codexImages;
							const disabled = capabilitiesBusy || !capabilities.writable || imagesOff;
							const switchId = `cap-switch-${item.key}`;
							return (
								<li
									key={item.key}
									style={{
										opacity: imagesOff ? 0.5 : 1,
										transition: "opacity 0.15s ease",
									}}
								>
									<div style={{ ...rowStyle, alignItems: "flex-start" }}>
										<label htmlFor={switchId} style={{ flex: "1 1 360px", cursor: disabled ? "default" : "pointer" }}>
											<span style={{ display: "block", fontSize: 14, color: "var(--dsw-alias-label-primary)" }}>
												{t(item.label)}
											</span>
											<span id={`cap-hint-${item.key}`} style={{ display: "block", ...hintStyle }}>
												{imagesOff ? t("requiresCodexImages") : t(item.hint)}
											</span>
										</label>
										<ToggleSwitch
											id={switchId}
											checked={checked}
											disabled={disabled}
											ariaLabel={t(item.label)}
											onChange={(next) => {
												void onPatchCapability(item.key, next);
											}}
										/>
									</div>
								</li>
							);
						})}
					</ul>
					<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("imagineTitle")}</h4>
					<ul style={listStyle}>
						{imagineToggles.map((item) => {
							const checked = capabilities.value[item.key];
							const disabled = capabilitiesBusy || !capabilities.writable;
							const switchId = `cap-switch-${item.key}`;
							return (
								<li key={item.key}>
									<div style={{ ...rowStyle, alignItems: "flex-start" }}>
										<label htmlFor={switchId} style={{ flex: "1 1 360px", cursor: disabled ? "default" : "pointer" }}>
											<span style={{ display: "block", fontSize: 14, color: "var(--dsw-alias-label-primary)" }}>
												{t(item.label)}
											</span>
											<span id={`cap-hint-${item.key}`} style={{ display: "block", ...hintStyle }}>
												{t(item.hint)}
											</span>
										</label>
										<ToggleSwitch
											id={switchId}
											checked={checked}
											disabled={disabled}
											ariaLabel={t(item.label)}
											onChange={(next) => {
												void onPatchCapability(item.key, next);
											}}
										/>
									</div>
								</li>
							);
						})}
					</ul>
					<div style={nestedStyle}>
						<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("capabilityLimitsTitle")}</h4>
						<p style={hintStyle}>{t("capabilityLimitsHint")}</p>
						<ul style={listStyle}>
							{CAPABILITY_LIMITS.map((item) => {
								const displayValue = capabilities.value[item.key] / item.scale;
								const inputId = `cap-limit-${item.key}`;
								return (
									<li key={item.key} style={rowStyle}>
										<label htmlFor={inputId} style={{ ...bodyStyle, flex: "1 1 360px" }}>
											<span style={{ display: "block", color: "var(--dsw-alias-label-primary)" }}>{t(item.label)}</span>
											<span id={`${inputId}-hint`} style={{ display: "block", ...hintStyle }}>
												{t(item.hint)}
											</span>
										</label>
										<input
											key={`${item.key}-${String(capabilities.revision)}-${String(displayValue)}`}
											id={inputId}
											type="number"
											inputMode="numeric"
											min={item.min}
											max={item.max}
											step={1}
											defaultValue={displayValue}
											disabled={capabilitiesBusy || !capabilities.writable}
											aria-describedby={`${inputId}-hint`}
											style={{ ...inputStyle, width: 112, flex: "0 0 112px" }}
											onInput={(event) => {
												event.currentTarget.setCustomValidity("");
											}}
											onKeyDown={(event) => {
												if (event.key === "Enter") event.currentTarget.blur();
												if (event.key === "Escape") {
													event.currentTarget.value = String(displayValue);
													event.currentTarget.setCustomValidity("");
												}
											}}
											onBlur={(event) => {
												const target = event.currentTarget;
												const next = Number(target.value);
												if (!Number.isInteger(next) || next < item.min || next > item.max) {
													target.setCustomValidity(t("capabilityLimitInvalid", { min: item.min, max: item.max }));
													target.reportValidity();
													return;
												}
												target.setCustomValidity("");
												const apiValue = next * item.scale;
												if (apiValue === capabilities.value[item.key]) return;
												void Promise.resolve(onPatchCapability(item.key, apiValue)).then((saved) => {
													if (saved === false && target.isConnected) target.value = String(displayValue);
												});
											}}
										/>
									</li>
								);
							})}
						</ul>
					</div>
				</fieldset>
			)}
		</section>
	);
}

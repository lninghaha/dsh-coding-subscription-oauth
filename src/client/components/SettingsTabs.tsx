/** Accessible tablist for Coding OAuth settings. */

import type { KeyboardEvent } from "react";
import { SETTINGS_TABS } from "../constants.ts";
import { tabButtonActiveStyle, tabButtonStyle, tabNavStyle } from "../styles.ts";
import type { GrokBuildSettingsInjected, SettingsTabId } from "../types.ts";

export interface SettingsTabsProps {
	t: GrokBuildSettingsInjected["t"];
	activeTab: SettingsTabId;
	onChange: (tab: SettingsTabId) => void;
}

export function SettingsTabs({ t, activeTab, onChange }: SettingsTabsProps) {
	const focusTab = (index: number): void => {
		const tab = SETTINGS_TABS[index];
		if (tab === undefined) return;
		onChange(tab.id);
		const button = document.getElementById(`coding-oauth-tab-${tab.id}`);
		button?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const current = SETTINGS_TABS.findIndex((tab) => tab.id === activeTab);
		if (current < 0) return;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			event.preventDefault();
			focusTab((current + 1) % SETTINGS_TABS.length);
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			event.preventDefault();
			focusTab((current - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length);
		} else if (event.key === "Home") {
			event.preventDefault();
			focusTab(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusTab(SETTINGS_TABS.length - 1);
		}
	};

	return (
		<div role="tablist" aria-label={t("title")} style={tabNavStyle} onKeyDown={onKeyDown}>
			{SETTINGS_TABS.map((tab) => {
				const selected = activeTab === tab.id;
				return (
					<button
						key={tab.id}
						id={`coding-oauth-tab-${tab.id}`}
						type="button"
						role="tab"
						aria-selected={selected}
						aria-controls={`coding-oauth-panel-${tab.id}`}
						tabIndex={selected ? 0 : -1}
						style={selected ? tabButtonActiveStyle : tabButtonStyle}
						onClick={() => {
							onChange(tab.id);
						}}
					>
						{t(tab.label)}
					</button>
				);
			})}
		</div>
	);
}

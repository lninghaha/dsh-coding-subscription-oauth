/** About tab: terms, remote help, and plugin version. */

import { PLUGIN_VERSION } from "../constants.ts";
import { bodyStyle, cardStyle, hintStyle, warningStyle } from "../styles.ts";
import type { GrokBuildSettingsInjected } from "../types.ts";

export interface AboutTabProps {
	t: GrokBuildSettingsInjected["t"];
}

export function AboutTab({ t }: AboutTabProps) {
	return (
		<section style={cardStyle} aria-labelledby="coding-oauth-about-title">
			<p style={warningStyle}>{t("termsWarning")}</p>
			<p style={{ ...bodyStyle, marginTop: 12 }}>{t("remoteLoginHelp")}</p>
			<p style={{ ...hintStyle, marginTop: 12 }}>{t("pluginVersion", { version: PLUGIN_VERSION })}</p>
			<p style={{ ...hintStyle, marginTop: 8 }}>{t("aboutDocsHint")}</p>
		</section>
	);
}

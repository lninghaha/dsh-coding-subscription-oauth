/** About tab: terms, remote help, and plugin version. */

import { PLUGIN_VERSION } from "../constants.ts";
import { bodyStyle, cardStyle, hintStyle, linkStyle, titleStyle, warningStyle } from "../styles.ts";
import type { GrokBuildSettingsInjected } from "../types.ts";

const README_URL = "https://github.com/lninghaha/dsh-coding-subscription-oauth#readme";

export interface AboutTabProps {
	t: GrokBuildSettingsInjected["t"];
}

export function AboutTab({ t }: AboutTabProps) {
	return (
		<section style={cardStyle} aria-labelledby="coding-oauth-about-title">
			<h3 id="coding-oauth-about-title" style={{ ...titleStyle, fontSize: 16 }}>
				{t("aboutTitle")}
			</h3>
			<p style={{ ...warningStyle, marginTop: 12 }}>{t("termsWarning")}</p>
			<p style={{ ...bodyStyle, marginTop: 12 }}>{t("remoteLoginHelp")}</p>
			<p style={{ ...hintStyle, marginTop: 12 }}>{t("pluginVersion", { version: PLUGIN_VERSION })}</p>
			<p style={{ ...hintStyle, marginTop: 8 }}>{t("aboutDocsHint")}</p>
			<p style={{ marginTop: 8 }}>
				<a href={README_URL} target="_blank" rel="noreferrer" style={linkStyle}>
					{t("aboutDocsLink")}
				</a>
			</p>
		</section>
	);
}

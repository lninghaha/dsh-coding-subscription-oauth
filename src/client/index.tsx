/** Browser half: coding-subscription account management inside dsh Settings. */

import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type { GrokBuildSettingsInjected } from "./GrokBuildSettings.tsx";
import { GrokBuildSettings } from "./GrokBuildSettings.tsx";
import type { GrokBuildSettingsKey } from "./locales.ts";
import { en, zh } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		"settings.grok-build": GrokBuildSettingsKey;
	}
}

export const name = "dsh-grok-build-client";
export const inject = ["slots", "locale"];

export function apply(ctx: ClientContext): void {
	const namespace = "settings.grok-build";
	ctx.effect(() => ctx.locale.register(namespace, { zh, en }), "dsh-coding-subscription-oauth: settings copy");
	const t = ctx.locale.bind(namespace) as GrokBuildSettingsInjected["t"];
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "grok-build",
				order: 17,
				label: () => t("nav"),
				inject: (): GrokBuildSettingsInjected => ({ t }),
			},
			GrokBuildSettings,
		),
	);
}

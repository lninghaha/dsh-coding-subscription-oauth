/** Browser half: coding-subscription account management inside dsh Settings. */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerAccountEntry } from "./account-entry-owner.ts";
import { jsonRequest } from "./api.ts";
import { STATUS_PATH } from "./constants.ts";
import { createDshClientAdapter } from "./dshClientAdapter.ts";
import type { GrokBuildSettingsInjected } from "./GrokBuildSettings.tsx";
import { GrokBuildSettings } from "./GrokBuildSettings.tsx";
import type { GrokBuildSettingsKey } from "./locales.ts";
import { en, zh } from "./locales.ts";
import type { CodingOAuthStatus, SettingsTabId } from "./types.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		"settings.grok-build": GrokBuildSettingsKey;
	}
}

export const name = "dsh-grok-build-client";
export const inject = ["locale"];

function IndependentSettingsEntry({
	t,
	hideTrigger = false,
}: {
	readonly t: GrokBuildSettingsInjected["t"];
	readonly hideTrigger?: boolean;
}) {
	const [targetTab, setTargetTab] = useState<SettingsTabId>("accounts");
	const previousFocus = useRef<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const openTarget = (event: Event) => {
			const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
			if (!tab || !["accounts", "providers", "capabilities", "gateway"].includes(tab)) return;
			if (document.querySelector("[data-dsh-coding-oauth=management]")) return;
			previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			setTargetTab(tab === "providers" ? "accounts" : (tab as SettingsTabId));
			setOpen(true);
		};
		window.addEventListener("usage-stats:open-settings", openTarget);
		return () => window.removeEventListener("usage-stats:open-settings", openTarget);
	}, []);
	useEffect(() => {
		if (!open) return;
		closeButton.current?.focus();
		const host = dialog.current?.closest("[data-dsh-coding-oauth]")?.parentElement;
		const inertSiblings =
			host === undefined || host === null
				? []
				: [...document.body.children]
						.filter((element) => element !== host)
						.map((element) => ({
							element,
							hadInert: element.hasAttribute("inert"),
							value: element.getAttribute("inert"),
						}));
		for (const { element } of inertSiblings) element.setAttribute("inert", "");
		const focusable = (): HTMLElement[] =>
			[
				...(dialog.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				) ?? []),
			].filter((element) => element.getClientRects().length > 0);
		const closeOnEscape = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				setOpen(false);
			}
			if (event.key !== "Tab") return;
			event.stopImmediatePropagation();
			const targets = focusable();
			if (targets.length === 0) {
				event.preventDefault();
				dialog.current?.focus();
				return;
			}
			const first = targets[0]!;
			const last = targets.at(-1)!;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("keydown", closeOnEscape, true);
			for (const { element, hadInert, value } of inertSiblings) {
				if (hadInert) element.setAttribute("inert", value ?? "");
				else element.removeAttribute("inert");
			}
			if (previousFocus.current?.isConnected) previousFocus.current.focus();
			else if (trigger.current?.isConnected) trigger.current.focus();
		};
	}, [open]);
	return (
		<div data-dsh-coding-oauth>
			<button
				ref={trigger}
				hidden={hideTrigger}
				type="button"
				style={{
					position: "fixed",
					right: 16,
					bottom: 16,
					zIndex: 30,
					padding: "10px 14px",
					display: hideTrigger ? "none" : undefined,
				}}
				onClick={() => setOpen(true)}
			>
				{t("nav")}
			</button>
			{open ? (
				<div
					ref={dialog}
					role="dialog"
					aria-modal="true"
					aria-labelledby="coding-oauth-independent-title"
					tabIndex={-1}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 31,
						overflow: "auto",
						padding: 20,
						background: "var(--dsw-alias-bg-layer-1)",
					}}
				>
					<div style={{ width: "min(780px, 100%)", margin: "0 auto" }}>
						<div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
							<h2 id="coding-oauth-independent-title" style={{ margin: 0 }}>
								{t("title")}
							</h2>
							<button ref={closeButton} type="button" onClick={() => setOpen(false)} aria-label={t("cancel")}>
								×
							</button>
						</div>
						<GrokBuildSettings t={t} initialTab={targetTab} close={() => setOpen(false)} />
					</div>
				</div>
			) : null}
		</div>
	);
}

function mountIndependentEntry(t: GrokBuildSettingsInjected["t"]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const setVisible = (visible: boolean) => root.render(<IndependentSettingsEntry t={t} hideTrigger={!visible} />);
	setVisible(true);
	return {
		setVisible,
		dispose: () => {
			root.unmount();
			host.remove();
		},
	};
}

export function apply(ctx: ClientContext): void {
	const dsh = createDshClientAdapter(ctx);
	dsh.assertCompatible();
	const namespace = "settings.grok-build";
	dsh.effect(() => dsh.locale.register(namespace, { zh, en }), "dsh-coding-subscription-oauth: settings copy");
	const t = dsh.locale.bind(namespace) as GrokBuildSettingsInjected["t"];
	const stop = registerAccountEntry(ctx, {
		role: "standalone",
		readOwner: async () => (await jsonRequest<CodingOAuthStatus>(STATUS_PATH)).uiOwner,
		mount: (failed) => {
			const bridge = mountIndependentEntry(t);
			let disposed = false;
			const child = ctx.inject(["slots"], (scope) => {
				const adapter = createDshClientAdapter(scope);
				adapter.installSlots({
					mountFallback: () => {
						bridge.setVisible(true);
						return () => bridge.setVisible(false);
					},
					register: (slots) =>
						slots.inject("settings.section", () => {
							try {
								const release = slots.register(
									{
										name: "settings.section",
										id: "coding-accounts",
										order: 17,
										label: () => t("nav"),
										inject: () => ({ t }),
									},
									GrokBuildSettings,
								);
								bridge.setVisible(false);
								return () => {
									release();
									if (!disposed) bridge.setVisible(true);
								};
							} catch {
								queueMicrotask(failed);
								return undefined;
							}
						}),
				});
			});
			void Promise.resolve(child).catch(failed);
			return () => {
				disposed = true;
				child.dispose();
				bridge.dispose();
			};
		},
	});
	dsh.effect(() => stop, "coding-oauth: accounts entry lifecycle");
}

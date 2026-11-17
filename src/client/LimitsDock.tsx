/** Subscription-limit gauges for the provider behind the active chat model, under the composer. */

import { useEffect, useState } from "react";
import { jsonRequest } from "./api.ts";
import { barColor } from "./components/ProgressBar.tsx";
import { LIMITS_PATH } from "./constants.ts";
import type { SlotsApi } from "./dshClientAdapter.ts";
import type { GrokBuildSettingsInjected } from "./GrokBuildSettings.tsx";
import {
	formatResetIn,
	formatWindowSeconds,
	lastRequestProvider,
	lastSubscriptionProvider,
	parseLimitsResponse,
	usageFingerprint,
} from "./limits.ts";
import type { GrokBuildSettingsKey } from "./locales.ts";
import type { LimitsProvider, LimitsWindowView, ProviderLimitsView } from "./types.ts";

type T = GrokBuildSettingsInjected["t"];

const REFRESH_MS = 60_000;

const PROVIDER_TITLE: { readonly [P in LimitsProvider]: GrokBuildSettingsKey } = {
	grok: "grokTitle",
	codex: "codexTitle",
	kimi: "kimiTitle",
	qwen: "qwenTitle",
	claude: "claudeTitle",
};

const rowStyle = {
	display: "flex",
	flexWrap: "wrap",
	alignItems: "center",
	gap: "4px 14px",
	padding: "2px 4px",
	fontSize: 12,
	lineHeight: "16px",
	color: "var(--dsw-alias-label-secondary, #667085)",
} as const;
const gaugeStyle = { display: "inline-flex", alignItems: "center", gap: 6 } as const;
const trackStyle = {
	width: 56,
	height: 6,
	borderRadius: 3,
	background: "var(--dsw-alias-border-l2, #e4e7ec)",
	overflow: "hidden",
} as const;

function windowLabel(window: LimitsWindowView, t: T): string {
	if (window.name !== undefined) return window.name;
	if (window.id === "seven_day_opus") return t("limitsWeeklyOpus");
	if (window.id === "seven_day_sonnet") return t("limitsWeeklySonnet");
	if (window.windowSeconds === 604_800) return t("limitsWeekly");
	return window.windowSeconds === undefined ? window.id : formatWindowSeconds(window.windowSeconds);
}

function Gauge({ window, t }: { readonly window: LimitsWindowView; readonly t: T }) {
	const label = windowLabel(window, t);
	const percent = Math.round(window.usedPercent);
	const reset = window.resetsAt === undefined ? undefined : formatResetIn(window.resetsAt);
	const title = [
		t("limitsUsedTooltip", { label, percent: String(percent) }),
		reset === undefined ? undefined : t("limitsResetsIn", { time: reset }),
	]
		.filter((part): part is string => part !== undefined)
		.join(" · ");
	return (
		<span style={gaugeStyle} title={title}>
			<span>{label}</span>
			<span
				role="progressbar"
				aria-label={title}
				aria-valuenow={percent}
				aria-valuemin={0}
				aria-valuemax={100}
				style={trackStyle}
			>
				<span
					style={{
						display: "block",
						width: `${String(window.usedPercent)}%`,
						height: "100%",
						borderRadius: 3,
						background: barColor(window.usedPercent),
						transition: "width 0.3s ease, background 0.3s ease",
					}}
				/>
			</span>
			<span>{percent}%</span>
		</span>
	);
}

function message(view: ProviderLimitsView, t: T): string | undefined {
	const provider = t(PROVIDER_TITLE[view.provider]);
	if (view.status === "disabled") return t("limitsCodexDisabled", { provider });
	if (view.status === "error") return t("limitsError", { provider });
	if (view.status === "no-data") {
		if (view.code !== undefined) {
			const plan = view.plan === undefined ? "" : `${t("limitsPlan", { provider, plan: view.plan.toUpperCase() })} · `;
			return `${plan}${t("limitsRejected", { provider, code: view.code })}`;
		}
		return view.plan === undefined
			? t("limitsNoData", { provider })
			: `${t("limitsPlan", { provider, plan: view.plan.toUpperCase() })} · ${t("limitsNoData", { provider })}`;
	}
	return undefined;
}

interface LimitsDockProps {
	readonly t: T;
	/** Session standard-kit seats; their presence varies by DSH version, so they are probed, never assumed. */
	readonly useProjection?: unknown;
	/** Trajectory snapshot (`requests[]`): the most reliable source of the active provider. */
	readonly useTrajectory?: unknown;
	/** Chat snapshot (`legacy.nodes`): fallback for DSH builds whose nodes carry provenance. */
	readonly useChat?: unknown;
	/** Session snapshot (`nodes`): fallback for DSH builds whose session snapshot carries nodes. */
	readonly useSession?: unknown;
}

type SnapshotHook = <R>(select: (snapshot: never) => R) => R;

/** Read one optional DSH snapshot seat; an absent seat selects over `undefined` (its presence never changes). */
function useSeat<R>(hook: unknown, select: (snapshot: Record<string, unknown> | undefined) => R): R {
	const selector = (snapshot: never): R => select(snapshot as Record<string, unknown> | undefined);
	return typeof hook === "function" ? (hook as SnapshotHook)(selector) : select(undefined);
}

export function LimitsDock(props: LimitsDockProps) {
	const { t } = props;
	const useProjection =
		typeof props.useProjection === "function" ? (props.useProjection as (name: string) => unknown) : undefined;
	const usage = useProjection?.("tokenUsage");
	const fromTrajectory = useSeat(props.useTrajectory, (snapshot) => lastRequestProvider(snapshot?.["requests"]));
	const fromChat = useSeat(props.useChat, (snapshot) =>
		lastSubscriptionProvider((snapshot?.["legacy"] as { nodes?: unknown } | undefined)?.nodes),
	);
	const fromSession = useSeat(props.useSession, (snapshot) => lastSubscriptionProvider(snapshot?.["nodes"]));
	const provider = fromTrajectory ?? fromChat ?? fromSession;
	const fingerprint = usageFingerprint(usage);
	const [view, setView] = useState<ProviderLimitsView | undefined>();

	useEffect(() => {
		if (provider === undefined) {
			setView(undefined);
			return;
		}
		const controller = new AbortController();
		const load = (force: boolean): void => {
			jsonRequest<unknown>(
				`${LIMITS_PATH}?provider=${provider}${force ? "&force=1" : ""}`,
				"GET",
				undefined,
				controller.signal,
			)
				.then((value) => {
					const parsed = parseLimitsResponse(value);
					if (!controller.signal.aborted && parsed !== undefined) setView(parsed);
				})
				.catch(() => undefined);
		};
		// Once the session has usage, a provider/usage change forces a refresh (the server
		// still caps this at one vendor call per 15s).
		load(fingerprint.length > 0);
		const timer = setInterval(() => load(false), REFRESH_MS);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [provider, fingerprint]);

	if (provider === undefined || view === undefined || view.provider !== provider || view.status === "signed-out") {
		return null;
	}
	const note = message(view, t);
	if (view.windows.length === 0 && note === undefined) return null;
	return (
		<section style={rowStyle} aria-label={t("limitsLabel")}>
			{view.windows.length > 0 ? (
				<span style={{ fontWeight: 600 }}>
					{t(PROVIDER_TITLE[provider])}
					{view.plan === undefined ? "" : ` ${view.plan.toUpperCase()}`}
				</span>
			) : null}
			{view.windows.map((window) => (
				<Gauge key={window.id} window={window} t={t} />
			))}
			{note === undefined ? null : <span>{note}</span>}
		</section>
	);
}

/** Register the dock under the composer. `inject` waits until DSH declares the slot (older hosts never do). */
export function registerLimitsDock(slots: SlotsApi, t: T): () => void {
	return slots.inject("conversation.composer.dock", () =>
		slots.register(
			{
				name: "conversation.composer.dock",
				id: "coding-oauth-limits",
				order: 10,
				locale: "settings.grok-build",
				inject: (): { t: T } => ({ t }),
			},
			LimitsDock,
		),
	);
}

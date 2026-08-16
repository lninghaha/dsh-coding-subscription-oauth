/** Plugin-owned coding subscription account section inside the dsh Settings shell. */

import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import type { GrokBuildSettingsKey } from "./locales.ts";

const STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
const LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
const LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
const LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
const LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
const MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
const IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
const POLL_INTERVAL_MS = 1_000;

type ProviderSlug = "grok" | "codex" | "kimi" | "claude";
type LoginMethod = "pkce" | "device" | "browser";
type CatalogSource = "live" | "cache" | "fallback";

type GrokStatus =
	| { status: "signed-out"; grokImportAvailable: boolean }
	| { status: "signing-in"; method: "pkce" | "device"; url?: string; userCode?: string; grokImportAvailable: boolean }
	| {
			status: "signed-in";
			models: string[];
			available: string[];
			selected: string[];
			catalogSource: CatalogSource;
			catalogError?: string;
			grokImportAvailable: boolean;
	  }
	| { status: "error"; message: string; grokImportAvailable: boolean };

type SubscriptionStatus = {
	provider: Exclude<ProviderSlug, "grok">;
	route: string;
	displayName: string;
	loginMethods: readonly ("browser" | "device")[];
	recommendedLoginMethod: "browser" | "device";
	models: string[];
	available: string[];
	selected: string[];
} & (
	| { status: "signed-out" }
	| { status: "signing-in"; method: "browser" | "device"; url?: string; userCode?: string }
	| { status: "signed-in"; expiresAt?: number }
	| { status: "error"; message: string }
);

type ProviderStatus = GrokStatus | SubscriptionStatus;

interface CodingOAuthStatus {
	providers: {
		grok: GrokStatus;
		codex: SubscriptionStatus;
		kimi: SubscriptionStatus;
		claude: SubscriptionStatus;
	};
	antigravity: { installed: boolean; route: "agy"; management: "cli" };
}

interface LoginChallenge {
	method: LoginMethod;
	url: string;
	userCode?: string;
}

interface ProviderCardDefinition {
	slug: ProviderSlug;
	route: string;
	titleKey: GrokBuildSettingsKey;
	descriptionKey: GrokBuildSettingsKey;
	methods: readonly LoginMethod[];
	recommended: LoginMethod;
}

const PROVIDERS: readonly ProviderCardDefinition[] = [
	{
		slug: "grok",
		route: "grok-build",
		titleKey: "grokTitle",
		descriptionKey: "grokDescription",
		methods: ["pkce", "device"],
		recommended: "pkce",
	},
	{
		slug: "codex",
		route: "codex-oauth",
		titleKey: "codexTitle",
		descriptionKey: "codexDescription",
		methods: ["device", "browser"],
		recommended: "device",
	},
	{
		slug: "kimi",
		route: "kimi-code-oauth",
		titleKey: "kimiTitle",
		descriptionKey: "kimiDescription",
		methods: ["device"],
		recommended: "device",
	},
	{
		slug: "claude",
		route: "claude-code-oauth",
		titleKey: "claudeTitle",
		descriptionKey: "claudeDescription",
		methods: ["browser"],
		recommended: "browser",
	},
];

export interface GrokBuildSettingsInjected {
	t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string;
}

export type GrokBuildSettingsProps = Partial<GrokBuildSettingsInjected>;

const pageStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 18, maxWidth: 780 };
const titleStyle: CSSProperties = {
	margin: 0,
	fontSize: 20,
	lineHeight: "28px",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
const bodyStyle: CSSProperties = {
	margin: 0,
	fontSize: 14,
	lineHeight: "22px",
	color: "var(--dsw-alias-label-secondary)",
};
const cardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 14,
	padding: "18px 20px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 12,
	background: "var(--dsw-alias-bg-module-platform)",
};
const rowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: 12,
};
const statusStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 9,
	fontSize: 14,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary)",
};
const buttonStyle: CSSProperties = {
	boxSizing: "border-box",
	minHeight: 34,
	padding: "6px 14px",
	border: "1px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, 0.4))",
	borderRadius: 18,
	background: "var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-1))",
	color: "var(--dsw-alias-label-primary)",
	boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
	font: "inherit",
	fontSize: 14,
	fontWeight: 500,
	cursor: "pointer",
};
const primaryButtonStyle: CSSProperties = {
	...buttonStyle,
	borderColor: "#315fc7",
	background: "#315fc7",
	color: "#ffffff",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
	fontWeight: 600,
};
const errorStyle: CSSProperties = { ...bodyStyle, color: "var(--dsw-alias-state-error-primary)" };
const warningStyle: CSSProperties = {
	...bodyStyle,
	padding: "10px 12px",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
};
const codeStyle: CSSProperties = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)",
};
const monoStyle: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const linkStyle: CSSProperties = { color: "var(--dsw-alias-brand-primary)", wordBreak: "break-all" };
const listStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	margin: 0,
	padding: 0,
	listStyle: "none",
};
const checkRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	fontSize: 14,
	color: "var(--dsw-alias-label-primary)",
};
const inputStyle: CSSProperties = {
	boxSizing: "border-box",
	width: "100%",
	minHeight: 34,
	padding: "6px 12px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: 13,
};

function dotStyle(status: ProviderStatus["status"] | "loading", installed = true): CSSProperties {
	const color = !installed
		? "var(--dsw-alias-label-dimmed, #9aa0a6)"
		: status === "signed-in"
			? "var(--dsw-alias-state-success-primary, #22a06b)"
			: status === "error"
				? "var(--dsw-alias-state-error-primary, #d92d20)"
				: status === "signing-in" || status === "loading"
					? "var(--dsw-alias-brand-primary, #1677ff)"
					: "var(--dsw-alias-label-dimmed, #9aa0a6)";
	return { width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: color };
}

async function jsonRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
		credentials: "same-origin",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
				? value.error
				: `HTTP ${response.status}`;
		throw new Error(message);
	}
	return value as T;
}

function methodLabel(method: LoginMethod, t: GrokBuildSettingsInjected["t"]): string {
	if (method === "device") return t("deviceLogin");
	if (method === "browser") return t("browserLogin");
	return t("pkceLogin");
}

function modelFields(status: ProviderStatus): { available: string[]; selected: string[] } {
	if (status.status !== "signed-in") return { available: [], selected: [] };
	return {
		available: "available" in status ? status.available : [],
		selected: "selected" in status ? status.selected : [],
	};
}

/** Multi-provider coding subscription status and OAuth actions. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
	if (t === undefined) throw new Error("Coding OAuth settings requires its translation function");
	const [status, setStatus] = useState<CodingOAuthStatus | undefined>(undefined);
	const [requestError, setRequestError] = useState<string | undefined>(undefined);
	const [busyProvider, setBusyProvider] = useState<ProviderSlug | undefined>(undefined);
	const [codeInputs, setCodeInputs] = useState<Partial<Record<ProviderSlug, string>>>({});
	const [popupBlocked, setPopupBlocked] = useState<Partial<Record<ProviderSlug, boolean>>>({});

	const refresh = useCallback(async () => {
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(STATUS_PATH));
			setRequestError(undefined);
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		}
	}, [t]);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		const signingIn =
			status !== undefined && Object.values(status.providers).some((provider) => provider.status === "signing-in");
		if (!signingIn) return;
		const timer = window.setInterval(() => {
			void refresh();
		}, POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, status]);

	const signIn = async (provider: ProviderSlug, method: LoginMethod): Promise<void> => {
		const popup = window.open("about:blank", "_blank");
		if (popup !== null) popup.opener = null;
		setBusyProvider(provider);
		setRequestError(undefined);
		setPopupBlocked((current) => ({ ...current, [provider]: popup === null }));
		try {
			const challenge = await jsonRequest<LoginChallenge>(LOGIN_PATH, "POST", { provider, method });
			if (popup !== null) popup.location.replace(challenge.url);
			await refresh();
		} catch (error: unknown) {
			popup?.close();
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
			await refresh();
		} finally {
			setBusyProvider(undefined);
		}
	};

	const submitCode = async (provider: ProviderSlug): Promise<void> => {
		const code = codeInputs[provider]?.trim() ?? "";
		if (code.length === 0) return;
		setBusyProvider(provider);
		try {
			await jsonRequest<{ ok: true }>(LOGIN_CODE_PATH, "POST", { provider, code });
			setCodeInputs((current) => ({ ...current, [provider]: "" }));
			await refresh();
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const cancelLogin = async (provider: ProviderSlug): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(LOGIN_CANCEL_PATH, "POST", { provider }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const signOut = async (provider: ProviderSlug): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(LOGOUT_PATH, "POST", { provider }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const saveModels = async (provider: ProviderSlug, selected: string[]): Promise<void> => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest<CodingOAuthStatus>(MODELS_PATH, "POST", { provider, selected }));
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	const importGrok = async (): Promise<void> => {
		setBusyProvider("grok");
		try {
			await jsonRequest<unknown>(IMPORT_PATH, "POST");
			await refresh();
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(undefined);
		}
	};

	return (
		<section style={pageStyle} aria-labelledby="coding-oauth-settings-title">
			<div>
				<h2 id="coding-oauth-settings-title" style={titleStyle}>
					{t("title")}
				</h2>
				<p style={{ ...bodyStyle, marginTop: 6 }}>{t("intro")}</p>
			</div>
			<p style={warningStyle}>{t("termsWarning")}</p>
			{requestError === undefined ? null : <p style={errorStyle}>{requestError}</p>}
			{status === undefined ? (
				<div style={cardStyle}>
					<div style={statusStyle}>
						<span aria-hidden="true" style={dotStyle("loading")} />
						{t("loadingAccount")}
					</div>
				</div>
			) : (
				PROVIDERS.map((definition) => {
					const providerStatus = status.providers[definition.slug];
					const grokProviderStatus = definition.slug === "grok" ? (providerStatus as GrokStatus) : undefined;
					const busy = busyProvider === definition.slug;
					const statusLabel =
						providerStatus.status === "signed-in"
							? t("signedIn")
							: providerStatus.status === "signing-in"
								? t("signingIn")
								: providerStatus.status === "error"
									? t("requestFailed")
									: t("signedOut");
					const activeMethod = providerStatus.status === "signing-in" ? providerStatus.method : definition.recommended;
					const { available, selected } = modelFields(providerStatus);
					const localCode = codeInputs[definition.slug] ?? "";
					return (
						<div key={definition.slug} style={cardStyle}>
							<div style={rowStyle}>
								<div>
									<h3 style={{ ...titleStyle, fontSize: 16 }}>{t(definition.titleKey)}</h3>
									<p style={{ ...bodyStyle, marginTop: 4 }}>{t(definition.descriptionKey)}</p>
									<p style={{ ...bodyStyle, marginTop: 4 }}>
										<span style={monoStyle}>{definition.route}</span>
									</p>
								</div>
								<div style={statusStyle} role="status">
									<span aria-hidden="true" style={dotStyle(providerStatus.status)} />
									<span>{statusLabel}</span>
								</div>
							</div>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
								{providerStatus.status === "signed-in" ? (
									<button
										type="button"
										style={buttonStyle}
										disabled={busy}
										onClick={() => {
											void signOut(definition.slug);
										}}
									>
										{busy ? t("working") : t("logout")}
									</button>
								) : providerStatus.status === "signing-in" ? (
									<>
										{definition.methods
											.filter((method) => method !== activeMethod)
											.map((method) => (
												<button
													key={method}
													type="button"
													style={buttonStyle}
													disabled={busy}
													onClick={() => {
														void signIn(definition.slug, method);
													}}
												>
													{methodLabel(method, t)}
												</button>
											))}
										<button
											type="button"
											style={buttonStyle}
											disabled={busy}
											onClick={() => {
												void cancelLogin(definition.slug);
											}}
										>
											{t("cancelLogin")}
										</button>
									</>
								) : (
									definition.methods.map((method, index) => (
										<button
											key={method}
											type="button"
											style={index === 0 ? primaryButtonStyle : buttonStyle}
											disabled={busy}
											onClick={() => {
												void signIn(definition.slug, method);
											}}
										>
											{busy ? t("working") : methodLabel(method, t)}
										</button>
									))
								)}
								{grokProviderStatus !== undefined &&
								grokProviderStatus.status !== "signing-in" &&
								grokProviderStatus.grokImportAvailable ? (
									<button
										type="button"
										style={buttonStyle}
										disabled={busy}
										onClick={() => {
											void importGrok();
										}}
									>
										{t("importGrok")}
									</button>
								) : null}
							</div>
							{providerStatus.status === "error" ? <p style={errorStyle}>{providerStatus.message}</p> : null}
							{grokProviderStatus !== undefined &&
							grokProviderStatus.status !== "signed-in" &&
							grokProviderStatus.grokImportAvailable ? (
								<p style={bodyStyle}>{t("importHint")}</p>
							) : null}
							{providerStatus.status === "signing-in" && providerStatus.userCode !== undefined ? (
								<p style={bodyStyle}>
									{t("userCode")} <span style={codeStyle}>{providerStatus.userCode}</span>
								</p>
							) : null}
							{providerStatus.status === "signing-in" && providerStatus.url !== undefined ? (
								<p style={bodyStyle}>
									{popupBlocked[definition.slug] === true ? t("popupBlocked") : t("openUrl")}{" "}
									<a href={providerStatus.url} target="_blank" rel="noreferrer" style={linkStyle}>
										{providerStatus.url}
									</a>
								</p>
							) : null}
							{providerStatus.status === "signing-in" && activeMethod !== "device" ? (
								<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
									<p style={bodyStyle}>{t("pasteCodeHint")}</p>
									<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
										<input
											style={{ ...inputStyle, flex: "1 1 360px" }}
											value={localCode}
											placeholder={t("pasteCodePlaceholder")}
											disabled={busy}
											onChange={(event) =>
												setCodeInputs((current) => ({ ...current, [definition.slug]: event.target.value }))
											}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													void submitCode(definition.slug);
												}
											}}
										/>
										<button
											type="button"
											style={primaryButtonStyle}
											disabled={busy || localCode.trim().length === 0}
											onClick={() => {
												void submitCode(definition.slug);
											}}
										>
											{t("submitCode")}
										</button>
									</div>
								</div>
							) : null}
							{providerStatus.status === "signed-in" ? (
								<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
									<div style={rowStyle}>
										<h4 style={{ ...titleStyle, fontSize: 14 }}>{t("models")}</h4>
										<button
											type="button"
											style={buttonStyle}
											disabled={busy}
											onClick={() => {
												void saveModels(definition.slug, []);
											}}
										>
											{t("selectAll")}
										</button>
									</div>
									{grokProviderStatus?.status === "signed-in" ? (
										<p style={bodyStyle}>
											{grokProviderStatus.catalogSource === "live"
												? t("catalogLive")
												: grokProviderStatus.catalogSource === "cache"
													? t("catalogCache")
													: t("catalogFallback")}
										</p>
									) : null}
									<p style={bodyStyle}>
										{t("modelHint")} <span style={monoStyle}>{definition.route}/&lt;id&gt;</span>
									</p>
									<ul style={listStyle}>
										{available.map((id) => {
											const checked = selected.includes(id);
											return (
												<li key={id}>
													<label style={checkRowStyle}>
														<input
															type="checkbox"
															checked={checked}
															disabled={busy}
															onChange={() => {
																const current = new Set(selected);
																if (checked) current.delete(id);
																else current.add(id);
																void saveModels(definition.slug, [...current]);
															}}
														/>
														<span style={monoStyle}>{id}</span>
													</label>
												</li>
											);
										})}
									</ul>
									{grokProviderStatus?.status === "signed-in" && grokProviderStatus.catalogError !== undefined ? (
										<p style={errorStyle}>{t("catalogError")}</p>
									) : null}
								</div>
							) : null}
						</div>
					);
				})
			)}
			{status === undefined ? null : (
				<div style={cardStyle}>
					<div style={rowStyle}>
						<div>
							<h3 style={{ ...titleStyle, fontSize: 16 }}>{t("antigravityTitle")}</h3>
							<p style={{ ...bodyStyle, marginTop: 4 }}>{t("antigravityDescription")}</p>
							<p style={{ ...bodyStyle, marginTop: 4 }}>
								<span style={monoStyle}>{status.antigravity.route}</span>
							</p>
						</div>
						<div style={statusStyle} role="status">
							<span aria-hidden="true" style={dotStyle("signed-out", status.antigravity.installed)} />
							<span>{status.antigravity.installed ? t("antigravityInstalled") : t("antigravityMissing")}</span>
						</div>
					</div>
					<p style={bodyStyle}>{t("antigravityCliHint")}</p>
					<code style={{ ...monoStyle, fontSize: 12, overflowWrap: "anywhere" }}>
						pnpm --dir ~/.dsh/profiles/web exec dsh-agy login --headless
					</code>
				</div>
			)}
		</section>
	);
}

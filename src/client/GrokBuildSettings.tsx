/** Plugin-owned coding subscription account section inside the dsh Settings shell. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelPreviewTicket, copyText, isConflictError, isConsumedPreviewError, jsonRequest } from "./api.ts";
import { AboutTab } from "./components/AboutTab.tsx";
import { AccountsTab } from "./components/AccountsTab.tsx";
import { CapabilitiesTab } from "./components/CapabilitiesTab.tsx";
import { GatewayTab } from "./components/GatewayTab.tsx";
import type { SettingsTabHint } from "./components/SettingsTabs.tsx";
import { SettingsTabs } from "./components/SettingsTabs.tsx";
import {
	CAPABILITIES_PATH,
	CODEX_USAGE_PATH,
	GATEWAY_PATH,
	GATEWAY_REVEAL_PATH,
	GATEWAY_ROTATE_PATH,
	IMAGINE_CREDENTIAL_PATH,
	LOGIN_CANCEL_PATH,
	LOGIN_CODE_PATH,
	LOGIN_PATH,
	LOGOUT_PATH,
	MODELS_PATH,
	POLL_INTERVAL_MS,
	SOURCE_COMMIT_ACTION_KEY,
	SOURCES_CANCEL_PATH,
	SOURCES_COMMIT_PATH,
	SOURCES_PATH,
	SOURCES_PREVIEW_PATH,
	STATUS_PATH,
} from "./constants.ts";
import { ensureMicroStyles } from "./microStyles.ts";
import {
	emptyCapabilitySettings,
	mergeSources,
	parseCapabilities,
	parseCommitAction,
	parseGateway,
	parseGatewayPort,
	parseImagineCredential,
	parsePreview,
	parseSources,
	parseUsage,
} from "./parsers.ts";
import { bodyStyle, buttonStyle, errorStyle, pageStyle, panelStyle, titleStyle } from "./styles.ts";
import type {
	CapabilitySettingKey,
	CapabilitySettingsView,
	CapabilitySnapshot,
	CodingOAuthStatus,
	CopyField,
	GatewayView,
	GrokBuildSettingsProps,
	ImagineCredentialView,
	LoginChallenge,
	LoginMethod,
	ProviderSlug,
	SettingsTabId,
	SourceKind,
	SourcePreview,
	SourceStatus,
	UsageView,
} from "./types.ts";

export type { GrokBuildSettingsInjected, GrokBuildSettingsProps } from "./types.ts";

const REMOTE_TIP_STORAGE_KEY = "dsh-coding-oauth-remote-tip-dismissed";

function readRemoteTipDismissed(): boolean {
	try {
		return globalThis.sessionStorage?.getItem(REMOTE_TIP_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

/** Multi-provider coding subscription status and OAuth actions. */
export function GrokBuildSettings({ t }: GrokBuildSettingsProps) {
	if (t === undefined) throw new Error("Coding OAuth settings requires its translation function");

	const [status, setStatus] = useState<CodingOAuthStatus | undefined>(undefined);
	const [requestError, setRequestError] = useState<string | undefined>(undefined);
	const [busyProvider, setBusyProvider] = useState<ProviderSlug | undefined>(undefined);
	const [codeInputs, setCodeInputs] = useState<Partial<Record<ProviderSlug, string>>>({});
	const [popupBlocked, setPopupBlocked] = useState<Partial<Record<ProviderSlug, boolean>>>({});
	const [sources, setSources] = useState<SourceStatus[] | undefined>(undefined);
	const [sourcesError, setSourcesError] = useState<string | undefined>(undefined);
	const [sourcesBusy, setSourcesBusy] = useState(false);
	const [preview, setPreview] = useState<SourcePreview | undefined>(undefined);
	const previewRef = useRef<SourcePreview | undefined>(undefined);
	const previewEpochRef = useRef(0);
	const mountedRef = useRef(true);
	const [confirmOverwrite, setConfirmOverwrite] = useState(false);
	const [sourcesNotice, setSourcesNotice] = useState<string | undefined>(undefined);
	const [capabilities, setCapabilities] = useState<CapabilitySnapshot | undefined>(undefined);
	const [capabilitiesError, setCapabilitiesError] = useState<string | undefined>(undefined);
	const [capabilitiesBusy, setCapabilitiesBusy] = useState(false);
	const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
	const [usage, setUsage] = useState<UsageView | undefined>(undefined);
	const [usageError, setUsageError] = useState<string | undefined>(undefined);
	const [usageLoading, setUsageLoading] = useState(false);
	const [imagine, setImagine] = useState<ImagineCredentialView | undefined>(undefined);
	const [imagineError, setImagineError] = useState<string | undefined>(undefined);
	const [gateway, setGateway] = useState<GatewayView | undefined>(undefined);
	const [gatewayError, setGatewayError] = useState<string | undefined>(undefined);
	const [gatewayBusy, setGatewayBusy] = useState(false);
	const [gatewayLoaded, setGatewayLoaded] = useState(false);
	const [gatewayOnceKey, setGatewayOnceKey] = useState<string | undefined>(undefined);
	const [gatewayKeyVisible, setGatewayKeyVisible] = useState(false);
	const [gatewayRotateConfirm, setGatewayRotateConfirm] = useState(false);
	const [gatewayRevealError, setGatewayRevealError] = useState<string | undefined>(undefined);
	const [portDraft, setPortDraft] = useState("");
	const [activeTab, setActiveTab] = useState<SettingsTabId>("accounts");
	const [copiedField, setCopiedField] = useState<CopyField | undefined>(undefined);
	const [copyFailedField, setCopyFailedField] = useState<CopyField | undefined>(undefined);
	const [expandedProviders, setExpandedProviders] = useState<Partial<Record<ProviderSlug, boolean>>>({});
	const [remoteTipDismissed, setRemoteTipDismissed] = useState(readRemoteTipDismissed);
	const copiedTimerRef = useRef<number | undefined>(undefined);
	const remote = status?.accessMode === "ssh-tunnel" || status?.accessMode === "trusted-https-proxy";

	const refresh = useCallback(async () => {
		try {
			const next = await jsonRequest<CodingOAuthStatus>(STATUS_PATH);
			setStatus(next);
			setRequestError(undefined);
			return next;
		} catch (error: unknown) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
			return undefined;
		}
	}, [t]);

	const refreshSources = useCallback(async () => {
		try {
			setSources(parseSources(await jsonRequest<unknown>(SOURCES_PATH)));
			setSourcesError(undefined);
		} catch (error: unknown) {
			setSources(mergeSources([]));
			setSourcesError(error instanceof Error ? error.message : t("sourcesLoadFailed"));
		}
	}, [t]);

	const refreshCapabilities = useCallback(async () => {
		try {
			const parsed = parseCapabilities(await jsonRequest<unknown>(CAPABILITIES_PATH));
			setCapabilities(parsed ?? { value: emptyCapabilitySettings(), revision: 0, writable: false });
			setCapabilitiesError(undefined);
			return parsed;
		} catch (error: unknown) {
			setCapabilities({ value: emptyCapabilitySettings(), revision: 0, writable: false });
			setCapabilitiesError(error instanceof Error ? error.message : t("capabilitiesLoadFailed"));
			return undefined;
		} finally {
			setCapabilitiesLoaded(true);
		}
	}, [t]);

	const refreshGateway = useCallback(async () => {
		try {
			setGateway(parseGateway(await jsonRequest<unknown>(GATEWAY_PATH)));
			setGatewayError(undefined);
		} catch (error: unknown) {
			setGatewayError(error instanceof Error ? error.message : t("gatewayLoadFailed"));
		} finally {
			setGatewayLoaded(true);
		}
	}, [t]);

	const refreshImagine = useCallback(async () => {
		try {
			setImagine(parseImagineCredential(await jsonRequest<unknown>(IMAGINE_CREDENTIAL_PATH)));
			setImagineError(undefined);
		} catch (error: unknown) {
			setImagineError(error instanceof Error ? error.message : t("imagineLoadFailed"));
		}
	}, [t]);

	const refreshUsage = useCallback(async () => {
		setUsageLoading(true);
		try {
			setUsage(parseUsage(await jsonRequest<unknown>(CODEX_USAGE_PATH)));
			setUsageError(undefined);
		} catch (error: unknown) {
			setUsage(undefined);
			setUsageError(error instanceof Error ? error.message : t("usageUnavailable"));
		} finally {
			setUsageLoading(false);
		}
	}, [t]);

	// Accounts: status immediately; sources shortly after (non-blocking for first paint).
	useEffect(() => {
		ensureMicroStyles();
		let active = true;
		let timer: number | undefined;
		void refresh().then((next) => {
			if (!active || next?.uiOwner === "hub") return;
			timer = window.setTimeout(() => void refreshSources(), 0);
		});
		return () => {
			active = false;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [refresh, refreshSources]);

	// Capabilities tab: load settings + Imagine status on first visit.
	useEffect(() => {
		if (activeTab !== "capabilities") return;
		if (!capabilitiesLoaded) void refreshCapabilities();
		void refreshImagine();
	}, [activeTab, capabilitiesLoaded, refreshCapabilities, refreshImagine]);

	// Soft-fetch capabilities when Codex is signed in so Accounts can show quota without opening the tab.
	useEffect(() => {
		if (capabilitiesLoaded) return;
		if (status?.providers.codex.status !== "signed-in") return;
		void refreshCapabilities();
	}, [capabilitiesLoaded, refreshCapabilities, status?.providers.codex.status]);

	// Gateway: load only when that tab is opened.
	useEffect(() => {
		if (activeTab !== "gateway" || gatewayLoaded) return;
		void refreshGateway();
	}, [activeTab, gatewayLoaded, refreshGateway]);

	useEffect(() => {
		previewRef.current = preview;
	}, [preview]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (copiedTimerRef.current !== undefined) window.clearTimeout(copiedTimerRef.current);
			previewEpochRef.current += 1;
			const active = previewRef.current;
			if (active !== undefined) cancelPreviewTicket(active.previewId, true);
		};
	}, []);

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

	useEffect(() => {
		const signedIn = status?.providers.codex.status === "signed-in";
		if (capabilities?.value.codexUsage === true && signedIn) {
			void refreshUsage();
			return;
		}
		setUsage(undefined);
		setUsageError(undefined);
		setUsageLoading(false);
	}, [capabilities?.value.codexUsage, refreshUsage, status?.providers.codex.status]);

	useEffect(() => {
		if (gateway !== undefined) setPortDraft(String(gateway.port));
	}, [gateway]);

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

	const previewSource = async (kind: SourceKind): Promise<void> => {
		const epoch = ++previewEpochRef.current;
		const previous = previewRef.current;
		if (previous !== undefined) {
			previewRef.current = undefined;
			setPreview(undefined);
			cancelPreviewTicket(previous.previewId);
		}
		setSourcesBusy(true);
		setSourcesNotice(undefined);
		setConfirmOverwrite(false);
		try {
			const next = parsePreview(await jsonRequest<unknown>(SOURCES_PREVIEW_PATH, "POST", { kind }));
			if (next === undefined) throw new Error(t("sourcesPreviewFailed"));
			if (!mountedRef.current || epoch !== previewEpochRef.current) {
				cancelPreviewTicket(next.previewId, !mountedRef.current);
				return;
			}
			previewRef.current = next;
			setPreview(next);
			setSourcesError(undefined);
		} catch (error: unknown) {
			if (!mountedRef.current || epoch !== previewEpochRef.current) return;
			setPreview(undefined);
			setSourcesError(error instanceof Error ? error.message : t("sourcesPreviewFailed"));
		} finally {
			if (mountedRef.current && epoch === previewEpochRef.current) setSourcesBusy(false);
		}
	};

	const commitSource = async (): Promise<void> => {
		if (preview === undefined) return;
		if (preview.action === "blocked") return;
		if (preview.confirmOverwriteRequired && !confirmOverwrite) return;
		setSourcesBusy(true);
		try {
			const result = await jsonRequest<unknown>(SOURCES_COMMIT_PATH, "POST", {
				kind: preview.kind,
				previewId: preview.previewId,
				confirmOverwrite,
			});
			const action = parseCommitAction(result);
			previewRef.current = undefined;
			setPreview(undefined);
			setConfirmOverwrite(false);
			setSourcesNotice(
				t("sourcesCommitSuccess", { action: action === undefined ? "" : t(SOURCE_COMMIT_ACTION_KEY[action]) }),
			);
			setSourcesError(undefined);
			await refreshSources();
			await refresh();
		} catch (error: unknown) {
			if (isConsumedPreviewError(error)) {
				previewRef.current = undefined;
				setPreview(undefined);
				setConfirmOverwrite(false);
			}
			setSourcesError(error instanceof Error ? error.message : t("sourcesCommitFailed"));
			await refreshSources();
		} finally {
			setSourcesBusy(false);
		}
	};

	const cancelSourcePreview = async (): Promise<void> => {
		if (preview === undefined) return;
		const previewId = preview.previewId;
		previewEpochRef.current += 1;
		previewRef.current = undefined;
		setPreview(undefined);
		setConfirmOverwrite(false);
		setSourcesBusy(true);
		try {
			await jsonRequest<unknown>(SOURCES_CANCEL_PATH, "POST", { previewId });
			setSourcesError(undefined);
		} catch (error: unknown) {
			setSourcesError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setSourcesBusy(false);
		}
	};

	const patchCapability = async (key: CapabilitySettingKey, value: boolean | number): Promise<boolean> => {
		if (capabilities === undefined || !capabilities.writable) return false;
		if (key === "codexImageEdits" && value === true && !capabilities.value.codexImages) return false;
		if (key === "codexImagesAnyModel" && value === true && !capabilities.value.codexImages) return false;
		const patch: Partial<CapabilitySettingsView> =
			key === "codexImages" && value === false
				? { codexImages: false, codexImageEdits: false, codexImagesAnyModel: false }
				: ({ [key]: value } as Partial<CapabilitySettingsView>);
		setCapabilitiesBusy(true);
		try {
			const updated = parseCapabilities(
				await jsonRequest<unknown>(CAPABILITIES_PATH, "PATCH", {
					expectedRevision: capabilities.revision,
					patch,
				}),
			);
			if (updated !== undefined) setCapabilities(updated);
			else await refreshCapabilities();
			setCapabilitiesError(undefined);
			return true;
		} catch (error: unknown) {
			await refreshCapabilities();
			setCapabilitiesError(
				isConflictError(error)
					? t("capabilitiesConflictRefreshed")
					: error instanceof Error
						? error.message
						: t("capabilitiesSaveFailed"),
			);
			return false;
		} finally {
			setCapabilitiesBusy(false);
		}
	};

	const showUsage = capabilities?.value.codexUsage === true && status?.providers.codex.status === "signed-in";
	const signedInCount =
		status === undefined
			? 0
			: Object.values(status.providers).filter((provider) => provider.status === "signed-in").length;

	const tabHints = useMemo((): readonly SettingsTabHint[] => {
		const hints: SettingsTabHint[] = [];
		if (status !== undefined) {
			const signedInCount = Object.values(status.providers).filter(
				(provider) => provider.status === "signed-in",
			).length;
			if (signedInCount > 0) {
				hints.push({ id: "accounts", suffix: String(signedInCount) });
			}
		}
		if (gateway?.running === true) {
			hints.push({ id: "gateway", suffix: t("tabGatewayActive") });
		}
		return hints;
	}, [gateway?.running, status, t]);

	const markCopied = (field: CopyField): void => {
		if (copiedTimerRef.current !== undefined) window.clearTimeout(copiedTimerRef.current);
		setCopiedField(field);
		setCopyFailedField(undefined);
		copiedTimerRef.current = window.setTimeout(() => {
			if (mountedRef.current) {
				setCopiedField(undefined);
				setCopyFailedField(undefined);
			}
			copiedTimerRef.current = undefined;
		}, 2000);
	};

	const handleCopy = async (field: CopyField, text: string): Promise<void> => {
		const ok = await copyText(text);
		if (ok) {
			markCopied(field);
			return;
		}
		setCopiedField(undefined);
		setCopyFailedField(field);
	};

	const ensureGatewayKey = async (): Promise<string> => {
		if (gatewayOnceKey !== undefined) return gatewayOnceKey;
		const value = await jsonRequest<{ apiKey?: string }>(GATEWAY_REVEAL_PATH, "POST");
		if (typeof value.apiKey !== "string" || value.apiKey.length === 0) {
			throw new Error(t("gatewayRevealFailed"));
		}
		setGatewayOnceKey(value.apiKey);
		return value.apiKey;
	};

	const copyGatewayKey = async (): Promise<void> => {
		try {
			const key = await ensureGatewayKey();
			await handleCopy("key", key);
			setGatewayRevealError(undefined);
		} catch {
			setGatewayRevealError(t("gatewayRevealFailed"));
		}
	};

	const toggleGatewayKeyVisible = async (): Promise<void> => {
		if (gatewayKeyVisible) {
			setGatewayKeyVisible(false);
			return;
		}
		try {
			await ensureGatewayKey();
			setGatewayKeyVisible(true);
			setGatewayRevealError(undefined);
		} catch {
			setGatewayRevealError(t("gatewayRevealFailed"));
		}
	};

	const applyGatewayPort = async (): Promise<void> => {
		const port = parseGatewayPort(portDraft);
		if (port === undefined) {
			setGatewayError(t("gatewayPortInvalid"));
			return;
		}
		if (gateway !== undefined && port === gateway.port) return;
		setGatewayBusy(true);
		try {
			setGateway(parseGateway(await jsonRequest<unknown>(GATEWAY_PATH, "PATCH", { port })) ?? gateway);
			setGatewayError(undefined);
		} catch (error: unknown) {
			setGatewayError(error instanceof Error ? error.message : t("gatewaySaveFailed"));
			if (gateway !== undefined) setPortDraft(String(gateway.port));
		} finally {
			setGatewayBusy(false);
		}
	};

	const rotateGatewayKey = async (): Promise<void> => {
		setGatewayBusy(true);
		try {
			const value = await jsonRequest<{ apiKey?: string; keyHint?: string }>(GATEWAY_ROTATE_PATH, "POST");
			if (typeof value.apiKey === "string") setGatewayOnceKey(value.apiKey);
			setGatewayKeyVisible(true);
			setGatewayRotateConfirm(false);
			setGatewayRevealError(undefined);
			await refreshGateway();
		} catch (error: unknown) {
			setGatewayError(error instanceof Error ? error.message : t("gatewaySaveFailed"));
		} finally {
			setGatewayBusy(false);
		}
	};

	const setGatewayEnabled = (enabled: boolean): void => {
		setGatewayBusy(true);
		void jsonRequest<unknown>(GATEWAY_PATH, "PATCH", { enabled })
			.then((value) => {
				setGateway(parseGateway(value) ?? gateway);
				setGatewayError(undefined);
			})
			.catch((error: unknown) => {
				setGatewayError(error instanceof Error ? error.message : t("gatewaySaveFailed"));
			})
			.finally(() => {
				setGatewayBusy(false);
			});
	};

	const dismissRemoteTip = (): void => {
		setRemoteTipDismissed(true);
		try {
			globalThis.sessionStorage?.setItem(REMOTE_TIP_STORAGE_KEY, "1");
		} catch {
			// ignore storage failures
		}
	};

	const openAccountsForCodex = (): void => {
		setActiveTab("accounts");
		window.setTimeout(() => document.getElementById("coding-oauth-login-codex")?.focus(), 0);
	};

	const focusCapabilityDependency = (target: "codexImages" | "imagineCredential"): void => {
		const id = target === "codexImages" ? "cap-switch-codexImages" : "coding-oauth-imagine-credential";
		document.getElementById(id)?.focus();
	};

	if (status?.uiOwner === "hub") {
		return (
			<section data-dsh-coding-oauth="compact" style={pageStyle} aria-labelledby="coding-oauth-settings-title">
				<h2 id="coding-oauth-settings-title" style={titleStyle}>
					{t("coinstallTitle")}
				</h2>
				<p style={bodyStyle}>{t("coinstallSummary", { count: signedInCount })}</p>
				<button
					type="button"
					style={buttonStyle}
					onClick={() => window.dispatchEvent(new CustomEvent("usage-stats:open-dashboard"))}
				>
					{t("coinstallOpenHub")}
				</button>
			</section>
		);
	}

	return (
		<section data-dsh-coding-oauth="" style={pageStyle} aria-labelledby="coding-oauth-settings-title">
			<div>
				<h2 id="coding-oauth-settings-title" style={titleStyle}>
					{t("title")}
				</h2>
				{activeTab === "accounts" ? <p style={{ ...bodyStyle, marginTop: 6 }}>{t("intro")}</p> : null}
			</div>
			{requestError === undefined ? null : (
				<div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
					<p style={errorStyle}>{requestError}</p>
					{status === undefined ? (
						<button type="button" style={buttonStyle} onClick={() => void refresh()}>
							{t("retry")}
						</button>
					) : null}
				</div>
			)}
			<SettingsTabs t={t} activeTab={activeTab} onChange={setActiveTab} hints={tabHints} />
			<div
				id={`coding-oauth-panel-${activeTab}`}
				role="tabpanel"
				aria-labelledby={`coding-oauth-tab-${activeTab}`}
				style={panelStyle}
			>
				{activeTab === "accounts" && !(status === undefined && requestError !== undefined) ? (
					<AccountsTab
						t={t}
						status={status}
						remote={remote}
						remoteTipDismissed={remoteTipDismissed}
						onDismissRemoteTip={dismissRemoteTip}
						sources={sources}
						sourcesError={sourcesError}
						sourcesNotice={sourcesNotice}
						sourcesBusy={sourcesBusy}
						preview={preview}
						confirmOverwrite={confirmOverwrite}
						busyProvider={busyProvider}
						codeInputs={codeInputs}
						popupBlocked={popupBlocked}
						expandedProviders={expandedProviders}
						showUsage={showUsage === true}
						usage={usage}
						usageError={usageError}
						usageLoading={usageLoading}
						onSignIn={(slug, method) => {
							void signIn(slug, method);
						}}
						onSignOut={(slug) => {
							void signOut(slug);
						}}
						onCancelLogin={(slug) => {
							void cancelLogin(slug);
						}}
						onSubmitCode={(slug) => {
							void submitCode(slug);
						}}
						onCodeChange={(slug, value) => {
							setCodeInputs((current) => ({ ...current, [slug]: value }));
						}}
						onToggleExpanded={(slug) => {
							setExpandedProviders((current) => ({
								...current,
								[slug]: !(current[slug] === true),
							}));
						}}
						onPreviewSource={(slug) => {
							void previewSource(slug);
						}}
						onSaveModels={(slug, selected) => {
							void saveModels(slug, selected);
						}}
						onConfirmOverwriteChange={setConfirmOverwrite}
						onCommitSource={() => {
							void commitSource();
						}}
						onCancelSourcePreview={() => {
							void cancelSourcePreview();
						}}
						onRefreshSources={() => {
							void refreshSources();
						}}
						onDismissSourcesNotice={() => {
							setSourcesNotice(undefined);
						}}
					/>
				) : null}
				{activeTab === "capabilities" ? (
					<CapabilitiesTab
						t={t}
						capabilities={capabilities}
						capabilitiesError={capabilitiesError}
						capabilitiesBusy={capabilitiesBusy}
						imagine={imagine}
						imagineError={imagineError}
						codexSignedIn={status?.providers.codex.status === "signed-in"}
						onRetry={() => {
							void refreshCapabilities();
							void refreshImagine();
						}}
						onOpenAccounts={openAccountsForCodex}
						onFocusDependency={focusCapabilityDependency}
						onPatchCapability={(key, value) => patchCapability(key, value)}
					/>
				) : null}
				{activeTab === "gateway" ? (
					<GatewayTab
						t={t}
						gateway={gateway}
						gatewayError={gatewayError}
						gatewayBusy={gatewayBusy}
						gatewayOnceKey={gatewayOnceKey}
						gatewayKeyVisible={gatewayKeyVisible}
						gatewayRotateConfirm={gatewayRotateConfirm}
						gatewayRevealError={gatewayRevealError}
						portDraft={portDraft}
						copiedField={copiedField}
						copyFailedField={copyFailedField}
						onRetry={() => {
							void refreshGateway();
						}}
						onEnabledChange={setGatewayEnabled}
						onPortDraftChange={setPortDraft}
						onApplyPort={() => {
							void applyGatewayPort();
						}}
						onRandomPort={(port) => {
							setPortDraft(String(port));
						}}
						onCopy={(field, text) => {
							void handleCopy(field, text);
						}}
						onCopyKey={() => {
							void copyGatewayKey();
						}}
						onToggleKeyVisible={() => {
							void toggleGatewayKeyVisible();
						}}
						onRotateConfirm={() => {
							setGatewayRotateConfirm(true);
						}}
						onRotateCancel={() => {
							setGatewayRotateConfirm(false);
						}}
						onRotate={() => {
							void rotateGatewayKey();
						}}
					/>
				) : null}
				{activeTab === "about" ? <AboutTab t={t} /> : null}
			</div>
		</section>
	);
}

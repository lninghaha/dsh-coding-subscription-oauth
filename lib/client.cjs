Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/GrokBuildSettings.tsx
/** Plugin-owned coding subscription account section inside the dsh Settings shell. */
const STATUS_PATH = "/plugins/dsh-grok-build/oauth/status";
const LOGIN_PATH = "/plugins/dsh-grok-build/oauth/login";
const LOGIN_CODE_PATH = "/plugins/dsh-grok-build/oauth/code";
const LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/oauth/cancel";
const LOGOUT_PATH = "/plugins/dsh-grok-build/oauth/logout";
const MODELS_PATH = "/plugins/dsh-grok-build/oauth/models";
const IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
const POLL_INTERVAL_MS = 1e3;
const PROVIDERS = [
	{
		slug: "grok",
		route: "grok-build",
		titleKey: "grokTitle",
		descriptionKey: "grokDescription",
		methods: ["pkce", "device"],
		recommended: "pkce"
	},
	{
		slug: "codex",
		route: "codex-oauth",
		titleKey: "codexTitle",
		descriptionKey: "codexDescription",
		methods: ["device", "browser"],
		recommended: "device"
	},
	{
		slug: "kimi",
		route: "kimi-code-oauth",
		titleKey: "kimiTitle",
		descriptionKey: "kimiDescription",
		methods: ["device"],
		recommended: "device"
	},
	{
		slug: "claude",
		route: "claude-code-oauth",
		titleKey: "claudeTitle",
		descriptionKey: "claudeDescription",
		methods: ["browser"],
		recommended: "browser"
	}
];
const pageStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 18,
	maxWidth: 780
};
const titleStyle = {
	margin: 0,
	fontSize: 20,
	lineHeight: "28px",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)"
};
const bodyStyle = {
	margin: 0,
	fontSize: 14,
	lineHeight: "22px",
	color: "var(--dsw-alias-label-secondary)"
};
const cardStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 14,
	padding: "18px 20px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 12,
	background: "var(--dsw-alias-bg-module-platform)"
};
const rowStyle = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: 12
};
const statusStyle = {
	display: "flex",
	alignItems: "center",
	gap: 9,
	fontSize: 14,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary)"
};
const buttonStyle = {
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
	cursor: "pointer"
};
const primaryButtonStyle = {
	...buttonStyle,
	borderColor: "#315fc7",
	background: "#315fc7",
	color: "#ffffff",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
	fontWeight: 600
};
const errorStyle = {
	...bodyStyle,
	color: "var(--dsw-alias-state-error-primary)"
};
const warningStyle = {
	...bodyStyle,
	padding: "10px 12px",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)"
};
const codeStyle = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)"
};
const monoStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const linkStyle = {
	color: "var(--dsw-alias-brand-primary)",
	wordBreak: "break-all"
};
const listStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	margin: 0,
	padding: 0,
	listStyle: "none"
};
const checkRowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	fontSize: 14,
	color: "var(--dsw-alias-label-primary)"
};
const inputStyle = {
	boxSizing: "border-box",
	width: "100%",
	minHeight: 34,
	padding: "6px 12px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: 13
};
function dotStyle(status, installed = true) {
	return {
		width: 9,
		height: 9,
		borderRadius: "50%",
		flex: "0 0 auto",
		background: !installed ? "var(--dsw-alias-label-dimmed, #9aa0a6)" : status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : status === "signing-in" || status === "loading" ? "var(--dsw-alias-brand-primary, #1677ff)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
	};
}
async function jsonRequest(path, method = "GET", body) {
	const response = await fetch(path, {
		method,
		headers: {
			accept: "application/json",
			...body === void 0 ? {} : { "content-type": "application/json" }
		},
		credentials: "same-origin",
		...body === void 0 ? {} : { body: JSON.stringify(body) }
	});
	const value = await response.json().catch(() => void 0);
	if (!response.ok) {
		const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
		throw new Error(message);
	}
	return value;
}
function methodLabel(method, t) {
	if (method === "device") return t("deviceLogin");
	if (method === "browser") return t("browserLogin");
	return t("pkceLogin");
}
function modelFields(status) {
	if (status.status !== "signed-in") return {
		available: [],
		selected: []
	};
	return {
		available: "available" in status ? status.available : [],
		selected: "selected" in status ? status.selected : []
	};
}
/** Multi-provider coding subscription status and OAuth actions. */
function GrokBuildSettings({ t }) {
	if (t === void 0) throw new Error("Coding OAuth settings requires its translation function");
	const [status, setStatus] = (0, react.useState)(void 0);
	const [requestError, setRequestError] = (0, react.useState)(void 0);
	const [busyProvider, setBusyProvider] = (0, react.useState)(void 0);
	const [codeInputs, setCodeInputs] = (0, react.useState)({});
	const [popupBlocked, setPopupBlocked] = (0, react.useState)({});
	const refresh = (0, react.useCallback)(async () => {
		try {
			setStatus(await jsonRequest(STATUS_PATH));
			setRequestError(void 0);
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		}
	}, [t]);
	(0, react.useEffect)(() => {
		refresh();
	}, [refresh]);
	(0, react.useEffect)(() => {
		if (!(status !== void 0 && Object.values(status.providers).some((provider) => provider.status === "signing-in"))) return;
		const timer = window.setInterval(() => {
			refresh();
		}, POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, status]);
	const signIn = async (provider, method) => {
		const popup = window.open("about:blank", "_blank");
		if (popup !== null) popup.opener = null;
		setBusyProvider(provider);
		setRequestError(void 0);
		setPopupBlocked((current) => ({
			...current,
			[provider]: popup === null
		}));
		try {
			const challenge = await jsonRequest(LOGIN_PATH, "POST", {
				provider,
				method
			});
			if (popup !== null) popup.location.replace(challenge.url);
			await refresh();
		} catch (error) {
			popup?.close();
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
			await refresh();
		} finally {
			setBusyProvider(void 0);
		}
	};
	const submitCode = async (provider) => {
		const code = codeInputs[provider]?.trim() ?? "";
		if (code.length === 0) return;
		setBusyProvider(provider);
		try {
			await jsonRequest(LOGIN_CODE_PATH, "POST", {
				provider,
				code
			});
			setCodeInputs((current) => ({
				...current,
				[provider]: ""
			}));
			await refresh();
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(void 0);
		}
	};
	const cancelLogin = async (provider) => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest(LOGIN_CANCEL_PATH, "POST", { provider }));
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(void 0);
		}
	};
	const signOut = async (provider) => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest(LOGOUT_PATH, "POST", { provider }));
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(void 0);
		}
	};
	const saveModels = async (provider, selected) => {
		setBusyProvider(provider);
		try {
			setStatus(await jsonRequest(MODELS_PATH, "POST", {
				provider,
				selected
			}));
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(void 0);
		}
	};
	const importGrok = async () => {
		setBusyProvider("grok");
		try {
			await jsonRequest(IMPORT_PATH, "POST");
			await refresh();
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusyProvider(void 0);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: pageStyle,
		"aria-labelledby": "coding-oauth-settings-title",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
				id: "coding-oauth-settings-title",
				style: titleStyle,
				children: t("title")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: {
					...bodyStyle,
					marginTop: 6
				},
				children: t("intro")
			})] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: warningStyle,
				children: t("termsWarning")
			}),
			requestError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: errorStyle,
				children: requestError
			}),
			status === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: cardStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: statusStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: dotStyle("loading")
					}), t("loadingAccount")]
				})
			}) : PROVIDERS.map((definition) => {
				const providerStatus = status.providers[definition.slug];
				const grokProviderStatus = definition.slug === "grok" ? providerStatus : void 0;
				const busy = busyProvider === definition.slug;
				const statusLabel = providerStatus.status === "signed-in" ? t("signedIn") : providerStatus.status === "signing-in" ? t("signingIn") : providerStatus.status === "error" ? t("requestFailed") : t("signedOut");
				const activeMethod = providerStatus.status === "signing-in" ? providerStatus.method : definition.recommended;
				const { available, selected } = modelFields(providerStatus);
				const localCode = codeInputs[definition.slug] ?? "";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cardStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: {
										...titleStyle,
										fontSize: 16
									},
									children: t(definition.titleKey)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										...bodyStyle,
										marginTop: 4
									},
									children: t(definition.descriptionKey)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										...bodyStyle,
										marginTop: 4
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: monoStyle,
										children: definition.route
									})
								})
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: statusStyle,
								role: "status",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: dotStyle(providerStatus.status)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: statusLabel })]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexWrap: "wrap",
								gap: 8
							},
							children: [providerStatus.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									signOut(definition.slug);
								},
								children: busy ? t("working") : t("logout")
							}) : providerStatus.status === "signing-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [definition.methods.filter((method) => method !== activeMethod).map((method) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									signIn(definition.slug, method);
								},
								children: methodLabel(method, t)
							}, method)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									cancelLogin(definition.slug);
								},
								children: t("cancelLogin")
							})] }) : definition.methods.map((method, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: index === 0 ? primaryButtonStyle : buttonStyle,
								disabled: busy,
								onClick: () => {
									signIn(definition.slug, method);
								},
								children: busy ? t("working") : methodLabel(method, t)
							}, method)), grokProviderStatus !== void 0 && grokProviderStatus.status !== "signing-in" && grokProviderStatus.grokImportAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									importGrok();
								},
								children: t("importGrok")
							}) : null]
						}),
						providerStatus.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: providerStatus.message
						}) : null,
						grokProviderStatus !== void 0 && grokProviderStatus.status !== "signed-in" && grokProviderStatus.grokImportAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: bodyStyle,
							children: t("importHint")
						}) : null,
						providerStatus.status === "signing-in" && providerStatus.userCode !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: bodyStyle,
							children: [
								t("userCode"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: codeStyle,
									children: providerStatus.userCode
								})
							]
						}) : null,
						providerStatus.status === "signing-in" && providerStatus.url !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: bodyStyle,
							children: [
								popupBlocked[definition.slug] === true ? t("popupBlocked") : t("openUrl"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: providerStatus.url,
									target: "_blank",
									rel: "noreferrer",
									style: linkStyle,
									children: providerStatus.url
								})
							]
						}) : null,
						providerStatus.status === "signing-in" && activeMethod !== "device" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("pasteCodeHint")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexWrap: "wrap",
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: {
										...inputStyle,
										flex: "1 1 360px"
									},
									value: localCode,
									placeholder: t("pasteCodePlaceholder"),
									disabled: busy,
									onChange: (event) => setCodeInputs((current) => ({
										...current,
										[definition.slug]: event.target.value
									})),
									onKeyDown: (event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											submitCode(definition.slug);
										}
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									disabled: busy || localCode.trim().length === 0,
									onClick: () => {
										submitCode(definition.slug);
									},
									children: t("submitCode")
								})]
							})]
						}) : null,
						providerStatus.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: rowStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
										style: {
											...titleStyle,
											fontSize: 14
										},
										children: t("models")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle,
										disabled: busy,
										onClick: () => {
											saveModels(definition.slug, []);
										},
										children: t("selectAll")
									})]
								}),
								grokProviderStatus?.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: bodyStyle,
									children: grokProviderStatus.catalogSource === "live" ? t("catalogLive") : grokProviderStatus.catalogSource === "cache" ? t("catalogCache") : t("catalogFallback")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									style: bodyStyle,
									children: [
										t("modelHint"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: monoStyle,
											children: [definition.route, "/<id>"]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									style: listStyle,
									children: available.map((id) => {
										const checked = selected.includes(id);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: checkRowStyle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked,
												disabled: busy,
												onChange: () => {
													const current = new Set(selected);
													if (checked) current.delete(id);
													else current.add(id);
													saveModels(definition.slug, [...current]);
												}
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: monoStyle,
												children: id
											})]
										}) }, id);
									})
								}),
								grokProviderStatus?.status === "signed-in" && grokProviderStatus.catalogError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: errorStyle,
									children: t("catalogError")
								}) : null
							]
						}) : null
					]
				}, definition.slug);
			}),
			status === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: {
									...titleStyle,
									fontSize: 16
								},
								children: t("antigravityTitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 4
								},
								children: t("antigravityDescription")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 4
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: monoStyle,
									children: status.antigravity.route
								})
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: statusStyle,
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								style: dotStyle("signed-out", status.antigravity.installed)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.antigravity.installed ? t("antigravityInstalled") : t("antigravityMissing") })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("antigravityCliHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: {
							...monoStyle,
							fontSize: 12,
							overflowWrap: "anywhere"
						},
						children: "pnpm --dir ~/.dsh/profiles/web exec dsh-agy login --headless"
					})
				]
			})
		]
	});
}
//#endregion
//#region src/client/locales.ts
/** English copy for the Coding OAuth settings section. */
const en = {
	nav: "Coding OAuth",
	title: "Coding subscriptions",
	intro: "Use your own Grok Build, ChatGPT Codex, Kimi Code, and Claude Code subscriptions in dsh. API-key routes remain separate.",
	termsWarning: "These are unofficial third-party integrations with subscription services. Provider terms, quotas, regions, and account-risk policies still apply.",
	loadingAccount: "Loading accounts…",
	signedOut: "Not signed in",
	signingIn: "Waiting for authorization…",
	signedIn: "Signed in",
	requestFailed: "The account request failed.",
	logout: "Sign out",
	working: "Working…",
	cancelLogin: "Cancel sign-in",
	deviceLogin: "Sign in with device code",
	browserLogin: "Sign in in browser",
	pkceLogin: "Sign in with authorization code",
	userCode: "Enter this code when the provider asks:",
	openUrl: "Complete sign-in at:",
	popupBlocked: "The browser blocked the sign-in window. Open this URL manually:",
	pasteCodeHint: "If the callback opened on another machine, paste the authorization code or the complete localhost redirect URL here:",
	pasteCodePlaceholder: "code or http://localhost:…/callback?code=…",
	submitCode: "Submit code",
	importGrok: "Import from Grok CLI",
	importHint: "Copies ~/.grok/auth.json into dsh. A later dsh refresh may rotate the token and sign the Grok CLI out.",
	models: "Visible models",
	catalogLive: "From your current xAI account",
	catalogCache: "From the last successful xAI listing",
	catalogFallback: "Built-in Grok baseline (live listing unavailable)",
	catalogError: "Could not refresh the live Grok model list.",
	selectAll: "Show all",
	modelHint: "Checked models appear in the model picker as",
	grokTitle: "xAI Grok Build",
	grokDescription: "SuperGrok / X Premium coding subscription through the Grok Build endpoint.",
	codexTitle: "OpenAI Codex",
	codexDescription: "ChatGPT Plus/Pro Codex entitlement. Device code is recommended for a remote DSH host.",
	kimiTitle: "Kimi Code",
	kimiDescription: "Kimi Code membership through auth.kimi.com and api.kimi.com/coding; this is not the Moonshot API-key platform.",
	claudeTitle: "Claude Code",
	claudeDescription: "Claude Pro/Max OAuth with Claude Code scopes and automatic refresh.",
	antigravityTitle: "Google Antigravity",
	antigravityDescription: "Provided by the separately pinned MIT dsh-agy plugin and exposed as the agy route.",
	antigravityInstalled: "Installed (CLI-managed)",
	antigravityMissing: "Not installed",
	antigravityCliHint: "The unauthenticated dsh-agy web export dashboard is disabled. Manage Google OAuth with the profile-local CLI when needed."
};
const zh = {
	nav: "编码 OAuth",
	title: "编码订阅账户",
	intro: "在 dsh 中使用自己的 Grok Build、ChatGPT Codex、Kimi Code 和 Claude Code 订阅；现有 API-key 路由继续独立保留。",
	termsWarning: "这些是订阅服务的非官方第三方集成，仍受供应商条款、配额、地区限制和账号风控约束。",
	loadingAccount: "正在加载账户…",
	signedOut: "尚未登录",
	signingIn: "正在等待授权…",
	signedIn: "已登录",
	requestFailed: "账户请求失败。",
	logout: "退出登录",
	working: "处理中…",
	cancelLogin: "取消登录",
	deviceLogin: "使用设备码登录",
	browserLogin: "在浏览器中登录",
	pkceLogin: "使用授权码登录",
	userCode: "供应商要求输入代码时，请输入：",
	openUrl: "请在此完成登录：",
	popupBlocked: "浏览器阻止了登录窗口，请手动打开：",
	pasteCodeHint: "如果回调打开在另一台机器，请把授权 code 或完整 localhost 跳转链接粘贴到这里：",
	pasteCodePlaceholder: "code 或 http://localhost:…/callback?code=…",
	submitCode: "提交 code",
	importGrok: "从 Grok CLI 导入",
	importHint: "把 ~/.grok/auth.json 复制进 dsh；之后 dsh 刷新 token 可能让 Grok CLI 掉线。",
	models: "可见模型",
	catalogLive: "来自当前 xAI 账号",
	catalogCache: "来自上一次成功拉取的 xAI 列表",
	catalogFallback: "内置 Grok 基线目录（线上列表不可用）",
	catalogError: "无法刷新线上 Grok 模型列表。",
	selectAll: "全部显示",
	modelHint: "勾选模型会以该前缀出现在模型选择器：",
	grokTitle: "xAI Grok Build",
	grokDescription: "通过 Grok Build 端点使用 SuperGrok / X Premium 编码订阅。",
	codexTitle: "OpenAI Codex",
	codexDescription: "使用 ChatGPT Plus/Pro 的 Codex 权益；远程 DSH 主机推荐设备码登录。",
	kimiTitle: "Kimi Code",
	kimiDescription: "通过 auth.kimi.com 与 api.kimi.com/coding 使用 Kimi Code 会员；不是 Moonshot API-key 开放平台。",
	claudeTitle: "Claude Code",
	claudeDescription: "Claude Pro/Max OAuth，包含 Claude Code scope 和自动刷新。",
	antigravityTitle: "Google Antigravity",
	antigravityDescription: "由单独固定版本的 MIT 开源 dsh-agy 插件提供，对外路由为 agy。",
	antigravityInstalled: "已安装（CLI 管理）",
	antigravityMissing: "尚未安装",
	antigravityCliHint: "为避免暴露无认证的凭据导出页面，默认禁用 dsh-agy Web 管理页；需要时使用 profile 内 CLI 管理 Google OAuth。"
};
//#endregion
//#region src/client/index.tsx
const name = "dsh-grok-build-client";
const inject = ["slots", "locale"];
function apply(ctx) {
	const namespace = "settings.grok-build";
	ctx.effect(() => ctx.locale.register(namespace, {
		zh,
		en
	}), "dsh-coding-subscription-oauth: settings copy");
	const t = ctx.locale.bind(namespace);
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "grok-build",
		order: 17,
		label: () => t("nav"),
		inject: () => ({ t })
	}, GrokBuildSettings));
}
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;

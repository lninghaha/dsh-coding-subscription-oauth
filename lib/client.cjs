Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/GrokBuildSettings.tsx
/** Plugin-owned Grok Build account section inside the dsh Settings shell. */
const STATUS_PATH = "/plugins/dsh-grok-build/auth/status";
const LOGIN_PATH = "/plugins/dsh-grok-build/auth/login";
const LOGIN_CODE_PATH = "/plugins/dsh-grok-build/auth/login/code";
const LOGIN_CANCEL_PATH = "/plugins/dsh-grok-build/auth/login/cancel";
const IMPORT_PATH = "/plugins/dsh-grok-build/auth/import";
const LOGOUT_PATH = "/plugins/dsh-grok-build/auth/logout";
const MODELS_PATH = "/plugins/dsh-grok-build/auth/models";
const POLL_INTERVAL_MS = 1e3;
const pageStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 18,
	maxWidth: 720
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
	fontSize: 15,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary)"
};
const buttonStyle = {
	boxSizing: "border-box",
	minHeight: 34,
	padding: "6px 14px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 18,
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: 14,
	cursor: "pointer"
};
const primaryButtonStyle = {
	...buttonStyle,
	borderColor: "var(--dsw-alias-brand-primary)",
	background: "var(--dsw-alias-brand-primary)",
	color: "white"
};
const errorStyle = {
	...bodyStyle,
	color: "var(--dsw-alias-state-error-primary)"
};
const codeStyle = {
	fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: 20,
	letterSpacing: "0.08em",
	fontWeight: 600,
	color: "var(--dsw-alias-label-primary)"
};
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
function dotStyle(status) {
	return {
		width: 9,
		height: 9,
		borderRadius: "50%",
		flex: "0 0 auto",
		background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : status === "signing-in" || status === "loading" ? "var(--dsw-alias-brand-primary, #1677ff)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
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
/** Grok Build account status and OAuth actions. */
function GrokBuildSettings({ t }) {
	if (t === void 0) throw new Error("Grok Build settings requires its translation function");
	const [status, setStatus] = (0, react.useState)({ status: "loading" });
	const [busy, setBusy] = (0, react.useState)(false);
	const [codeInput, setCodeInput] = (0, react.useState)("");
	const [codeError, setCodeError] = (0, react.useState)(void 0);
	const refresh = (0, react.useCallback)(async () => {
		try {
			setStatus(await jsonRequest(STATUS_PATH));
		} catch (error) {
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		}
	}, [t]);
	(0, react.useEffect)(() => {
		refresh();
	}, [refresh]);
	(0, react.useEffect)(() => {
		if (status.status !== "signing-in") return;
		const timer = window.setInterval(() => {
			refresh();
		}, POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, status.status]);
	const signIn = async (method) => {
		const popup = window.open("about:blank", "_blank");
		if (popup !== null) popup.opener = null;
		setBusy(true);
		setCodeError(void 0);
		setStatus({
			status: "signing-in",
			method
		});
		try {
			const challenge = await jsonRequest(LOGIN_PATH, "POST", { method });
			if (popup === null) {
				setStatus({
					status: "signing-in",
					method: challenge.method,
					url: challenge.url,
					...challenge.userCode === void 0 ? {} : { userCode: challenge.userCode }
				});
				return;
			}
			popup.location.replace(challenge.url);
			setStatus({
				status: "signing-in",
				method: challenge.method,
				url: challenge.url,
				...challenge.userCode === void 0 ? {} : { userCode: challenge.userCode }
			});
		} catch (error) {
			popup?.close();
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	const submitCode = async () => {
		const code = codeInput.trim();
		if (code.length === 0) return;
		setBusy(true);
		setCodeError(void 0);
		try {
			await jsonRequest(LOGIN_CODE_PATH, "POST", { code });
			setCodeInput("");
			await refresh();
		} catch (error) {
			setCodeError(error instanceof Error ? error.message : t("requestFailed"));
		} finally {
			setBusy(false);
		}
	};
	const cancelLogin = async () => {
		setBusy(true);
		try {
			setStatus(await jsonRequest(LOGIN_CANCEL_PATH, "POST"));
		} catch (error) {
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	const importGrok = async () => {
		setBusy(true);
		try {
			setStatus(await jsonRequest(IMPORT_PATH, "POST"));
		} catch (error) {
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	const saveModels = async (selected) => {
		setBusy(true);
		try {
			setStatus(await jsonRequest(MODELS_PATH, "POST", { selected }));
		} catch (error) {
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	const signOut = async () => {
		setBusy(true);
		try {
			await jsonRequest(LOGOUT_PATH, "POST");
			setStatus({ status: "signed-out" });
		} catch (error) {
			setStatus({
				status: "error",
				message: error instanceof Error ? error.message : t("requestFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	const label = status.status === "signed-in" ? t("signedIn") : status.status === "loading" ? t("loadingAccount") : status.status === "signing-in" ? t("signingIn") : status.status === "error" ? t("requestFailed") : t("signedOut");
	const signingInMethod = status.status === "signing-in" && status.method === "device" ? "device" : "pkce";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: pageStyle,
		"aria-labelledby": "grok-build-settings-title",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
			id: "grok-build-settings-title",
			style: titleStyle,
			children: t("title")
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: {
				...bodyStyle,
				marginTop: 6
			},
			children: t("intro")
		})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: cardStyle,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: statusStyle,
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							style: dotStyle(status.status)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
					}), status.status === "loading" ? null : status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: buttonStyle,
						disabled: busy,
						onClick: () => {
							signOut();
						},
						children: busy ? t("working") : t("logout")
					}) : status.status === "signing-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexWrap: "wrap",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: () => {
								signIn(signingInMethod === "pkce" ? "device" : "pkce");
							},
							children: signingInMethod === "pkce" ? t("useDevice") : t("usePkce")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: () => {
								cancelLogin();
							},
							children: t("cancelLogin")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexWrap: "wrap",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: primaryButtonStyle,
							disabled: busy,
							onClick: () => {
								signIn("pkce");
							},
							children: busy ? t("working") : status.status === "error" ? t("loginAgain") : t("login")
						}), status.grokImportAvailable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: busy,
							onClick: () => {
								importGrok();
							},
							children: t("importGrok")
						}) : null]
					})]
				}),
				status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: errorStyle,
					children: status.message
				}) : null,
				status.status !== "signed-in" && status.status !== "loading" && status.grokImportAvailable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: bodyStyle,
					children: t("importHint")
				}) : null,
				status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
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
								saveModels([]);
							},
							children: t("selectAll")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: status.catalogSource === "live" ? t("catalogLive") : status.catalogSource === "cache" ? t("catalogCache") : t("catalogFallback")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("modelHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: listStyle,
						children: (status.available ?? status.models ?? []).map((id) => {
							const checked = (status.selected ?? status.models ?? []).includes(id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: checkRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked,
									disabled: busy,
									onChange: () => {
										const current = new Set(status.selected ?? status.available ?? []);
										if (checked) current.delete(id);
										else current.add(id);
										saveModels([...current]);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
									children: id
								})]
							}) }, id);
						})
					}),
					status.catalogError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t("catalogError")
					})
				] }) : null,
				status.status === "signing-in" && signingInMethod === "device" && status.userCode !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					style: bodyStyle,
					children: [
						t("userCode"),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: codeStyle,
							children: status.userCode
						})
					]
				}) : null,
				status.status === "signing-in" && status.url !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					style: bodyStyle,
					children: [
						t(status.userCode === void 0 && window.open === void 0 ? "popupBlocked" : "openUrl"),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							href: status.url,
							target: "_blank",
							rel: "noreferrer",
							style: linkStyle,
							children: status.url
						})
					]
				}) : null,
				status.status === "signing-in" && signingInMethod === "pkce" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 8
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: bodyStyle,
							children: t("pasteCodeHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: inputStyle,
								value: codeInput,
								placeholder: t("pasteCodePlaceholder"),
								disabled: busy,
								onChange: (event) => setCodeInput(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										submitCode();
									}
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle,
								disabled: busy || codeInput.trim().length === 0,
								onClick: () => {
									submitCode();
								},
								children: t("submitCode")
							})]
						}),
						codeError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: codeError
						})
					]
				}) : null
			]
		})]
	});
}
//#endregion
//#region src/client/locales.ts
/** English copy for the Grok Build settings section. */
const en = {
	nav: "Grok Build",
	title: "Grok Build",
	intro: "Use the Grok Build coding models (grok-4.5, grok-4.6…) from your SuperGrok or X Premium subscription in dsh — no XAI_API_KEY needed.",
	loadingAccount: "Loading account…",
	signedOut: "Not signed in",
	signingIn: "Waiting for xAI authorization…",
	signedIn: "Signed in",
	login: "Sign in with subscription",
	loginAgain: "Sign in again",
	logout: "Sign out",
	working: "Working…",
	userCode: "If xAI asks for a code, enter:",
	openUrl: "If the window did not open, open this URL:",
	popupBlocked: "The browser blocked the sign-in window. Open the URL below, or allow pop-ups and retry.",
	pasteCodeHint: "After authorizing, paste the code (or the full http://127.0.0.1 redirect URL) here:",
	pasteCodePlaceholder: "code or http://127.0.0.1:56121/callback?code=…",
	submitCode: "Submit code",
	useDevice: "Use a device code instead",
	usePkce: "Use authorization code instead",
	cancelLogin: "Cancel sign-in",
	requestFailed: "The Grok Build account request failed.",
	importGrok: "Import from Grok CLI",
	importHint: "Copies ~/.grok/auth.json into dsh. Does not change the Grok file. Later token refresh in dsh may sign Grok CLI out.",
	models: "Visible models",
	catalogLive: "From your xAI account",
	catalogCache: "From the last successful listing",
	catalogFallback: "Built-in baseline (live listing unavailable)",
	catalogError: "Could not refresh the live model list.",
	selectAll: "Show all",
	modelHint: "Checked models appear in the model picker as grok-build / <id>."
};
const zh = {
	nav: "Grok Build",
	title: "Grok Build",
	intro: "在 dsh 中使用 SuperGrok / X Premium 订阅的 Grok Build 编码模型（grok-4.5、grok-4.6 等），无需 XAI_API_KEY。",
	loadingAccount: "正在加载账户信息…",
	signedOut: "尚未登录",
	signingIn: "正在等待 xAI 授权…",
	signedIn: "已登录",
	login: "使用订阅登录",
	loginAgain: "重新登录",
	logout: "退出登录",
	working: "处理中…",
	userCode: "如果 xAI 要求输入代码，请输入：",
	openUrl: "如果窗口没有打开，请打开这个链接：",
	popupBlocked: "浏览器阻止了登录窗口。请打开下方链接，或允许此页面弹出窗口后重试。",
	pasteCodeHint: "完成授权后，把页面显示的 code（或浏览器跳转后的完整 127.0.0.1 链接）粘贴到这里：",
	pasteCodePlaceholder: "code 或 http://127.0.0.1:56121/callback?code=…",
	submitCode: "提交 code",
	useDevice: "改用设备码登录",
	usePkce: "改用授权码登录",
	cancelLogin: "取消登录",
	requestFailed: "Grok Build 账户请求失败。",
	importGrok: "从 Grok CLI 导入",
	importHint: "把 ~/.grok/auth.json 复制进 dsh，不会改 Grok 的文件。之后 dsh 刷新 token 可能让 Grok CLI 掉线。",
	models: "可见模型",
	catalogLive: "来自当前 xAI 账号",
	catalogCache: "来自上一次成功拉取",
	catalogFallback: "内置基线目录（未能拉取账号列表）",
	catalogError: "无法刷新线上模型列表。",
	selectAll: "全部显示",
	modelHint: "勾选的模型会出现在模型选择器里，名字是 grok-build / 模型 id。"
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
	}), "dsh-grok-build: settings copy");
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

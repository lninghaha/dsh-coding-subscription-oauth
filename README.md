
<!-- banner -->
<div align="center">

# 🔐 dsh-coding-subscription-oauth

**v0.6.4** · formerly `dsh-grok-build`

**Coding-subscription OAuth for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Use SuperGrok / X Premium (Grok Build), ChatGPT Plus/Pro (Codex), Kimi Code, Claude Pro/Max and Google Antigravity inside DSH — without a second API-key bill and **without pasting any token into chat.**

[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). `0.6.4` pins the shared dispatcher runtime to `dsh-coding-oauth-core@0.1.1` and `undici@7.29.0`; no configuration, credential, data, or route migration is required. Grok Imagine retains its explicit pinned dispatcher. Releases from `0.6.2` onward include the strict Cordis injection startup fix and DSH `0.1.1-rc.2` support; keep profile/config/credential files and restart one existing DSH Web process only after updating.

---

## Name change

Published first as **`dsh-grok-build`** when it only covered Grok Build. The current name matches the full coding-subscription OAuth surface.

| | Use this | Still works |
|---|---|---|
| npm (recommended) | Current release is `0.6.4`: `dsh plugin --profile web add dsh-coding-subscription-oauth@0.6.4` | No legacy npm package was published |
| GitHub / development | [`dsh-coding-subscription-oauth`](https://github.com/lninghaha/dsh-coding-subscription-oauth) | Previous GitHub repo `dsh-grok-build` was removed |
| CLI | `dsh-coding-oauth` | `dsh-grok-build` |
| Cordis plugin id | `llm-grok-build-oauth` | unchanged |
| Settings HTTP API | `/plugins/dsh-grok-build/*` | unchanged |
| Credential files | `$DSH_HOME/.grok-build-auth.json` and the other `*-oauth-auth.json` files | unchanged |

## ✨ Features

- 🧽 **Bring your own subscription** — SuperGrok, ChatGPT Plus/Pro, Kimi Code, Claude Pro/Max; no extra pay-as-you-go key.
- 🔑 **Local OAuth, no key-pasting** — authorize in Settings or CLI; access/refresh tokens never enter chat, logs or HTTP status.
- 🧩 **One plugin, five providers** — Grok Build (`cli-chat-proxy.grok.com`), Codex, Kimi Code, Claude Code and Google Antigravity.
- 🛡️ **Secure by design** — credential files are owner-only `0600`, atomically written, cross-process locked.
- ⚙️ **Dynamic catalog** — the selector lists only signed-in routes, labelled `(OAuth)`, including grok-4.6 `xhigh`.
- 🌐 **Proxy-aware** — proxies only reviewed subscription domains; Kimi China stays direct by default.
- 📥 **Manual CLI Pull** — Settings discovers allowlisted official Grok/Codex/Kimi/Claude CLI OAuth files read-only; you pull a one-way copy after preview and overwrite confirmation.
- 🗂️ **Tabbed Settings** — Accounts, Gateway, Capabilities, and About; remote hosts prefer device-code sign-in with quieter CLI-missing tips; signed-in cards stay collapsed until expanded.
- 🎛️ **Optional capabilities, default off** — Codex search, usage/quota, image generate/edit, Fast, and Grok Imagine apply live when you turn them on. An additional default-off switch lets non-Codex model routes call Codex image tools while preserving Codex sign-in, session, and attachment-ownership checks.
- 🔌 **Opt-in local API gateway** — default-off loopback OpenAI/Anthropic-compatible server for your own tools, with copyable base URLs and Bearer key; never a public relay.

## Problems this plugin solves

These are the searches and DSH errors that usually lead here. If one of them is your tab title, you are in the right repo.

| You searched / saw | What was actually broken | What this plugin does |
|---|---|---|
| SuperGrok / X Premium in DSH, “Grok Build vs `api.x.ai`” | The built-in `xai` route is the **pay-as-you-go API**. Coding-plan inference is `cli-chat-proxy.grok.com` | Dedicated `grok-build` route + official CLI fingerprint headers (`X-XAI-Token-Auth`, `x-grok-client-identifier`, `x-grok-client-version`) so you do not get a silent 403 |
| `本轮运行失败` **API key is invalid** / `AUTH` mid-turn | The GUI maps **every** `AUTH` code to that banner. Often the OAuth access token just expired (Kimi ~15 min) | Refresh **5 minutes** before expiry; on a 401, invalidate the stored token and **retry the step** after refresh |
| `INVALID_REPLAY_STATE` on the second Codex / Kimi turn | Replay state still carried the native pi-ai provider id after the Harness route alias | Keep the Harness route id in replay state and heal older poisoned messages |
| grok-4.6 **xhigh** / Extra High Effort missing | Live `GET /v1/models-v2` already returns `reasoning_efforts` including `xhigh`; cloning the grok-4.5 template hides it (pi-ai treats absent `xhigh` as unsupported) | Parse live `reasoning_efforts` into `thinkingLevelMap`. grok-4.6 gets `xhigh`; grok-4.5 stays low/medium/high |
| Kimi Code 401, or requests going out as Anthropic `x-api-key` | The OAuth token was attached as an Anthropic key | Wire **only** `Authorization: Bearer` on `api.kimi.com/coding` |
| Unsigned-in Grok / Codex / Claude still in the model picker | Every registered route was listed | Unauthenticated routes expose **no models**; signed-in names show `(OAuth)` |
| Device login on a **remote / headless** DSH | Browser PKCE cannot reach `localhost` | Device-code for Grok, Codex and Kimi; Claude accepts a pasted localhost redirect URL |
| Proxy works for Grok/Codex but breaks Kimi in China | One global `HTTPS_PROXY` | Allowlisted proxy; Kimi stays **direct** unless `proxyKimi: true`. `auth.kimi.com` ≠ `api.moonshot.cn` |
| ChatGPT Plus / Claude Pro in DSH without another API bill | Separate OpenAI / Anthropic API keys | Local OAuth on `codex-oauth` / `claude-code-oauth`, coexist with existing `openai` / `kimi-coding` API-key routes |

Grok Build device login, live `/v1/models-v2` and Responses streaming are verified on real deployments. Codex / Kimi / Claude reuse `@earendil-works/pi-ai` native OAuth instead of re-implementing vendor flows.

## Supported providers

| Provider | Route | Auth | Coexists with |
|---|---|---|---|
| **xAI Grok Build** | `grok-build` | SuperGrok / X Premium OAuth | `xai` |
| **OpenAI Codex** | `codex-oauth` · optional `codex-oauth-fast` | ChatGPT Plus/Pro OAuth | `openai` |
| **Kimi Code** | `kimi-code-oauth` | Kimi Code OAuth | `kimi-coding` |
| **Claude Code** | `claude-code-oauth` | Claude Pro/Max OAuth | — |
| **Google Antigravity** | `agy` | `dsh-agy` Google OAuth | — |

> Grok Build's device login, dynamic `/v1/models-v2` catalog and Responses streaming are verified on real deployments. Codex/Kimi/Claude reuse the provider-native OAuth/refresh from `@earendil-works/pi-ai` instead of re-implementing vendor flows.

## 🚀 Quick start

```bash
# 1. install the current npm release into the web profile
dsh plugin --profile web add dsh-coding-subscription-oauth@0.6.4

# 2. optional — Google Antigravity (pinned, reviewed version)
dsh plugin --profile web add dsh-agy@0.1.2

# 3. restart the existing DSH Web process with its configured process manager
# `dsh web` is the official CLI alias for the web profile, not a service-unit name.
```

Then open **Settings → Coding OAuth** and sign in to any provider. Done — pick your authenticated model from the selector.

## 📚 Table of contents

- [Name change](#name-change)
- [Features](#-features)
- [Problems this plugin solves](#problems-this-plugin-solves)
- [Supported providers](#supported-providers)
- [Quick start](#-quick-start)
- [Install](#install)
- [Settings page](#settings-page)
- [Optional capabilities](#optional-capabilities)
- [Local API gateway](#local-api-gateway)
- [CLI](#cli)
- [Kimi in China](#kimi-in-china)
- [Network proxy](#network-proxy)
- [Resilience](#resilience)
- [Credentials](#credentials)
- [Architecture](#architecture)
- [Technical notes](#technical-notes)
- [Compliance](#compliance)
- [Documentation](#documentation)
- [Related](#related)
- [Contributing](#contributing)
- [License](#license)

## Install

Requires DeepSeek Harness `0.1.1-rc.2` and Node.js 22.19+. Full details in the [installation notes](INSTALL.md).

```bash
# current npm release
dsh plugin --profile web add dsh-coding-subscription-oauth@0.6.4

# development / alternative: from GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth

# local development checkout (alternative)
# dsh plugin --profile web add ./dsh-coding-subscription-oauth
```

Restart the existing DSH Web process after installing. Maintainers can verify a live deployment from a source checkout (npm installs do not include these scripts):

```bash
pnpm run verify:deployed            # checks real /api/llm.models + OAuth state
DSH_EXPECT_AGY_AUTH=signed-in pnpm run verify:deployed   # if Google is signed in

DSH_RESTORE_PROVIDER=openai \
DSH_RESTORE_MODEL=gpt-5.6-sol \
DSH_RESTORE_REASONING=max \
pnpm run smoke:deployed             # real Codex/Kimi tool-calls + second-turn replay
```

> `smoke:deployed` creates temporary sessions, exercises Codex and Kimi tool-calls plus a second user turn (regression coverage for `INVALID_REPLAY_STATE`), restores the declared default model, then archives the sessions.

## Settings page

Open **Settings → Coding OAuth**. The page uses segmented tabs — **Accounts**, **Gateway**, **Capabilities**, and **About** — with live status hints, semantic badges, and skeleton loading states. On a remote (non-loopback) host, Accounts prefers device-code sign-in and collapses noisy CLI-missing hints into one tip. Signed-in provider cards collapse to a compact summary; expand one for model search/filter, quota progress bars, or CLI Pull controls. Gateway adds quick-setup snippets (cURL / Python / IDE), and Capabilities uses toggle switches with dependency-aware disabled states plus Imagine status.

DSH Web remains loopback-only. Remote Settings must travel through an SSH tunnel or an owner-authenticated HTTPS reverse proxy. The plugin prefers a DSH-native `ownerRequestPolicy`; its fallback requires the real trusted TCP peer, exact HTTPS Origin/Host, same-origin Fetch Metadata, a proxy-injected owner proof, and an independent mutation CSRF proof. Forwarded headers never grant access, and incomplete policy fails closed. See [INSTALL.md](INSTALL.md#安全访问远程-settings).

<table>
  <tr>
    <td align="center" valign="top" width="33%">
      <a href="media/en/settings_accounts.png"><img src="media/en/settings_accounts.png" alt="Coding OAuth Accounts tab" width="280" /></a><br />
      <sub>Accounts</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <a href="media/en/settings_gateway.png"><img src="media/en/settings_gateway.png" alt="Coding OAuth Gateway tab" width="280" /></a><br />
      <sub>Gateway</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <a href="media/en/settings_capabilities.png"><img src="media/en/settings_capabilities.png" alt="Coding OAuth Capabilities tab" width="280" /></a><br />
      <sub>Capabilities</sub>
    </td>
  </tr>
</table>

| Provider | Methods |
|---|---|
| Grok | auth code · device code · model selection |
| Codex | device code (recommended on remote DSH) · browser PKCE |
| Kimi | device code |
| Claude | browser PKCE (remote browser can paste the full localhost redirect URL) |
| Antigravity | `dsh-agy` install status + profile-local CLI commands |

Use device code when the DSH host is remote. Browser/PKCE sign-in opens the provider URL; if the localhost callback cannot reach this DSH host, paste either the returned authorization code or the complete redirect URL into the waiting Settings card.

Settings also **discovers** allowlisted official Grok / Codex / Kimi / Claude CLI OAuth files (read-only). Synchronization is an explicit one-way **Pull** — not auto-import: discover → preview → conflict/fingerprint check → confirm overwrite. Official CLI files are never written. Reads refuse symlinks, non-regular files, non-owner files, group/other access, and oversized documents (`O_NOFOLLOW`). Preview tickets are one-use, expire in five minutes, and are capped at 32.

The selector only lists routes that completed authentication; unauthenticated providers return an empty list. Provider names carry `(OAuth)`, and the catalog refreshes via `llm/adapters-updated` after sign-in/out.

## Optional capabilities

All eight switches start **off** and apply **live** (no restart): `codexSearch`, `codexImages`, `codexImageEdits`, `codexImagesAnyModel`, `codexUsage`, `codexFast`, `grokImagineImage`, and `grokImagineVideo`. `codexImagesAnyModel` only relaxes the calling-model route gate; it still requires signed-in Codex, `codexImages` (and the edits flag for edit), and keeps session attachment ownership and edit authorization. Numeric controls are `searchResults` (1–20, default 5), `imageCount` (1–4, default 1), and `videoArtifactTtlMs` (1 hour–7 days, default 7 days; the UI shows 1–168 hours). Lowering video retention shortens and cleans existing artifacts immediately; raising it affects only artifacts created afterward. Administrators may provide secret-free composition defaults under plugin config `capabilities`; live user settings in the `coding-subscription-oauth` settings section override that base, and omitting it keeps every switch off.

`codex-oauth-fast` is advertised only after a **fresh live catalog** lists at least one `priority`-eligible model. Those requests send `service_tier: priority` plus a routing hint. The UI says **Fast requested** and never guarantees latency or that upstream will honor the request.

Codex search, usage, and images are **opt-in** private `chatgpt.com/backend-api` endpoints. Image generation uses the fixed model `gpt-image-2`. Image edit accepts only current-session top-level attachment ids that this session already owns.

Grok Imagine calls official `https://api.x.ai` with `grok-imagine-image-2.0` and `grok-imagine-video-1.5`. It uses a **separate** DSH credential reference `XAI_API_KEY` — never Grok OAuth and never a process-env fallback. Generated outputs are fetched under MIME / size / time / redirect / DNS controls from frozen hosts `imgen.x.ai`, `videogen.x.ai`, and `vidgen.x.ai`, stored privately (256 MiB hard caps for one object and aggregate unique bytes, seven days), and served only on same-origin loopback routes.

## Local API gateway

Default **off**. When enabled it starts an isolated `node:http` server (not the DSH web port) on `127.0.0.1:18080` and reuses the same signed-in OAuth sessions:

```yaml
gateway:
  enabled: false
  bind: 127.0.0.1
  port: 18080
```

Endpoints: `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`. A Bearer key is stored at `$DSH_HOME/.coding-oauth-gateway.json` (`0600`).

On the **Gateway** tab, copy the OpenAI base URL (for example, `http://127.0.0.1:18080/v1`), the Anthropic base URL, or the current Bearer key without rotating it. Key reveal is loopback-only and is never persisted to browser storage. Key rotation requires confirmation. Edit the listen port with **Apply** or fill it with **Random** (`18100`–`18999`); the selected port is persisted in the owner-only gateway document, and a running listener rebinds to it. Bind remains YAML-only; a non-loopback bind requires a key. This is not a remote relay.

## CLI

```bash
# `dsh-grok-build` remains a command alias
dsh-coding-oauth login [--pkce] | import | status | logout

# newer providers
dsh-coding-oauth login codex --device-auth | codex --browser | kimi | claude
dsh-coding-oauth status all
dsh-coding-oauth logout codex

# Antigravity (install into web profile first)
dsh plugin --profile web exec dsh-agy login --headless
```

> `dsh-agy` CLI edits the account pool outside the DSH process, so it can't emit an in-process catalog event — close and reopen the model selector after signing in/out.

## Kimi in China

Kimi Code subscription OAuth uses `https://auth.kimi.com`; inference uses `https://api.kimi.com/coding`. `https://api.moonshot.cn/v1` is the pay-as-you-go **Moonshot Open Platform** API-key channel — there is no switchable "China OAuth endpoint". This plugin uses a separate `kimi-code-oauth` route and doesn't affect an existing `kimi-coding` API-key config.

## Network proxy

Priority: `config.proxy` → `CODING_OAUTH_PROXY` → `GROK_BUILD_PROXY` → `HTTPS_PROXY`/`HTTP_PROXY`.

```yaml
- id: llm-grok-build-oauth
  config:
    proxy: http://127.0.0.1:7890
    proxyKimi: false
```

Only reviewed subscription domains are proxied (xAI/Grok, OpenAI Codex, Claude/Anthropic, Google Antigravity); all other DSH traffic keeps its original dispatcher. Kimi stays direct by default and only uses the proxy when `proxyKimi: true`.

## Resilience

OAuth access tokens refresh proactively **five minutes** before their stored expiry (pi-ai 0.84+), so a request never rides a token into its final seconds. If an upstream still rejects a locally-valid token with 401/403 — server-side revocation or clock skew — the plugin backdates the stored credential and the retried step refreshes before reuse, recovering transparently instead of failing the turn.

Request retries use the harness retry policy: transient failures (`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE`) **and `AUTH`** retry with exponential backoff (default 5 retries, 5 s → 10 s → 20 s → 40 s → 80 s, ~155 s stacked, 10% jitter). xAI “at capacity / high demand / priority processing” finish messages are remapped to `RATE_LIMIT` so they enter this policy (pi-ai would otherwise label them `PI_AI_ERROR` when upstream `error.code` is null). Quota exhaustion and a dead refresh token are **not** retried — they fail fast with the real message and a sign-in prompt. Override per deployment:

```yaml
- id: llm-grok-build-oauth
  config:
    retryPolicy:
      mode: normal
      maxRetries: 5
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, AUTH]
      backoff: { initialDelayMs: 5000, maxDelayMs: 80000, jitterRatio: 0.1 }
```

## Credentials

Owner-only `0600`, atomically written, cross-process file lock:

- `$DSH_HOME/.grok-build-auth.json`
- `$DSH_HOME/.codex-oauth-auth.json`
- `$DSH_HOME/.kimi-code-oauth-auth.json`
- `$DSH_HOME/.claude-code-oauth-auth.json`

Selection caches live in the matching `*-models.json` files. Grok Imagine uses a separate DSH credential named `XAI_API_KEY` (not the Grok OAuth file). **No HTTP status, log or UI may ever return a token.**

## Architecture

```mermaid
flowchart LR
    subgraph DSH["DSH Harness"]
        UI[Settings / Web · Coding OAuth] --> LLM[llm route]
        LLM --> ALIA[Route-alias adapter]
    end
    ALIA --> PI[pi-ai native provider<br/>OAuth · refresh · stream]
    PI --> GROK[Grok Build]
    PI --> COD[Codex]
    PI --> KIMI[Kimi]
    PI --> CLAU[Claude]
    AGY[dsh-agy plugin] --> GAL[Google Antigravity]
```

## Technical notes

- **Grok Build**: Responses API on `cli-chat-proxy.grok.com/v1` (not `api.x.ai`), CLI fingerprint headers, live `/v1/models-v2` including grok-4.6 `reasoning.effort: xhigh`.
- **Codex/Kimi/Claude**: pi-ai native providers handle OAuth and refresh; the route-alias adapter maps them to native ids so multi-turn replay does not throw `INVALID_REPLAY_STATE`.
- The Kimi access token is explicitly converted to `Authorization: Bearer` — never mistakenly an Anthropic `x-api-key`.
- **Codex Fast / private endpoints**: `codex-oauth-fast` is opt-in and fail-closed on a stale catalog; search, usage and `gpt-image-2` images stay off until enabled.
- **Grok Imagine**: official `api.x.ai` only, `XAI_API_KEY` through DSH credentials, same-origin download routes under `/plugins/dsh-grok-build/imagine/*`.
- Google Antigravity is **not** reverse-engineered here; it uses a version-pinned dedicated DSH plugin.

## Compliance

Using coding subscriptions through a third-party harness may sit in a gray area of each vendor's terms and can trigger quota, regional or account-risk controls. **Use only your own accounts**; this project does not support bulk accounts, quota resale, remote relay, paywall bypass or client impersonation. For commercial use, prefer the vendors' official API-key channels.

## Documentation

| Doc | Purpose |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Installation & usage details |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`docs/00-project-rules.md`](docs/00-project-rules.md) | Versioning, release loop, publish vs local-only split |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Internal architecture (routes, data flow, modules, API) · [中文](docs/02-architecture.zh-CN.md) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution guide |

## Related

- [`dsh-agy`](https://www.npmjs.com/package/dsh-agy) — separate pinned plugin for Google Antigravity.

## Contributing

Contributions of all kinds are welcome — features, docs, translations, bug reports. See **[CONTRIBUTING](CONTRIBUTING.md)** for the flow, commit conventions and the release loop. If your language isn't listed, PR a README translation and we'll add it to the table above.

## License

[Apache-2.0](LICENSE) · see [NOTICE](NOTICE). Portions derived from the [dsh-xai](https://github.com/MirDie/dsh-xai) project (Apache-2.0).

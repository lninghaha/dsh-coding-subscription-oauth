<!-- banner -->
<div align="center">

# 🔐 dsh-coding-subscription-oauth

**v0.5.2** · formerly `dsh-grok-build`

**Coding-subscription OAuth for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Use SuperGrok / X Premium (Grok Build), ChatGPT Plus/Pro (Codex), Kimi Code, Claude Pro/Max and Google Antigravity inside DSH — without a second API-key bill and **without pasting any token into chat.**

[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![npm](https://img.shields.io/npm/v/dsh-coding-subscription-oauth.svg)](https://www.npmjs.com/package/dsh-coding-subscription-oauth)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Português (BR)](docs/i18n/README.pt-BR.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Русский](docs/i18n/README.ru.md)*

</div>

---

## Name change

Published first as **`dsh-grok-build`** when it only covered Grok Build. The current name matches the full coding-subscription OAuth surface.

| | Use this | Still works |
|---|---|---|
| npm (recommended) | `dsh plugin --profile web add dsh-coding-subscription-oauth` or `npm install dsh-coding-subscription-oauth` (latest) | No legacy npm package was published |
| GitHub / development | [`dsh-coding-subscription-oauth`](https://github.com/lninghaha/dsh-coding-subscription-oauth) | `github:lninghaha/dsh-grok-build` (same `main`) |
| CLI | `dsh-coding-oauth` | `dsh-grok-build` |
| Cordis plugin id | `llm-grok-build-oauth` | unchanged |
| Settings HTTP API | `/plugins/dsh-grok-build/*` | unchanged |

## Features

- Bring your own SuperGrok / ChatGPT Plus/Pro / Kimi Code / Claude Pro/Max subscription — no separate metered API-key bill
- Fixes common harness gaps: invalid API-key / AUTH, `INVALID_REPLAY_STATE`, Grok `xhigh`, Kimi Bearer vs `x-api-key`
- Settings UI (Accounts / Gateway / Capabilities / About) with device-code and browser PKCE sign-in
- Optional local OpenAI/Anthropic-compatible loopback gateway (off by default)
- Opt-in Codex search/images/usage/Fast and Grok Imagine (all default off)
- Scoped proxy + proactive token refresh / AUTH retry

## Supported providers

| Provider | Route | Auth | pi-ai native id |
|---|---|---|---|
| **Grok Build** | `grok-build` | device / auth code · CLI import | `xai` (Grok Build endpoint) |
| **OpenAI Codex** | `codex-oauth` | device (remote) · browser PKCE | `openai-codex` |
| **Kimi Code** | `kimi-code-oauth` | device code | `kimi-coding` |
| **Claude Code** | `claude-code-oauth` | browser PKCE | — |
| **Google Antigravity** | `agy` | `dsh-agy` Google OAuth | — |

## Quick start

```bash
# 1. install the latest npm release into the web profile
dsh plugin --profile web add dsh-coding-subscription-oauth

#    or with npm (latest package)
npm install dsh-coding-subscription-oauth

# 2. optional — Google Antigravity (pinned, reviewed)
dsh plugin --profile web add dsh-agy@0.1.2

# 3. restart the resident dsh web service
systemctl --user restart dsh-web.service
```

Then open **Settings → Coding OAuth** and sign in. Commands above install the **latest** registry release (no version pin). Details: [INSTALL.md](INSTALL.md) · [中文](INSTALL.zh-CN.md).

## Install

Requires DeepSeek Harness `0.1.0-rc.6+` and Node.js 22.19+.

```bash
# latest from npm (recommended)
dsh plugin --profile web add dsh-coding-subscription-oauth

# explicit npm install (latest)
npm install dsh-coding-subscription-oauth

# development / alternate: from GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth
```

Restart `dsh web` after installing. Proxy, gateway, capabilities, credentials, Kimi/China notes, resilience, troubleshooting, and maintainer `verify:deployed` / `smoke:deployed` live in [INSTALL.md](INSTALL.md).

## Settings page

Open **Settings → Coding OAuth** — tabs **Accounts**, **Gateway**, **Capabilities**, and **About**.

| Provider | Methods |
|---|---|
| Grok | auth code · device code · model selection |
| Codex | device code (recommended on remote DSH) · browser PKCE |
| Kimi | device code |
| Claude | browser PKCE (paste full localhost redirect URL if needed) |
| Antigravity | `dsh-agy` install status + profile-local CLI |

Optional capabilities (Codex search/images/usage/Fast, Grok Imagine) start **off** and apply live — see [INSTALL.md](INSTALL.md).

## Local API gateway

Default **off**. When enabled: isolated `node:http` on `127.0.0.1:18080`, reusing signed-in OAuth sessions. Endpoints: `/healthz`, `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`. Configure under Settings → Gateway or profile YAML. Not a remote relay — details in [INSTALL.md](INSTALL.md).

## CLI

```bash
dsh-coding-oauth login [--pkce] | import | status | logout
dsh-coding-oauth login codex --device-auth | codex --browser | kimi | claude
dsh-coding-oauth status all
dsh plugin --profile web exec dsh-agy login --headless   # after installing dsh-agy
```

## Compliance

Using coding subscriptions through a third-party harness may sit in a gray area of each vendor's terms. **Use only your own accounts**; this project does not support bulk accounts, quota resale, remote relay, paywall bypass or client impersonation. For commercial use, prefer official API-key channels.

## Documentation

| Doc | Purpose |
|---|---|
| [`INSTALL.md`](INSTALL.md) · [`INSTALL.zh-CN.md`](INSTALL.zh-CN.md) | Installation & usage details |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`docs/00-project-rules.md`](docs/00-project-rules.md) | Versioning, release loop, publish vs local-only |
| [`docs/02-architecture.md`](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md) | Internal architecture |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution guide |

## Related

- [`dsh-agy`](https://www.npmjs.com/package/dsh-agy) — pinned plugin for Google Antigravity.

## Contributing

Contributions welcome — features, docs, translations, bug reports. See [CONTRIBUTING.md](CONTRIBUTING.md). User-facing doc changes must update **English + 简体中文** together; other languages under `docs/i18n/` may follow in later PRs.

## License

[Apache-2.0](LICENSE) · see [NOTICE](NOTICE). Portions derived from the [dsh-xai](https://github.com/MirDie/dsh-xai) project (Apache-2.0).

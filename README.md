
<!-- banner -->
<div align="center">

# 🔐 dsh-coding-subscription-oauth

**v0.5.2** · formerly `dsh-grok-build`

**Coding-subscription OAuth for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Use SuperGrok / X Premium (Grok Build), ChatGPT Plus/Pro (Codex), Kimi Code, Claude Pro/Max and Google Antigravity inside DSH — without a second API-key bill and **without pasting any token into chat.**

[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

## Name change

Published first as **`dsh-grok-build`** when it only covered Grok Build. The current name matches the full coding-subscription OAuth surface.

| | Use this | Still works |
|---|---|---|
| npm (recommended) | Current release is `0.5.2`: `dsh plugin --profile web add dsh-coding-subscription-oauth@0.5.2` | No legacy npm package was published |
| GitHub / development | [`dsh-coding-subscription-oauth`](https://github.com/lninghaha/dsh-coding-subscription-oauth) | Previous GitHub repo `dsh-grok-build` was removed |
| CLI | `dsh-coding-oauth` | `dsh-grok-build` |
| Cordis plugin id | `llm-grok-build-oauth` | unchanged |
| Settings HTTP API | `/plugins/dsh-grok-build/*` | unchanged |
| Credential files | `$DSH_HOME/.grok-build-auth.json` and the other `*-oauth-auth.json` files | unchanged |

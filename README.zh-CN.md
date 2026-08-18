<!-- banner -->
<div align="center">

# 🔐 dsh-coding-subscription-oauth

**v0.5.2** · 原名 `dsh-grok-build`

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 的编码订阅 OAuth。** 在 DSH 内使用 SuperGrok / X Premium（Grok Build）、ChatGPT Plus/Pro（Codex）、Kimi Code、Claude Pro/Max 与 Google Antigravity —— 不必另开按量 API-key，也**不必把任何 token 粘贴进聊天**。

[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![npm](https://img.shields.io/npm/v/dsh-coding-subscription-oauth.svg)](https://www.npmjs.com/package/dsh-coding-subscription-oauth)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Português (BR)](docs/i18n/README.pt-BR.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Русский](docs/i18n/README.ru.md)*

</div>

---

## 项目更名

最初只做 Grok Build，仓库名是 **`dsh-grok-build`**。现在覆盖完整编码订阅 OAuth 面，因此改为现名。

| | 请用这个 | 仍然可用 |
|---|---|---|
| npm（推荐） | `dsh plugin --profile web add dsh-coding-subscription-oauth` 或 `npm install dsh-coding-subscription-oauth`（最新版） | 没有发布过旧 npm 包 |
| GitHub / 开发安装 | [`dsh-coding-subscription-oauth`](https://github.com/lninghaha/dsh-coding-subscription-oauth) | `github:lninghaha/dsh-grok-build`（同一条 `main`） |
| CLI | `dsh-coding-oauth` | `dsh-grok-build` |
| Cordis 插件 id | `llm-grok-build-oauth` | 不变 |
| 设置页 HTTP API | `/plugins/dsh-grok-build/*` | 不变 |

## 特性

- 自带 SuperGrok / ChatGPT Plus/Pro / Kimi Code / Claude Pro/Max 订阅，不必另开按量 API-key
- 补齐常见接入缺口：无效 API-key / AUTH、`INVALID_REPLAY_STATE`、Grok `xhigh`、Kimi Bearer vs `x-api-key`
- 设置页（账号 / 网关 / 能力 / 关于），支持设备码与浏览器 PKCE
- 可选本地 OpenAI/Anthropic 兼容 loopback 网关（默认关）
- 可选 Codex 搜索/图像/用量/Fast 与 Grok Imagine（默认全关）
- 作用域代理 + 主动刷新令牌 / AUTH 重试

## 支持的供应商

| 供应商 | 路由 | 认证 | pi-ai 原生 id |
|---|---|---|---|
| **Grok Build** | `grok-build` | 设备码 / 授权码 · CLI 导入 | `xai`（Grok Build 端点） |
| **OpenAI Codex** | `codex-oauth` | 设备码（远程）· 浏览器 PKCE | `openai-codex` |
| **Kimi Code** | `kimi-code-oauth` | 设备码 | `kimi-coding` |
| **Claude Code** | `claude-code-oauth` | 浏览器 PKCE | — |
| **Google Antigravity** | `agy` | `dsh-agy` Google OAuth | — |

## 快速开始

```bash
# 1. 安装最新 npm 发布版到 web profile
dsh plugin --profile web add dsh-coding-subscription-oauth

#    或使用 npm 安装最新包
npm install dsh-coding-subscription-oauth

# 2. 可选 —— Google Antigravity（固定审核过的版本）
dsh plugin --profile web add dsh-agy@0.1.2

# 3. 重启常驻的 dsh web 服务
systemctl --user restart dsh-web.service
```

然后打开 **设置 → 编码 OAuth** 登录即可。上述命令安装 registry **最新**发布版（不钉版本号）。细节见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md) · [English](INSTALL.md)。

## 安装

需要 DeepSeek Harness `0.1.0-rc.6+` 与 Node.js 22.19+。

```bash
# 推荐：从 npm 安装最新版
dsh plugin --profile web add dsh-coding-subscription-oauth

# 显式 npm 安装最新包
npm install dsh-coding-subscription-oauth

# 开发 / 备用：从 GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth
```

安装后重启 `dsh web`。代理、网关、可选能力、凭据、Kimi 中国说明、弹性重试、故障排查以及维护者 `verify:deployed` / `smoke:deployed` 见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。

## 设置页

打开 **设置 → 编码 OAuth** —— 标签 **账号**、**网关**、**能力**、**关于**。

| 供应商 | 方式 |
|---|---|
| Grok | 授权码 · 设备码 · 模型选择 |
| Codex | 设备码（远程 DSH 推荐）· 浏览器 PKCE |
| Kimi | 设备码 |
| Claude | 浏览器 PKCE（必要时粘贴完整 localhost redirect URL） |
| Antigravity | `dsh-agy` 安装状态 + profile 内 CLI |

可选能力（Codex 搜索/图像/用量/Fast、Grok Imagine）默认**全关**、打开后立即生效 —— 详见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。

## 本地 API 网关

默认**关闭**。启用后：隔离的 `node:http` 监听 `127.0.0.1:18080`，复用已登录的 OAuth 会话。端点：`/healthz`、`/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/messages`。在设置 → 网关或 profile YAML 中配置。不是远程中继 —— 细节见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。

## CLI

```bash
dsh-coding-oauth login [--pkce] | import | status | logout
dsh-coding-oauth login codex --device-auth | codex --browser | kimi | claude
dsh-coding-oauth status all
dsh plugin --profile web exec dsh-agy login --headless   # 安装 dsh-agy 后
```

## 合规

订阅 OAuth 接入第三方 harness 可能触及各供应商条款。**仅使用本人账号**；本项目不支持批量账号、配额倒卖、远程中继、付费墙绕过或客户端伪装。商用请走官方 API-key 通道。

## 文档

| 文档 | 用途 |
|---|---|
| [`INSTALL.zh-CN.md`](INSTALL.zh-CN.md) · [`INSTALL.md`](INSTALL.md) | 安装与使用细节 |
| [`CHANGELOG.md`](CHANGELOG.md) | 发布历史 |
| [`docs/00-project-rules.md`](docs/00-project-rules.md) | 版本、发布环、公开/本地分层 |
| [`docs/02-architecture.zh-CN.md`](docs/02-architecture.zh-CN.md) · [English](docs/02-architecture.md) | 内部架构 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献指南 |

## 相关项目

- [`dsh-agy`](https://www.npmjs.com/package/dsh-agy) —— Google Antigravity 的钉版本插件。

## 贡献

欢迎功能、文档、翻译与缺陷报告。见 [CONTRIBUTING.md](CONTRIBUTING.md)。面向用户的文档变更必须**同时更新英文 + 简体中文**；`docs/i18n/` 下其他语言可后续跟进。

## 许可证

[Apache-2.0](LICENSE) · 见 [NOTICE](NOTICE)。部分代码源自 [dsh-xai](https://github.com/MirDie/dsh-xai)（Apache-2.0）。

# 02 · 架构设计

> 中文版 · [**English**](02-architecture.md)

本文描述 `dsh-coding-subscription-oauth` 的内部架构，是 `README.md` 技术说明的来源，面向贡献者与维护者。

## 1. 路由与原生 provider

```text
Harness route          pi-ai provider        请求认证
────────────────────────────────────────────────────────────
grok-build             grok-build            xAI access token + Grok CLI headers
codex-oauth             openai-codex          OAuth token → apiKey override
kimi-code-oauth         kimi-coding           OAuth token → Authorization: Bearer
claude-code-oauth       anthropic             sk-ant-oat token → Claude Code headers
agy                     dsh-agy external      dsh-agy 自有账号池
```

外部 route 和 pi-ai 原生 id 由 `AliasLlmAdapter` 分隔。`PiAiAdapter` 始终看到原生 provider id，因此 Codex 工具调用、Claude compatibility 判断和 Kimi Anthropic transport 不因 route 改名而失效。

模型发现里的“已认证”定义为存在可读、结构有效且可刷新的 OAuth credential；不会在每次打开选择器时向上游做在线探测。已被上游撤销但本地仍有效的 credential 会在 token refresh 或推理时被识别，避免目录加载产生额外网络请求。

## 2. 主机数据流

```text
Settings / CLI
  │
  ├─ GrokBuildWebAuth ── Grok custom PKCE/device
  │                      └─ .grok-build-auth.json
  │
  ├─ SubscriptionWebAuth ── pi-ai OAuth login/refresh
  │         ├─ Codex  ── .codex-oauth-auth.json
  │         ├─ Kimi   ── .kimi-code-oauth-auth.json
  │         └─ Claude ── .claude-code-oauth-auth.json
  │
  └─ OAuthImportSession ── 白名单 CLI 只读发现
            └─ 显式单向拉取（预览票据 → 目标 store）
               从不写入官方 CLI 文件

OAuthProviderSession.resolveAccessToken()
  └─ Models.getAuth(native id)        # refresh-under-lock
       └─ OAuthCredentialFileStore    # 0600 + atomic write + cross-process lock

CapabilitySettingsController（默认关闭，applies: live）
  └─ CapabilityRuntimeState
       ├─ Codex 搜索 / 用量 / gpt-image-2 图像
       ├─ codex-oauth-fast（仅在最新 priority catalog 之后）
       └─ Grok Imagine（api.x.ai + DSH 凭据 XAI_API_KEY）

ctx.llm route
  └─ AliasLlmAdapter
       └─ PiAiAdapter
            └─ native pi-ai Provider.streamSimple()
```

## 3. 模块职责

- `store.ts`：一个文件只拥有一个 provider credential；保留旧 Grok store API；`invalidate()` 在上游 AUTH 拒绝后把 `expires` 回写到过去。
- `oauth-providers.ts`：Codex/Kimi/Claude 定义、route metadata、请求 token bridge。
- `oauth-session.ts`：登录、刷新、静态模型目录和模型选择缓存。
- `oauth-sources.ts`：白名单官方 Grok/Codex/Kimi/Claude CLI 发现；加固的 lstat/`O_NOFOLLOW`/属主/权限/普通文件/大小读取；一次性预览票据（五分钟、最多 32 张）；从不写入官方 CLI 文件。
- `oauth-import-routes.ts`：同源拉取 HTTP API（发现 → 预览 → 提交/取消），写入发生在目标 store 锁内。
- `alias-adapter.ts`：转换 Harness route、不修改 pi-ai model.provider，并在 `listModels()` 前执行 credential gate；未认证或凭据读取失败返回空目录，provider group 名使用 `(OAuth)`。AUTH finish 时作废本地令牌，让 harness 重试先刷新。finish 管道还会重映射 Kimi 误标 AUTH 的上下文溢出，以及 xAI capacity 文案 → `RATE_LIMIT`。
- `grok-errors.ts`：识别 xAI「at capacity / high demand / priority processing / overloaded」并改为 `RATE_LIMIT`，避免 `PI_AI_ERROR` 跳过退避。
- `adapter.ts`：组合 Grok 与三个 subscription profile；向 pi-ai 要求至少 60 秒剩余有效期，并注册包含 AUTH 与瞬时故障码的 retryPolicy（默认 5 次，5 s → 80 s 指数叠加）。可选包装 `codex-oauth-fast`，显示为 **已请求 Fast**。
- `auth-routes.ts`：旧 Grok API + 新统一 `/plugins/dsh-grok-build/oauth/*`；JSON 写请求使用 64 KiB 有界读取器，无效/超限 body 分别返回 400/413。
- `capability-settings.ts`：默认关闭、立即生效的开关与限制（搜索 1–20、图像 1–4、产物 TTL 1 小时–7 天）。
- `capability-routes.ts`：无密钥的能力快照，以及可选的 Codex 用量和 Imagine 凭据状态路由。
- `capability-runtime.ts`：按 live 开关绑定/解绑搜索、工具，以及仅在最新 priority catalog 后发布 Fast 路由。
- `capability-tools.ts`：可选 Codex / Grok Imagine 工具定义；执行时重新读取开关。
- `codex-http.ts`：需打开的私有 `chatgpt.com/backend-api` 客户端（仅 HTTPS、仅第一方主机）。
- `codex-search.ts` / `codex-usage.ts` / `codex-images.ts`：可选搜索、配额，以及固定 `gpt-image-2` 生成/编辑（编辑要求当前会话顶层附件所有权）。
- `codex-model-capabilities.ts`：live Codex service-tier 缓存；Fast 资格失败关闭；注入 `service_tier: priority` 与路由提示。
- `grok-imagine.ts`：官方 `api.x.ai` Imagine 客户端（`grok-imagine-image-2.0` / `grok-imagine-video-1.5`）；`XAI_API_KEY` 只通过 DSH 凭据；MIME/大小/超时/重定向/DNS 下载控制；冻结主机 `imgen.x.ai`、`videogen.x.ai`、`vidgen.x.ai`。
- `imagine-routes.ts`：生成图像与视频产物的同源 loopback GET 路由。
- `media-store.ts`：属主私有产物库（单件与唯一对象总量均硬限 256 MiB，最长七天）。
- `client/`：四个原生账号卡片、CLI 拉取、能力开关、网关控制，以及外部 Antigravity 状态卡片。
- `proxy.ts`：process-wide undici dispatcher，但只代理审核过的域名白名单。
- `gateway*.ts`：可选的隔离 loopback OpenAI/Anthropic 兼容 HTTP 服务（默认关；独立于 DSH web 端口）。
- `dsh-host-adapter.ts` / `web-origin.ts`：隔离可变 DSH 服务，并优先使用宿主 `ownerRequestPolicy`；fallback 对 loopback/SSH 做 Host/Origin 约束，对 HTTPS 反代同时核验真实 peer、精确 Origin/Host、Fetch Metadata、owner proof 与独立 CSRF。宿主策略抛错或返回畸形结果时安全拒绝，不让异常越过路由边界。

## 4. Web API

统一接口：

```text
GET  /plugins/dsh-grok-build/oauth/status
POST /plugins/dsh-grok-build/oauth/login
POST /plugins/dsh-grok-build/oauth/code
POST /plugins/dsh-grok-build/oauth/cancel
POST /plugins/dsh-grok-build/oauth/logout
POST /plugins/dsh-grok-build/oauth/models

GET  /plugins/dsh-grok-build/oauth/sources
POST /plugins/dsh-grok-build/oauth/sources/preview
POST /plugins/dsh-grok-build/oauth/sources/commit
POST /plugins/dsh-grok-build/oauth/sources/cancel

GET    /plugins/dsh-grok-build/capabilities
PATCH  /plugins/dsh-grok-build/capabilities
PUT    /plugins/dsh-grok-build/capabilities
GET    /plugins/dsh-grok-build/codex/usage
GET    /plugins/dsh-grok-build/imagine/credential-status
GET    /plugins/dsh-grok-build/imagine/images/<id>
GET    /plugins/dsh-grok-build/imagine/media/<id>
GET    /plugins/dsh-grok-build/gateway
PATCH  /plugins/dsh-grok-build/gateway
POST   /plugins/dsh-grok-build/gateway/rotate
```

写接口请求体带 `provider: grok|codex|kimi|claude`。响应只包含状态、授权 URL、device user code、模型 id 和非敏感 expiry；绝不包含 access/refresh token。JSON 请求体在解析前限制为 64 KiB。

所有 Settings 路由共用 `OwnerRequestPolicy`。`X-Forwarded-*` 只属于转发元数据，不能成为属主证明；fallback 配置缺少任一独立信号时拒绝远程请求。状态响应携带经服务端判定的 `accessMode`，客户端不根据 hostname 猜测 SSH 或反代环境。

`/oauth/sources` 是只读发现。预览/提交是显式单向拉取（票据一次性、五分钟、最多 32 张）。能力写入位于 `coding-subscription-oauth` 设置区，是无密钥的 compare-and-swap 快照并立即生效。七项开关默认关闭；`searchResults` 为 1–20（默认 5），`imageCount` 为 1–4（默认 1），`videoArtifactTtlMs` 为 1 小时–7 天（默认 7 天；界面显示 1–168 小时）；降低时立即改写/清理已有 expiry，提高只影响新产物。Imagine 下载路由是同源 loopback GET，从不返回上游签名 URL。

旧 `/plugins/dsh-grok-build/auth/*` 继续注册并复用同一个 Grok 控制器。

## 5. Antigravity

本项目不复制 Google Antigravity 私有协议。profile 单独安装 `dsh-agy@0.1.2`，提供 `agy` route。由于该版本的 `/agy` dashboard 含无自身认证的 export API，trusted-host 部署应在 profile 最终 `cordis.patch.yml` 中禁用 `dsh-agy-web`（见 `INSTALL.md`），只保留 host adapter 和 CLI。profile 使用带 lockfile hash 的 pnpm patch：无 Google session 时 `listModels()` 返回空，认证后 provider group 名为 `Google Antigravity (OAuth)`。

## 6. 兼容性

正式包名与仓库名是 **`dsh-coding-subscription-oauth`**。旧 GitHub 地址仍指向同一条 `main`，因此旧的 `dsh plugin add github:lninghaha/dsh-grok-build` 仍会安装更名后的包。第一次公开 npm / GitHub Release 是 **`0.4.1`**。当前版本是 **`0.6.1`**（`dsh plugin --profile web add dsh-coding-subscription-oauth@0.6.1`）。GitHub 与本地 tarball 安装仍然有效。

以下标识保持稳定（无迁移方案前不要改名）：

- Cordis id：`llm-grok-build-oauth`
- 设置页 HTTP API：`/plugins/dsh-grok-build/oauth/*`、`/plugins/dsh-grok-build/capabilities`、`/plugins/dsh-grok-build/codex/usage`、`/plugins/dsh-grok-build/imagine/*`，以及旧的 `/plugins/dsh-grok-build/auth/*`
- 凭据文件：`$DSH_HOME/.grok-build-auth.json` 及其他 `*-oauth-auth.json`
- Imagine 凭据：DSH 凭据引用 `XAI_API_KEY`（不用 Grok OAuth，不回退进程环境变量）
- CLI：`dsh-coding-oauth`（主命令）与 `dsh-grok-build`（别名）
- LLM 路由：`grok-build`、`codex-oauth`、`kimi-code-oauth`、`claude-code-oauth`；可选 `codex-oauth-fast`（v0.4.0，仅在最新 live catalog 列出 `priority` 后发布）

新 route 使用 `*-oauth` alias，不占用 `openai`、`xai`、`kimi-coding`。v0.3.0 将 `grok-build` fallback/default 更新为 `grok-4.6`，已有用户默认设置仍优先。

Hub 与本独立 participant 精确依赖同一个 `dsh-coding-oauth-core@0.1.0`。核心统一管理 root-scoped owner 选举、引用计数代理策略、原子注册、provider/route/credential 标识、能力设置命名空间、Gateway 状态文件名，以及全部新旧管理路径。Hub 安装时优先成为 owner；Hub 卸载后本插件从 standby 自动接管，不改路由名，也不重置凭据。

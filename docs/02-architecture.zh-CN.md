# 02 · 架构设计

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
  ├─ GrokBuildWebAuth ── Grok custom PKCE/device/import
  │                      └─ .grok-build-auth.json
  │
  └─ SubscriptionWebAuth ── pi-ai OAuth login/refresh
            ├─ Codex  ── .codex-oauth-auth.json
            ├─ Kimi   ── .kimi-code-oauth-auth.json
            └─ Claude ── .claude-code-oauth-auth.json

OAuthProviderSession.resolveAccessToken()
  └─ Models.getAuth(native id)        # refresh-under-lock
       └─ OAuthCredentialFileStore    # 0600 + atomic write + cross-process lock

ctx.llm route
  └─ AliasLlmAdapter
       └─ PiAiAdapter
            └─ native pi-ai Provider.streamSimple()
```

## 3. 模块职责

- `store.ts`：一个文件只拥有一个 provider credential；保留旧 Grok store API。
- `oauth-providers.ts`：Codex/Kimi/Claude 定义、route metadata、请求 token bridge。
- `oauth-session.ts`：登录、刷新、静态模型目录和模型选择缓存。
- `alias-adapter.ts`：转换 Harness route、不修改 pi-ai model.provider，并在 `listModels()` 前执行 credential gate；未认证或凭据读取失败返回空目录，provider group 名使用 `(OAuth)`。
- `adapter.ts`：组合 Grok 与三个 subscription profile。
- `auth-routes.ts`：旧 Grok API + 新统一 `/plugins/dsh-grok-build/oauth/*`。
- `client/`：设置页四个原生账号卡片和外部 Antigravity 状态卡片。
- `proxy.ts`：process-wide undici dispatcher，但只代理审核过的域名白名单。

## 4. Web API

统一接口：

```text
GET  /plugins/dsh-grok-build/oauth/status
POST /plugins/dsh-grok-build/oauth/login
POST /plugins/dsh-grok-build/oauth/code
POST /plugins/dsh-grok-build/oauth/cancel
POST /plugins/dsh-grok-build/oauth/logout
POST /plugins/dsh-grok-build/oauth/models
```

写接口请求体带 `provider: grok|codex|kimi|claude`。响应只包含状态、授权 URL、device user code、模型 id 和非敏感 expiry；绝不包含 access/refresh token。

旧 `/plugins/dsh-grok-build/auth/*` 继续注册并复用同一个 Grok 控制器。

## 5. Antigravity

本项目不复制 Google Antigravity 私有协议。profile 单独安装 `dsh-agy@0.1.2`，提供 `agy` route。由于该版本的 `/agy` dashboard 含无自身认证的 export API，当前部署默认禁用 `dsh-agy-web`，只保留 host adapter 和 CLI。profile 使用带 lockfile hash 的 pnpm patch：无 Google session 时 `listModels()` 返回空，认证后 provider group 名为 `Google Antigravity (OAuth)`。

## 6. 兼容性

- 包名仍是 `dsh-grok-build`。
- Cordis id 仍是 `llm-grok-build-oauth`。
- `$DSH_HOME/.grok-build-auth.json` 格式不迁移。
- `grok-build` fallback model 不改。
- 新 route 使用 `*-oauth` alias，不占用 `openai`、`xai`、`kimi-coding`。

# 安装与使用 · dsh-coding-subscription-oauth

本仓库原名 **`dsh-grok-build`**。新安装请用：

```bash
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth
```

CLI 新命令是 `dsh-coding-oauth`（旧命令 `dsh-grok-build` 仍可用）。为兼容已有 profile，Cordis id 仍是 `llm-grok-build-oauth`，设置页 HTTP 路径仍是 `/plugins/dsh-grok-build/*`，凭据文件名不变。

当前新旧 npm 名称均尚未发布。第一次公开发布目标是 maintainer 批准后的 **`0.4.1`**。在此之前请用 GitHub 或本地目录；发布后：

```bash
dsh plugin --profile web add dsh-coding-subscription-oauth@0.4.1
dsh plugin --profile web update dsh-coding-subscription-oauth
```

旧 GitHub 地址会解析到同一条 `main`。

## 前置条件

- DeepSeek Harness 0.1.0-rc.6+
- Node.js 22.19+
- 需要使用的个人编码订阅；没有 Claude/Google 账号也可以先安装路由
- 部分网络需要 HTTP/HTTPS 代理

## 安装

```bash
# 从 GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth

# 或本地开发目录
dsh plugin --profile web add ./dsh-coding-subscription-oauth

# Google Antigravity 可选依赖，固定版本
dsh plugin --profile web add dsh-agy@0.1.2
```

安装后重启现有 dsh web 进程；不要另起一个端口相同的服务器。

## Antigravity 安全配置

`dsh-agy@0.1.2` 的 `/agy` standalone dashboard 没有自己的认证，并包含凭据导出接口。Web 服务带 trusted-host 或反向代理时，建议在 profile 最终 `cordis.patch.yml` 禁用该 dashboard：

```yaml
- id: dsh-agy-web
  disabled: true
```

这不会禁用 `agy` LLM route 或 profile 内的 `dsh-agy` CLI。

Google OAuth 后续可用：

```bash
NODE_USE_ENV_PROXY=1 \
HTTPS_PROXY=http://127.0.0.1:7890 \
dsh plugin --profile web exec dsh-agy login --headless
```

仅在当前网络确实需要代理时设置 `NODE_USE_ENV_PROXY` / `HTTPS_PROXY`；其他环境直接执行最后一行即可。不要把 Google credential export 粘贴到聊天或日志。

## 代理配置

推荐在 profile 的最终 patch 里配置常驻服务：

```yaml
- id: llm-grok-build-oauth
  config:
    proxy: http://127.0.0.1:7890
    proxyKimi: false
```

解析优先级：`config.proxy` → `CODING_OAUTH_PROXY` → `GROK_BUILD_PROXY` → `HTTPS_PROXY` / `HTTP_PROXY`。

默认进入代理的域名组：

- xAI/Grok Build
- OpenAI Codex
- Claude/Anthropic
- Google OAuth/Cloud Code

Kimi Code 中国流量默认直连；只有 `proxyKimi: true` 才代理。

## 弹性重试

OAuth access token 会在本地记录过期时间前 5 分钟主动刷新。服务端若仍以 401/403 拒绝一个本地尚未过期的令牌，插件会把凭据 `expires` 回写到过去，重试的 step 先刷新再发请求。瞬时故障（429/5xx/超时/网络）和 AUTH 默认最多重试 2 次（500 ms → 10 s，10% jitter）。配额耗尽和 refresh token 失效不重试。

部署级覆盖（可选）：

```yaml
- id: llm-grok-build-oauth
  config:
    retryPolicy:
      mode: normal
      maxRetries: 2
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, AUTH]
      backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
```

## 登录

### 设置页

打开 **设置 → 编码 OAuth**：

- **Grok Build**：授权码或设备码
- **OpenAI Codex**：远程部署推荐设备码；浏览器 PKCE 支持粘贴 redirect URL
- **Kimi Code**：设备码
- **Claude Code**：浏览器 PKCE，远程访问时粘贴完整 localhost redirect URL

设置页会**只读发现**白名单内的官方 Grok / Codex / Kimi / Claude CLI OAuth 文件。同步是显式的单向**拉取**（不是自动导入）：发现 → 预览 → 冲突/指纹核对 → 确认覆盖。官方 CLI 文件从不被写入。读取会拒绝符号链接、非普通文件、非属主文件、组/其他人可读，以及超大文档（`O_NOFOLLOW`）。预览票据一次性、五分钟过期、最多 32 张。CLI 的 `dsh-coding-oauth import` 仍只支持 Grok。

登录过程只交换授权 code；状态接口不返回 access/refresh token。

### 可选能力

设置页的七项订阅能力开关默认全部关闭，打开后立即生效（无需重启）：`codexSearch`、`codexImages`、`codexImageEdits`、`codexUsage`、`codexFast`、`grokImagineImage`、`grokImagineVideo`。

数值控制为 `searchResults`（1–20，默认 5）、`imageCount`（1–4，默认 1）、`videoArtifactTtlMs`（1 小时–7 天，默认 7 天；界面以 1–168 小时显示）。降低视频保留时间会立即缩短并清理已有产物；提高只影响之后生成的产物。管理员可在插件配置的 `capabilities` 下提供不含秘密的 composition 默认值；`coding-subscription-oauth` 设置区中的用户值会覆盖该 base，省略时所有开关仍默认关闭。

`codex-oauth-fast` 仅在最新一次 live catalog 标明至少有一个 `priority` 可用模型后才会出现。请求发送 `service_tier: priority` 和路由提示；界面写 **已请求 Fast**，不保证延迟或上游兑现。Codex 搜索/用量/图像是需打开的私有 `chatgpt.com/backend-api` 端点；图像固定 `gpt-image-2`；编辑只接受当前会话顶层、本会话持有的附件。

Grok Imagine 只走官方 `https://api.x.ai`（`grok-imagine-image-2.0` / `grok-imagine-video-1.5`），凭据是独立的 DSH 引用 `XAI_API_KEY`——不用 Grok OAuth，也不回退进程环境变量。下载受 MIME / 大小 / 超时 / 重定向 / DNS 控制，冻结主机为 `imgen.x.ai`、`videogen.x.ai`、`vidgen.x.ai`；私有产物库的单件与唯一对象总量均硬限 256 MiB、最长七天；只通过同源 loopback 路由提供。

### CLI

```bash
# Grok（`dsh-grok-build` 仍是同一条命令的别名）
dsh-coding-oauth login
dsh-coding-oauth login --pkce
dsh-coding-oauth import

# Codex / Kimi / Claude
dsh-coding-oauth login codex --device-auth
dsh-coding-oauth login codex --browser
dsh-coding-oauth login kimi
dsh-coding-oauth login claude

# 状态/登出
dsh-coding-oauth status all
dsh-coding-oauth logout kimi
```

## 模型路由

- `grok-build/<model>`
- `codex-oauth/<model>`
- `codex-oauth-fast/<model>`（可选；仅在最新 live catalog 标明 `priority` 可用后出现，界面为 已请求 Fast）
- `kimi-code-oauth/<model>`
- `claude-code-oauth/<model>`
- `agy/<model>`（安装 dsh-agy 后）

这些别名专门避免与已有的 `xai`、`openai`、`kimi-coding` API-key routes 冲突。插件不会修改现有默认模型设置。未认证的 OAuth route 不向模型选择器返回任何模型；认证后供应商名显示为 `(OAuth)`，登录/登出会立即触发目录刷新。

## 凭据与缓存

OAuth 凭据：

```text
$DSH_HOME/.grok-build-auth.json
$DSH_HOME/.codex-oauth-auth.json
$DSH_HOME/.kimi-code-oauth-auth.json
$DSH_HOME/.claude-code-oauth-auth.json
```

均为 `0600`、原子写、文件锁保护。模型缓存为对应的 `*-models.json`，不含 token。Grok Imagine 使用 DSH 凭据引用 `XAI_API_KEY`，与上述 OAuth 文件分离；视频产物存入 `$DSH_HOME/.dsh-coding-subscription-oauth-media/`（目录 `0700`、文件 `0600`），按保留设置自动清理。

## 卸载

```bash
dsh plugin --profile web remove dsh-agy dsh-coding-subscription-oauth
rm -f ~/.dsh/.grok-build-auth.json ~/.dsh/.codex-oauth-auth.json \
  ~/.dsh/.kimi-code-oauth-auth.json ~/.dsh/.claude-code-oauth-auth.json
rm -f ~/.dsh/.grok-build-models.json ~/.dsh/.codex-oauth-models.json \
  ~/.dsh/.kimi-code-oauth-models.json ~/.dsh/.claude-code-oauth-models.json
```

只有在确认不再需要账号后才删除凭据文件。

## 部署验收

```bash
pnpm run verify:deployed

DSH_RESTORE_PROVIDER=openai \
DSH_RESTORE_MODEL=gpt-5.6-sol \
DSH_RESTORE_REASONING=max \
pnpm run smoke:deployed
```

第一条命令验证真实模型目录的认证门禁和 `(OAuth)` 标签。第二条会通过运行中的 DSH 分别执行 Codex/Kimi 的 tool-call 与第二个用户 turn（覆盖 `INVALID_REPLAY_STATE` 回归），随后恢复显式指定的默认模型并归档测试会话；为避免覆盖现有默认设置，不提供 `DSH_RESTORE_*` 时脚本拒绝运行。

## 故障排查

| 现象 | 处理 |
|---|---|
| 还在搜 / 装着 `dsh-grok-build` | 仓库已更名为 `dsh-coding-subscription-oauth`；旧 GitHub 地址仍跟踪同一条 `main`。新安装请用新名 |
| Codex localhost callback 打不开 | 改用设备码，或把完整 redirect URL 粘贴回设置页 |
| Claude localhost callback 在远端浏览器 | 把完整 redirect URL 粘贴回设置页 |
| Kimi 401/403 | 重新登录并确认 Kimi Code 会员有效；不要改成 moonshot.cn OAuth |
| OAuth refresh failed | 对应账号重新登录；插件不会回退到其他账号或 API key |
| 模型 route 重复 | 保留本插件的 `*-oauth` alias，移除冲突的第三方 OAuth 插件 |
| Antigravity 页面 404 | 安全配置默认禁用了 `dsh-agy-web`；使用 CLI |
| Google/Claude/OpenAI 网络不可达 | 检查插件 scoped proxy；不要重启或修改系统网络服务 |

## 合规提示

订阅 OAuth 接入第三方 harness 可能违反或触及供应商服务条款。仅供个人账号使用，自行承担配额和账号风险；商用请使用官方 API-key 通道。

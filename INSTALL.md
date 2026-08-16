# 安装与使用 · dsh-grok-build

## 前置条件

- DeepSeek Harness 0.1.0-rc.6+
- Node.js 22.19+
- 需要使用的个人编码订阅；没有 Claude/Google 账号也可以先安装路由
- 部分网络需要 HTTP/HTTPS 代理

## 安装

```bash
# 从 GitHub
dsh plugin --profile web add github:lninghaha/dsh-grok-build

# 或本地开发目录
dsh plugin --profile web add ./dsh-grok-build

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
pnpm --dir ~/.dsh/profiles/web exec dsh-agy login --headless
```

不要把 Google credential export 粘贴到聊天或日志。

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

## 登录

### 设置页

打开 **设置 → 编码 OAuth**：

- **Grok Build**：授权码或设备码；也可 import 官方 Grok CLI
- **OpenAI Codex**：远程部署推荐设备码；浏览器 PKCE 支持粘贴 redirect URL
- **Kimi Code**：设备码
- **Claude Code**：浏览器 PKCE，远程访问时粘贴完整 localhost redirect URL

登录过程只交换授权 code；状态接口不返回 access/refresh token。

### CLI

```bash
# Grok（兼容旧命令）
dsh-grok-build login
dsh-grok-build login --pkce
dsh-grok-build import

# Codex / Kimi / Claude
dsh-grok-build login codex --device-auth
dsh-grok-build login codex --browser
dsh-grok-build login kimi
dsh-grok-build login claude

# 状态/登出
dsh-grok-build status all
dsh-grok-build logout kimi
```

## 模型路由

- `grok-build/<model>`
- `codex-oauth/<model>`
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

均为 `0600`、原子写、文件锁保护。模型缓存为对应的 `*-models.json`，不含 token。

## 卸载

```bash
dsh plugin --profile web remove dsh-agy dsh-grok-build
rm -f ~/.dsh/.grok-build-auth.json ~/.dsh/.codex-oauth-auth.json \
  ~/.dsh/.kimi-code-oauth-auth.json ~/.dsh/.claude-code-oauth-auth.json
rm -f ~/.dsh/.grok-build-models.json ~/.dsh/.codex-oauth-models.json \
  ~/.dsh/.kimi-code-oauth-models.json ~/.dsh/.claude-code-oauth-models.json
```

只有在确认不再需要账号后才删除凭据文件。

## 部署验收

```bash
npm run verify:deployed

DSH_RESTORE_PROVIDER=openai \
DSH_RESTORE_MODEL=gpt-5.6-sol \
DSH_RESTORE_REASONING=max \
npm run smoke:deployed
```

第一条命令验证真实模型目录的认证门禁和 `(OAuth)` 标签。第二条会通过运行中的 DSH 分别执行 Codex/Kimi 的 tool-call 与第二个用户 turn（覆盖 `INVALID_REPLAY_STATE` 回归），随后恢复显式指定的默认模型并归档测试会话；为避免覆盖现有默认设置，不提供 `DSH_RESTORE_*` 时脚本拒绝运行。

## 故障排查

| 现象 | 处理 |
|---|---|
| Codex localhost callback 打不开 | 改用设备码，或把完整 redirect URL 粘贴回设置页 |
| Claude localhost callback 在远端浏览器 | 把完整 redirect URL 粘贴回设置页 |
| Kimi 401/403 | 重新登录并确认 Kimi Code 会员有效；不要改成 moonshot.cn OAuth |
| OAuth refresh failed | 对应账号重新登录；插件不会回退到其他账号或 API key |
| 模型 route 重复 | 保留本插件的 `*-oauth` alias，移除冲突的第三方 OAuth 插件 |
| Antigravity 页面 404 | 安全配置默认禁用了 `dsh-agy-web`；使用 CLI |
| Google/Claude/OpenAI 网络不可达 | 检查插件 scoped proxy；不要重启或修改系统网络服务 |

## 合规提示

订阅 OAuth 接入第三方 harness 可能违反或触及供应商服务条款。仅供个人账号使用，自行承担配额和账号风险；商用请使用官方 API-key 通道。

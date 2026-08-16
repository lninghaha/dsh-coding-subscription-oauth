# 安装与使用 · dsh-grok-build

> xAI Grok Build（`cli-chat-proxy.grok.com`）的 dsh OAuth 模型供应商插件。
> 使用 SuperGrok / X Premium 订阅登录，无需 `XAI_API_KEY`。

## 前置条件

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）0.1.0-rc.6+
- SuperGrok 或 X Premium 订阅（部分档位可能被 xAI 限制 Grok Build 推理权限，见文末）
- **网络**：`auth.x.ai` 与 `cli-chat-proxy.grok.com` 在部分网络不可直连，需要一个 HTTP 代理

## 安装

```bash
# 从 GitHub 安装
dsh plugin --profile web add github:lninghaha/dsh-grok-build

# 或本地目录（开发）
dsh plugin --profile web add ./dsh-grok-build
```

安装后重启 `dsh web`。

## 代理配置（需要时）

三选一，优先级从高到低：

1. 插件配置（写入 profile 的 `cordis.patch.yml`，推荐常驻进程使用）：

   ```yaml
   - id: llm-grok-build-oauth
     config:
       proxy: http://127.0.0.1:7890
   ```

2. `GROK_BUILD_PROXY` 环境变量
3. 标准 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量

插件只会把 `auth.x.ai`、`cli-chat-proxy.grok.com` 两个域名的流量送进代理，其余流量保持直连。

## 登录（三种方式）

### 1. 设置面板（推荐）

`设置 → Grok Build → 使用订阅登录`：

- 自动打开 xAI 授权页；授权后浏览器跳回 `http://127.0.0.1:<port>/callback?code=…`
- 与 dsh 同机浏览时自动完成；远程访问时把地址栏完整链接粘贴到面板输入框
- 也可切换「设备码登录」：记下 user_code，在任意设备的浏览器打开验证地址授权

### 2. CLI

```bash
dsh-grok-build login            # 设备码流程
dsh-grok-build login --pkce     # 授权码 + PKCE（loopback 捕获 + 粘贴 code 双通道）
dsh-grok-build status           # 非敏感状态与可见模型
dsh-grok-build logout           # 退出（只删本插件凭据）
```

### 3. 从官方 Grok CLI 导入

```bash
dsh-grok-build import
```

只读拷贝 `~/.grok/auth.json`，不修改原文件。**注意**：refresh token 一次性轮换——本插件首次刷新后，官方 CLI 里的旧 token 失效，官方 CLI 需重新 `grok login`。

## 使用

登录成功后，在会话模型选择器中选择 `grok-build/grok-4.5`（或目录里的其他模型）。可见模型在 设置 → Grok Build 中勾选。

## 凭据与安全

- 凭据文件：`$DSH_HOME/.grok-build-auth.json`（owner-only `0600`，原子写，跨进程文件锁）
- 模型目录缓存：`$DSH_HOME/.grok-build-models.json`（不含凭据）
- 任何 HTTP 路由 / 日志 / UI 均不输出 token；状态接口只返回 `authenticated` / `expiresAt`

## 卸载

```bash
dsh plugin --profile web remove dsh-grok-build
rm -f ~/.dsh/.grok-build-auth.json ~/.dsh/.grok-build-models.json
```

## 故障排查

| 现象 | 含义与处理 |
|---|---|
| 401 | token 失效——重新登录 |
| 403 | 风控/权益问题：确认当前订阅档位含 Grok Build 推理权限；对比官方 CLI 是否同样被 403 |
| 模型列表为空 / `unreachable` | 网络不可直连——按上文配置代理 |
| 登录后官方 CLI 掉线 | refresh token 轮换的预期行为，官方 CLI 重新 `grok login` |

## 合规提示

以第三方客户端使用 xAI 订阅额度属服务条款灰色地带，**仅供个人学习研究**，自行承担账号风险；商用请使用 `XAI_API_KEY` 官方通道。

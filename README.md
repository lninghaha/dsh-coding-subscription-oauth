# dsh-grok-build

> xAI **Grok Build**（Grok CLI 编码订阅后端 `cli-chat-proxy.grok.com`）的 OAuth 模型供应商插件，目标平台：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。

用 SuperGrok / X Premium 订阅的 OAuth 登录，把 Grok Build 编码模型（grok-4.5 等）注册为 dsh 的 LLM 路由，**不需要 `XAI_API_KEY`**。

## 现状

✅ **M1 最小链路已实机验证**（2026-08-16）：device 登录 → `/v1/models-v2` 动态目录（实测返回 `grok-4.6`、`grok-4.5`）→ Responses 流式推理全通（独立冒烟 `node scripts/smoke-infer.mjs`，两个模型均返回正常）。

✅ **M3 设置面板代码完成**：**设置 → Grok Build** 原生分区（settings.section）——订阅登录（PKCE 授权码 + 粘贴 code 双通道）、设备码备用、Grok CLI 导入、模型勾选、注销。宿主路由 `/plugins/dsh-grok-build/auth/*`（同源 + loopback 校验，token 不出现在任何响应里）。

🚧 进行中：PKCE 实机验证（`login --pkce`）后设为默认；M4 测试与发布。

> 详细调研、架构设计、建设计划与风险评估文档在本地维护，未随本仓库公开；有需要可提 issue 联系。

## 安装

```bash
dsh plugin --profile web add github:lninghaha/dsh-grok-build   # 或本地路径 ./dsh-grok-build
```

安装后重启 `dsh web`。git 安装路径已在干净环境实测：宿主路由、设置面板入口（boot graph）、可选 peer 解析全部通过。详见 [INSTALL.md](INSTALL.md)。

## 使用

```bash
# 登录（device code；会打印验证地址与一次性代码，浏览器授权即可）
dsh-grok-build login

# PKCE 授权码流（实验性：loopback 自动捕获 + 粘贴 code 双通道）
dsh-grok-build login --pkce

# 或者从官方 Grok CLI 导入已有凭据（只读拷贝，不修改 ~/.grok/auth.json）
dsh-grok-build import

dsh-grok-build status    # 非敏感状态 + 可见模型
dsh-grok-build logout    # 只删本插件凭据，不动官方 CLI
```

登录后在 dsh 会话模型选择器里选 `grok-build/grok-4.5` 即可对话。

## 网络前提

`auth.x.ai` 与 `cli-chat-proxy.grok.com` 在部分网络不可直连。代理配置（三选一，优先级从高到低）：

1. 插件配置（写进 dsh profile 的 `cordis.patch.yml`，适合 dsh web 常驻进程）：
   ```yaml
   - id: llm-grok-build-oauth
     config:
       proxy: http://127.0.0.1:7890
   ```
2. `GROK_BUILD_PROXY` 环境变量
3. 标准 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量

插件只会把 Grok Build / xAI 认证这两个域名的流量送进代理，dsh 的其余流量（DeepSeek API 等）保持直连。

## 注意事项

- 凭据存于 `$DSH_HOME/.grok-build-auth.json`（owner-only `0600` 原子写，跨进程文件锁）
- refresh token 一次性轮换：从官方 CLI 导入后，本插件首次刷新会使官方 CLI 里的旧 token 失效，官方 CLI 需重新 `grok login`
- 与 [dsh-xai](https://github.com/MirDie/dsh-xai)（`api.x.ai` 路线）路由名不同，可共存

## 一句话技术方案

参照 [MirDie/dsh-xai](https://github.com/MirDie/dsh-xai)（Apache-2.0，api.x.ai 路线的同类插件）的插件解剖（约 70% 可复用），用 pi-ai 的 `createProvider()` 手工构建指向 `https://cli-chat-proxy.grok.com/v1` 的 Responses API provider（带 grok CLI 指纹头 + `/v1/models-v2` 动态目录），OAuth 走 `auth.x.ai` 的 **PKCE 授权码流（主）+ device-code（备）+ `~/.grok/auth.json` 导入（辅）**，通过 dsh 公开的 `PiAiAdapter` 扩展点注册 `grok-build` 路由。不需要 fork dsh。

## 合规提示

本项目以第三方客户端使用 xAI 订阅额度，属服务条款灰色地带，仅供个人学习研究使用。

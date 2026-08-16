# dsh-grok-build

> xAI **Grok Build**（Grok CLI 编码订阅后端 `cli-chat-proxy.grok.com`）的 OAuth 模型供应商插件，目标平台：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。

用 SuperGrok / X Premium 订阅的 OAuth 登录，把 Grok Build 编码模型（grok-4.5 等）注册为 dsh 的 LLM 路由，**不需要 `XAI_API_KEY`**。

## 现状

📋 **规划阶段** —— 可行性调研已完成，结论：**可行**。尚未开始编码。

> 详细调研、架构设计、建设计划与风险评估文档在本地维护，未随本仓库公开；有需要可提 issue 联系。

## 一句话技术方案

参照 [MirDie/dsh-xai](https://github.com/MirDie/dsh-xai)（Apache-2.0，api.x.ai 路线的同类插件）的插件解剖（约 70% 可复用），用 pi-ai 的 `createProvider()` 手工构建指向 `https://cli-chat-proxy.grok.com/v1` 的 Responses API provider（带 grok CLI 指纹头 + `/v1/models-v2` 动态目录），OAuth 走 `auth.x.ai` 的 **PKCE 授权码流（主）+ device-code（备）+ `~/.grok/auth.json` 导入（辅）**，通过 dsh 公开的 `PiAiAdapter` 扩展点注册 `grok-build` 路由。不需要 fork dsh。

## 合规提示

本项目以第三方客户端使用 xAI 订阅额度，属服务条款灰色地带，仅供个人学习研究使用。

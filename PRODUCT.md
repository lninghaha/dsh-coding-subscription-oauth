# Product

## Register

product

## Users

希望在 DeepSeek Harness 中使用自己已订阅的编码服务，并管理 OAuth 登录、模型、可选 Gateway 与能力开关的开发者。用户既可能单独安装本插件，也可能与统一用量中心同时安装。

## Product Purpose

提供独立、可审计、默认关闭高风险能力的编码订阅 OAuth 管理。成功意味着用户能理解每个 Provider 的状态与下一步操作，安全地预览和导入本地 CLI 凭据，并获得真实可执行的 Gateway 配置；共装时不产生重复路由或适配器。

## Brand Personality

可信、直接、克制。以 DSH 原生设置体验为基准，让安全边界清晰但不过度恐吓用户。

## Anti-references

避免把 Provider 堆成同质卡片墙、在页面远端显示操作结果、模型每次勾选立即写入、使用遮罩密钥生成不可执行命令，以及通过放宽来源校验换取远程可用性。

## Design Principles

1. 每个 Provider 先给出摘要和明确下一步，再展开高级细节。
2. 导入遵循预览、冲突说明、显式覆盖、原子提交。
3. Provider 模型选择先形成本地草稿，再由用户一次应用；能力开关保持逐项反馈，并明确依赖与修复入口。
4. 远程 Settings 必须证明 owner 上下文，配置不完整时关闭而非猜测。
5. 单装功能完整，共装界面收敛且运行时只有一个所有者。

## Accessibility & Inclusion

所有表单、disclosure、进度、确认和错误状态具备可访问名称、焦点恢复与状态播报；支持键盘、窄屏、缩放、色觉差异和 reduced-motion。

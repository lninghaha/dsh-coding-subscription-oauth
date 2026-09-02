# 项目协作规则

> 本文件是本仓库 Agent 的项目规则。开始工作前必须阅读；与一般习惯冲突时，以本文件中更严格的隐私、隔离和数据保护要求为准。

## 1. 工作区与 Git 边界

- 开始和结束时检查 `git status`，识别并保留用户已有修改。
- 禁止使用 `git reset --hard`、`git clean -fdx`、强制推送等破坏性命令。
- 未经用户明确要求，不得执行 `npm publish`、`npm login`，也不得代写含真实 token 的 `~/.npmrc`。
- 修改范围必须与当前任务直接相关。不要借机大改 Docker/CI 仅为“恢复强制 sandbox”。

## 2. 开源发布与隐私边界

- Git、npm 包、公开文档、issue、PR、截图和日志中不得出现凭据、真实账户、未脱敏 session、私有主机名、内网 IP、个人绝对路径或生产数据。
- 示例统一使用 `example.com`、`provider-a`、`YOUR_API_KEY`、`${DSH_HOME}` 等公开占位符。
- 私人调查放在 `docs/local/`（git 忽略）；不得用 `git add -f` 绕过边界。
- 只支持操作者拥有或获授权使用的账户与 endpoint。

## 3. 云环境验证（主路径）

本项目**不再要求** Docker sandbox 作为交付/发版前置验证。Agent 与贡献者在 **Cursor Cloud / 本仓库云开发环境** 内直接安装依赖、跑门禁，并安装 DeepSeek Harness（DSH）做插件冒烟验证。Docker 目标仍可供 CI 或偏好容器复现的贡献者使用。

### 3.1 允许在云环境执行

- `node` / `npm` / `npx` / `pnpm`（版本对齐 `package.json` / `packageManager` / `.nvmrc`）。
  - **必须**使用 Node `^22.19.0 || >=24`。云环境若 PATH 上先出现 `/exec-daemon/node`（常为 22.14），请先 `nvm use`。
  - 门禁脚本会先跑 `pnpm run assert:node`。
- `tsc` / `vitest` / `biome`、`scripts/*.mjs`、`build/*.mjs`、`npm pack --dry-run`。
- 安装 `@deepseek-ai/dsh`、向隔离 profile 安装本插件、启动 `dsh web` 做 UI/API 冒烟。
- 冒烟时优先 `export DSH_HOME=$HOME/.dsh-cloud`（可另用 `/tmp/dsh-verify-*`），不要写入操作者真实本机 profile。

推荐顺序：

1. `pnpm install --frozen-lockfile`
2. 快速门禁 `pnpm run check:next`
3. 交付门禁 `pnpm run check`（含重建 `lib/`）
4. 发布前 `npm pack --dry-run --json --ignore-scripts` 审阅清单（不得包含 `src/`）
5. **DSH 冒烟**：隔离 `DSH_HOME` → `dsh plugin --profile web add <本仓库路径或 tarball>` → `dsh web --no-open` → 检查 `http://127.0.0.1:3080` 与 Settings → Coding OAuth。

### 3.2 `lib/` 产物

- `src/` 是运行时唯一源；`lib/` 是提交到 Git 的生成产物，不得手改。
- 运行时变更须由 `src/` 重建 `lib/` 并审阅 diff 后提交。

## 4. 安全不变量

- 不得削弱回环 peer、回环 `Host`、同源/请求上下文、JSON 写请求和请求大小限制。
- Gateway key reveal/rotate **仅限** `accessMode === "loopback"`。
- SQLite、API、日志和导出默认不得包含凭据、prompt/response、cwd 或供应商原始响应。

## 5. DSH Web 启动与重启

- **云 Agent 隔离实例**：可以在隔离 `DSH_HOME` 下安装/启动/重启 `dsh web`。
- **操作者本机 / 共享 `dsh-web.service`**：不得擅自重启。安装后提示用户自行 `dsh-web restart`。

## 6. 发版上架（操作者只跑三条命令）

Agent **禁止**执行 `npm login` / `npm publish`。用户明确要求发版时，准备工作完成后只给出：

```bash
cd /path/to/dsh-coding-subscription-oauth
npm login --registry https://registry.npmjs.org/
pnpm run release:publish
```

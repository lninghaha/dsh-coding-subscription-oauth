# 架构迁移说明（tsdown/npm → esbuild + tsc + pnpm）

> 本文件记录把本仓库从旧 `tsdown`+npm 脚手架迁到 `dsh-usage-stats` 重构版（esbuild + tsc + pnpm）脚手架的过程、改动点、以及**重构落定后需要再同步的模板清单**。
> 在 git 中跟踪，**不**列入 `package.json` `files`，不随 npm 包发布。

## 以本仓库为准

| 项 | 值 |
|---|---|
| 规范仓库 | 当前 `dsh-coding-subscription-oauth` checkout（保留完整 Git 历史） |
| 已提交业务基线 | `fbbcf31`（rename + OAuth harden）· `302eee9`（rename docs） |
| 包名 / 客户端 `__ModuleLoader__` id | `dsh-coding-subscription-oauth` |
| Cordis 插件 id | `llm-grok-build-oauth`（未改） |
| HTTP / 凭据 / CLI 别名 | `/plugins/dsh-grok-build/*`、`$DSH_HOME/.grok-build-auth.json` 等、`dsh-grok-build` CLI 别名（未改） |
| 测试基线 | vitest **90**（14 个 spec 文件） |
| 归档参考 | 早期脚手架试验仅作历史参考，**不再吸收、不再作为规范源** |

早期迁移交接稿里的过时说法不要再沿用：它写的是 63 个测试、客户端 wrapper id `dsh-grok-build`、以及「旧仓库还有未提交业务需要再吸收」。规范仓的业务已落在 Git 历史中，脚手架以当前 checkout 为准。

## 验收命令（Docker sandbox 内）

共享开发主机只负责启动隔离构建；不要直接在宿主机运行安装、检查或构建命令，也不要 bind mount 源码、凭据、Docker socket 或其他项目目录。使用仓库跟踪的多阶段 Dockerfile：

```bash
docker build --target check --build-arg NODE_VERSION=22.19.0 \
  --resource memory=3g --resource cpu-quota=200000 \
  --tag test-dsh-coding-oauth:check .
docker build --target verify --build-arg NODE_VERSION=22.19.0 \
  --resource memory=3g --resource cpu-quota=200000 \
  --tag test-dsh-coding-oauth:verify .
```

依赖下载只发生在 `dependencies` stage；后续 lint、typecheck、测试、构建、打包和隔离安装都使用 `RUN --network=none`。

## 从模板（dsh-usage-stats）复制/改编的文件 —— 重构落定后需 diff 再同步

| 本仓库文件 | 模板来源 | 改编点 |
|---|---|---|
| `tsconfig.base.json` | `tsconfig.base.json` | 原样复制 |
| `tsconfig.json` | `tsconfig.json` | 原样（project references） |
| `tsconfig.host.json` | `tsconfig.host.json` | include 改 `src/**`+`tests/**`、排除 `src/client`；加 `allowImportingTsExtensions`+`rewriteRelativeImportExtensions` |
| `tsconfig.client.json` | `tsconfig.client.json` | include 仅 `src/client`；`moduleResolution: Bundler`；types 去掉未装的 `react-dom`/`vitest/globals` |
| `tsconfig.build.json` | `tsconfig.build.json` | 排除 `src/client`、`bin.ts`、`invariant.ts`；加两个 ts 扩展名开关 |
| `tsconfig.dts-bin.json` | （新增，模板无） | 仅为 `bin.ts`/`invariant.ts` 发 `.d.ts`（`emitDeclarationOnly`） |
| `biome.json` | `biome.json` | 关 `useLiteralKeys`/`noNonNullAssertion`/`useIterableCallbackReturn`（迁就既有代码风格） |
| `vitest.config.ts` | `vitest.config.ts` | include 改 `tests/**/*.spec.ts` |
| `build/clean.mjs` | 模板清理脚本 | 只清理 `.next/` 中间产物 |
| `build/build-server.mjs` | `build/build-server.mjs` | 大改：externals 用插件前缀匹配；加 ts 说明符插件；三入口（index/bin/invariant）；`createRequire` banner |
| `build/build-client.mjs` | `build/build-client.mjs` | 去 lightningcss 内联（无 CSS）；PLATFORM_MODULES 只留 react；wrapper id 为 `dsh-coding-subscription-oauth` |
| `build/promote-release.mjs` | `build/promote-release.mjs` | runtimeFiles 扩到 index/bin/invariant/client；拒绝空产物；验证失败时原子恢复旧 `lib/` |
| `build/verify-release.mjs` | `build/verify-release.mjs` | 断言 `package.json` `name=dsh-coding-subscription-oauth`、Cordis `name=llm-grok-build-oauth`、`inject` 含 `llm`、客户端 wrapper id、undici 内联、`@deepseek-ai/*` 外置、双 CLI、bin shebang |
| `pnpm-workspace.yaml` | `pnpm-workspace.yaml` | 去 `storeDir`；`allowBuilds` 加 `@google/genai:false`、`protobufjs:false` |
| `Dockerfile`, `.dockerignore` | 重构项目 sandbox 约定 | 无 bind mount；依赖 stage 后全部 `--network=none`；提供 check/verify/artifacts/package/isolated-install targets |

## 关键决策

1. **打包器 tsdown → esbuild + tsc**。esbuild 不支持 `neverBundle` 正则，改用 `onResolve` 插件做
   `@deepseek-ai/*`、`@earendil-works/*` 前缀外置；运行时依赖 `undici` **内联**进 bundle。
2. **保留 `.ts` 显式导入扩展名**（源码 100+ 处）。tsc 侧用 `allowImportingTsExtensions`（typecheck）+
   `rewriteRelativeImportExtensions`（声明/JS 发射）；esbuild 侧加一个把 `./x.ts` 解析回源码文件的插件。
   好处：不碰任何一行业务源码的 import。
3. **`createRequire` banner**：内联的 CommonJS 版 undici 在纯 ESM 加载器下没有全局 `require`，
   banner 注入 `const require = createRequire(import.meta.url)`。对 harness 的 CJS 插件加载器无害（其 shim 优先用已存在的 require）。
4. **bin / invariant 入口**：esbuild 出 `bin.js`（只保留一个 shebang），`.d.ts` 由 `tsconfig.dts-bin.json` 单独发，
   保持 `exports["./invariant"]` 与旧包一致。
5. **客户端 loader id**：`window.__ModuleLoader__.load({id:"dsh-coding-subscription-oauth",...})`。
   归档仓 next 里曾写成 `dsh-grok-build`，规范仓以新包名为准。

## 同期源码变更

工具链迁入本身包含 `exactOptionalPropertyTypes` / Biome 兼容调整：

- `src/oauth.ts`：可选 `signal` 改为条件展开；`referrer` 条件展开修正优先级。
- `src/catalog.ts`：可选 `signal` 条件展开；`part[0]!` 改为安全回退。
- `src/oauth-providers.ts`：新增 `withoutApiKey` 辅助，替换 `{...options, apiKey: undefined}`。
- `src/index.ts`：`config.proxyKimi` 条件传参。
- `src/grok-import.ts`：候选条目先判空再取值。
- 其余大部分改动为 Biome 格式统一（空格→tab、双引号、分号）。

为保持可审阅历史，真正的行为修复单独落在后续原子提交，而不是伪装成格式迁移：

- AUTH finish 即使携带 replay state 也会先使凭据失效；
- OAuth JSON 请求限制为 64 KiB，实时模型目录按流执行 4 MiB 上限；
- 启动缓存/目录失败被隔离，避免 unhandled rejection；
- 流式模型读取保留 abort/cancel 语义；
- 回归测试覆盖 token-like 诊断脱敏。

## 待办 / 未做

- [ ] 在既有 Harness Web profile 安装并验证；部署只能复用现有服务与 URL，不启动替代服务器。
- [x] `scripts/release.mjs` 已改成仅验证/本地打包，不再自动 bump、commit、tag、push 或 publish。
- [ ] 将来同步构建模板时，以模板的已验证工作区为参考，重点核对 build-client 的 PLATFORM_MODULES、verify/promote 断言、devDeps/engines。

## 早期迁移稿里不要再信的结论

- 「另一个 checkout 才是规范仓」——规范仓由当前 Git 历史确定。
- 「vitest 63/76」——当前基线是 **90**。
- 「client wrapper id = `dsh-grok-build`」——现为 **`dsh-coding-subscription-oauth`**。
- 「README/INSTALL 仍写 npm/tsdown」——社区文档已按 pnpm + GitHub 安装路径更新。

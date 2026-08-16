# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.19.0
FROM node:${NODE_VERSION}-bookworm-slim AS toolchain

ENV CI=1 \
    DSH_HOME=/tmp/dsh-sandbox-home \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN npm install --global pnpm@11.21.0
WORKDIR /workspace
RUN mkdir -p "${DSH_HOME}" && chown -R node:node /workspace "${DSH_HOME}"
USER node

FROM toolchain AS dependencies
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY --chown=node:node . .

FROM source AS check
RUN --network=none cp -a lib /tmp/committed-lib \
    && rm -rf lib \
    && cp -a /tmp/committed-lib lib \
    && pnpm run check

FROM source AS artifacts-build
RUN --network=none cp -a lib /tmp/committed-lib \
    && rm -rf lib \
    && cp -a /tmp/committed-lib lib \
    && pnpm run release:build \
    && mkdir -p /tmp/export \
    && cp -a lib /tmp/export/lib

FROM scratch AS artifacts
COPY --from=artifacts-build /tmp/export/ /

FROM source AS inspect
RUN --network=none pnpm run release:dry

FROM source AS package-build
RUN --network=none cp -a lib /tmp/committed-lib \
    && rm -rf lib \
    && cp -a /tmp/committed-lib lib \
    && pnpm run release:pack \
    && mkdir -p /tmp/export \
    && cp output/*.tgz /tmp/export/

FROM scratch AS package
COPY --from=package-build /tmp/export/ /

FROM source AS isolated-install
RUN --network=none cp -a lib /tmp/committed-lib \
    && rm -rf lib \
    && cp -a /tmp/committed-lib lib \
    && pnpm run release:pack \
    && mkdir -p /tmp/consumer \
    && printf '{"name":"oauth-sandbox-consumer","private":true,"type":"module"}\n' > /tmp/consumer/package.json \
    && cd /tmp/consumer \
    && pnpm add --offline --ignore-scripts --config.auto-install-peers=false /workspace/output/dsh-coding-subscription-oauth-*.tgz \
    && node -e 'const fs = require("node:fs"); const path = require("node:path"); const root = require("/workspace/package.json"); for (const name of Object.keys(root.peerDependencies)) { if (name === "@deepseek-ai/dsh-tools") continue; const source = path.join("/workspace/node_modules", name); const target = path.join("/tmp/consumer/node_modules", name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.rmSync(target, { recursive: true, force: true }); fs.symlinkSync(source, target, "dir"); }' \
    && node --input-type=module -e 'const plugin = await import("dsh-coding-subscription-oauth"); if (typeof plugin.apply !== "function") process.exit(1)' \
    && node node_modules/dsh-coding-subscription-oauth/lib/bin.js --help \
    && node --input-type=module -e 'const value = await import("dsh-coding-subscription-oauth/invariant"); if (typeof value !== "object") process.exit(1)'

FROM source AS verify
RUN --network=none cp -a lib /tmp/committed-lib \
    && rm -rf lib \
    && cp -a /tmp/committed-lib lib \
    && pnpm run check \
    && diff -ru /tmp/committed-lib lib \
    && pnpm run release:dry

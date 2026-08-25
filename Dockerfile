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

FROM toolchain AS lockfile
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile \
    && mkdir -p /tmp/export \
    && cp pnpm-lock.yaml /tmp/export/pnpm-lock.yaml

FROM scratch AS lockfile-export
COPY --from=lockfile /tmp/export/ /

FROM dependencies AS source
COPY --chown=node:node . .

FROM source AS check-next
RUN --network=none pnpm run check:next

# The Windows checkout intentionally keeps CRLF. Normalize only this throwaway
# stage so Biome validates syntax/style without broad unrelated line-ending
# changes in the working tree.
FROM source AS lint-normalized
RUN find src tests build docker scripts -type f -exec sed -i 's/\r$//' {} + \
	&& sed -i 's/\r$//' package.json pnpm-workspace.yaml Dockerfile biome.json \
    && pnpm run lint

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

# A registry-only DSH runtime shared by preview and the rc.2 compatibility
# smoke. It is deliberately outside the workspace so no sibling dependency or
# symlink can enter either profile.
FROM node:${NODE_VERSION}-bookworm-slim AS dsh-installed
ENV CI=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_LOGLEVEL=info
RUN npm config get registry \
    && npm ping --registry=https://registry.npmjs.org/ \
    && npm view @deepseek-ai/dsh@0.1.1-rc.2 version --registry=https://registry.npmjs.org/ \
    && mkdir -p /opt/dsh \
    && printf '{"name":"dsh-rc2-smoke","private":true}\n' > /opt/dsh/package.json \
    && npm install --prefix /opt/dsh --ignore-scripts --loglevel=verbose --registry=https://registry.npmjs.org/ @deepseek-ai/dsh@0.1.1-rc.2 \
    && npm install --global pnpm@11.21.0 --ignore-scripts --loglevel=info

FROM dsh-installed AS rc2-compatibility
ENV DSH_HOME=/tmp/dsh-rc2-home \
    DSH_RC2_PORT=17802
COPY --from=package-build /tmp/export/ /tmp/candidate/
COPY docker/rc2-compatibility.mjs docker/rc2-http-status.mjs /opt/dsh/
COPY docker/rc2-compatibility.test.mjs /opt/dsh/rc2-compatibility.test.mjs
RUN node --test /opt/dsh/rc2-compatibility.test.mjs \
    && node /opt/dsh/rc2-compatibility.mjs

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
    && find src tests build docker scripts -type f -exec sed -i 's/\r$//' {} + \
    && sed -i 's/\r$//' package.json pnpm-workspace.yaml Dockerfile biome.json \
    && pnpm run release:build \
    && pnpm run check \
    && node --test docker/preview-proxy.test.mjs \
    && node build/compare-lib.mjs /tmp/committed-lib lib \
    && cp -a lib /tmp/drift-proof-lib \
    && printf '\nintentional artifact drift\n' >> /tmp/drift-proof-lib/index.js \
    && ! node build/compare-lib.mjs /tmp/committed-lib /tmp/drift-proof-lib \
    && pnpm run release:dry

FROM verify AS verify-artifact-drift-negative
RUN printf '\nintentional artifact drift\n' >> lib/index.js \
    && ! node build/compare-lib.mjs /tmp/committed-lib lib

FROM node:${NODE_VERSION}-bookworm-slim AS web-preview
ENV DSH_HOME=/opt/dsh-seed
COPY --from=dsh-installed / /opt/dsh/
COPY package.json cordis.patch.yml LICENSE NOTICE /opt/dsh-plugin/
COPY lib/ /opt/dsh-plugin/lib/
COPY docker/preview-proxy.mjs docker/preview-entrypoint.mjs docker/prepare-preview-seed.mjs /opt/dsh-preview/
RUN mkdir -p /opt/dsh-seed /opt/dsh-plugin/node_modules /data/dsh /workspace /run/dsh-preview \
    && node /opt/dsh-preview/prepare-preview-seed.mjs \
    && chmod 0555 /opt/dsh-preview/*.mjs \
    && chown -R node:node /opt/dsh-seed /data/dsh /workspace /run/dsh-preview
USER node
ENV DSH_HOME=/data/dsh
WORKDIR /workspace
EXPOSE 17800
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD node -e 'const port=process.env.DSH_PREVIEW_BACKEND_PORT ?? "17802"; fetch(`http://127.0.0.1:${port}/`).then((response) => { if (!response.ok) process.exit(1); }, () => process.exit(1))'
ENTRYPOINT ["node", "/opt/dsh-preview/preview-entrypoint.mjs"]

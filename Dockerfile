ARG NODE_IMAGE=node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/domain ./src/domain
COPY scripts/check-node-version.mjs ./scripts/check-node-version.mjs
COPY scripts/container-healthcheck.mjs ./scripts/container-healthcheck.mjs
COPY package.json ./package.json
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data /run/tooku-secret \
    && chown 1000:1000 /data /run/tooku-secret \
    && chmod 0700 /data /run/tooku-secret
USER 1000:1000
ENV NODE_ENV=production \
    TOOKU_HOST=0.0.0.0 \
    TOOKU_PORT=8080 \
    TOOKU_DATA_DIR=/data \
    NAVIDROME_UPSTREAM=http://host.docker.internal:44533
VOLUME ["/data", "/run/tooku-secret"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD ["node", "scripts/container-healthcheck.mjs"]
CMD ["node", "server/index.ts"]

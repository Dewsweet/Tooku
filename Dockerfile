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
COPY package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production TOOKU_HOST=0.0.0.0 TOOKU_PORT=8080 TOOKU_DATA_DIR=/data NAVIDROME_UPSTREAM=http://host.docker.internal:44533
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]

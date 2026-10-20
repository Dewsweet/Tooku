FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/domain ./src/domain
COPY package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production TOOKU_HOST=0.0.0.0 TOOKU_PORT=8080 TOOKU_DATA_DIR=/data NAVIDROME_UPSTREAM=http://host.docker.internal:44533
VOLUME /data
EXPOSE 8080
CMD ["node", "server/index.ts"]

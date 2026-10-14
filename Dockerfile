FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.30.5-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/default.conf.template /etc/nginx/templates/default.conf.template
ENV NAVIDROME_UPSTREAM=http://host.docker.internal:44533
ENV NGINX_ENVSUBST_FILTER=^NAVIDROME_UPSTREAM$
EXPOSE 8080

# syntax=docker/dockerfile:1
# lore app+worker image. Build stage compiles the monorepo and bundles the
# server entries (workspace .ts deps are inlined — see tooling/bundle.mjs).
# Runtime keeps full node_modules AND pnpm on PATH so one-off
# `docker compose run --rm app pnpm db:migrate` / `pnpm db:apply-rls` work.
FROM node:24-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN node tooling/bundle.mjs

FROM node:24-alpine
WORKDIR /repo
RUN npm install -g pnpm
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

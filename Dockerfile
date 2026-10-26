# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

FROM ${NODE_IMAGE} AS base
ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/spec/package.json packages/spec/
COPY packages/compiler/package.json packages/compiler/
COPY apps/api/package.json apps/api/
COPY apps/site/package.json apps/site/
COPY apps/studio/package.json apps/studio/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/site ./apps/site
COPY apps/studio ./apps/studio
RUN pnpm run build && pnpm --filter @capidocs/studio build

FROM base AS production-dependencies
RUN pnpm install --frozen-lockfile --prod --filter "@capidocs/api..."

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini git openssh-client
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3090 \
    CAPIDOCS_RUNTIME_DIR=/app/apps/site \
    STUDIO_DIST_DIR=/app/apps/studio/dist
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/packages/spec/node_modules ./packages/spec/node_modules
COPY --from=production-dependencies /app/packages/compiler/node_modules ./packages/compiler/node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules

COPY --from=build /app/package.json ./
COPY --from=build /app/packages/spec/package.json ./packages/spec/
COPY --from=build /app/packages/spec/dist ./packages/spec/dist
COPY --from=build /app/packages/compiler/package.json ./packages/compiler/
COPY --from=build /app/packages/compiler/dist ./packages/compiler/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/site/package.json /app/apps/site/index.html ./apps/site/
COPY --from=build /app/apps/site/assets ./apps/site/assets
COPY --from=build /app/apps/site/logos ./apps/site/logos
COPY --from=build /app/apps/studio/dist ./apps/studio/dist

RUN find /app -name '*.map' -delete && find /app -name '*.d.ts' -path '*/dist/*' -delete

USER node
EXPOSE 3090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3090) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]

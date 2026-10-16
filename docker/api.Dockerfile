# NextCore VCMS API — production image. Build from the repository root:
#   docker build -f docker/api.Dockerfile -t nextcore-vcms-api .
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Build: all dependencies, compile shared + API ──
FROM base AS build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @vcms/shared --workspace @vcms/api --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @vcms/shared && npm run build -w @vcms/api

# ── Runtime dependencies only ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev --workspace @vcms/shared --workspace @vcms/api --no-audit --no-fund && npm cache clean --force \
  && mkdir -p apps/api/node_modules packages/shared/node_modules

# ── Runtime ──
FROM base AS runtime
ENV NODE_ENV=production PORT=4000 STORAGE_LOCAL_DIR=/data/storage
COPY --from=deps /app/node_modules ./node_modules
# npm may install a workspace's dependencies in its own folder rather than hoisting them.
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN mkdir -p /data/storage && chown -R node:node /data /app && chmod +x /usr/local/bin/api-entrypoint.sh
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "dist/main.js"]

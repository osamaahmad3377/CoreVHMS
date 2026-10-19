# NextCore VCMS web app — production image (Next.js standalone server). Build from the repository root:
#   docker build -f docker/web.Dockerfile --build-arg API_URL=http://api:4000 -t nextcore-vcms-web .
# API_URL is where the web server forwards /api requests (baked in at build time), as are BASE_DOMAIN and
# PLATFORM_SUBDOMAIN for multi-clinic hosting (they must match the API's).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @vcms/shared --workspace @vcms/web --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG API_URL=http://api:4000
ARG CLIENT_PORTAL_ENABLED=false
ARG BASE_DOMAIN=
ARG PLATFORM_SUBDOMAIN=admin
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 API_URL=$API_URL CLIENT_PORTAL_ENABLED=$CLIENT_PORTAL_ENABLED \
    BASE_DOMAIN=$BASE_DOMAIN PLATFORM_SUBDOMAIN=$PLATFORM_SUBDOMAIN
RUN npm run build -w @vcms/shared && npm run build -w @vcms/web

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

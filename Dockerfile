# syntax=docker/dockerfile:1.4

ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.8.10
ARG NEXT_PUBLIC_BUILD_HASH

# Shared Node.js toolchain used by the webapp build graph and runtime targets.
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

RUN apk add --no-cache \
    ca-certificates \
    curl \
    libc6-compat \
    libstdc++ \
    tini

ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN mkdir -p "${PNPM_HOME}"

WORKDIR /app

# Shared monorepo snapshot used before pruning individual apps.
FROM base AS turbo-source

ARG TURBO_VERSION
RUN pnpm add -g turbo@${TURBO_VERSION}

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

# Webapp build graph.
FROM turbo-source AS pruner
RUN turbo prune webapp --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS workspace
ENV SKIP_ENV_VALIDATION=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules
COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

FROM workspace AS webapp-builder
ARG NEXT_PUBLIC_BUILD_HASH
ENV NEXT_PUBLIC_BUILD_HASH=${NEXT_PUBLIC_BUILD_HASH}
RUN pnpm --filter webapp run generate-licenses || echo "{}" > apps/webapp/src/data/licenses.json
RUN --mount=type=cache,id=next-cache,target=/app/apps/webapp/.next/cache \
    pnpm --filter webapp exec next build

# Shared runtime published once and retagged for the webapp, worker, and
# migration repositories.
FROM base AS app-runtime

RUN pnpm add -g tsx
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 app

COPY --from=deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=app:nodejs /app/apps/webapp/node_modules ./apps/webapp/node_modules

COPY --from=webapp-builder --chown=app:nodejs /app/apps/webapp/.next ./apps/webapp/.next
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/public ./apps/webapp/public
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/scripts ./apps/webapp/scripts
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/drizzle ./apps/webapp/drizzle
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/drizzle.config.ts ./apps/webapp/
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/next.config.ts ./apps/webapp/
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/tsconfig.json ./apps/webapp/

COPY --from=workspace --chown=app:nodejs /app/package.json ./
COPY --from=workspace --chown=app:nodejs /app/pnpm-workspace.yaml ./

WORKDIR /app/apps/webapp

USER app

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start"]

FROM app-runtime AS webapp
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

FROM app-runtime AS migration
CMD ["node", "./scripts/migrate-with-lock.js"]

FROM app-runtime AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const Redis=require('ioredis');const r=new Redis({host:process.env.VALKEY_HOST||'localhost',port:process.env.VALKEY_PORT||6379,password:process.env.VALKEY_PASSWORD,lazyConnect:false});r.ping().then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["tsx", "src/worker.ts"]

# Marketing build graph.
FROM turbo-source AS marketing-pruner
RUN turbo prune marketing --docker

FROM base AS marketing-deps
COPY --from=marketing-pruner /app/out/json/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS marketing-workspace
ENV SKIP_ENV_VALIDATION=1
COPY --from=marketing-deps /app/node_modules ./node_modules
COPY --from=marketing-deps /app/apps/marketing/node_modules ./apps/marketing/node_modules
COPY --from=marketing-pruner /app/out/full/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

FROM marketing-workspace AS marketing-builder
RUN mkdir -p /app/apps/marketing/public
RUN --mount=type=cache,id=next-cache-marketing,target=/app/apps/marketing/.next/cache \
    pnpm --filter marketing exec next build

FROM base AS marketing-runtime-deps
COPY --from=marketing-pruner /app/out/json/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM oven/bun:1.3.11-alpine AS marketing-base

RUN apk add --no-cache curl tini

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 marketing

FROM marketing-base AS marketing

COPY --from=marketing-runtime-deps --chown=marketing:nodejs /app/node_modules ./node_modules
COPY --from=marketing-runtime-deps --chown=marketing:nodejs /app/apps/marketing/node_modules ./apps/marketing/node_modules

COPY --from=marketing-builder --chown=marketing:nodejs /app/apps/marketing/.next ./apps/marketing/.next
COPY --from=marketing-builder --chown=marketing:nodejs /app/apps/marketing/public ./apps/marketing/public
COPY --from=marketing-workspace --chown=marketing:nodejs /app/apps/marketing/next.config.ts ./apps/marketing/
COPY --from=marketing-workspace --chown=marketing:nodejs /app/apps/marketing/package.json ./apps/marketing/

COPY --from=marketing-workspace --chown=marketing:nodejs /app/package.json ./
COPY --from=marketing-workspace --chown=marketing:nodejs /app/pnpm-workspace.yaml ./

WORKDIR /app/apps/marketing

USER marketing

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "x", "next", "start", "-p", "3000"]

# One-shot database seeder.
FROM base AS db-seed

RUN pnpm add -g tsx

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules

COPY --from=workspace /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace /app/apps/webapp/tsconfig.json ./apps/webapp/

WORKDIR /app/apps/webapp

CMD ["tsx", "src/db/seed/do-seed.ts"]

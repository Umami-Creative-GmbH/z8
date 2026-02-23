# syntax=docker/dockerfile:1.4

# =============================================================================
# Z8 Multi-Stage Dockerfile
# =============================================================================
# Builds optimized containers for: webapp, migration, db-seed, worker
# Supports both Alpine (debuggable) and Distroless (secure) variants
#
# Build targets:
#   docker build --target webapp -t z8-webapp .
#   docker build --target webapp-distroless -t z8-webapp:distroless .
#   docker build --target migration -t z8-migration .
#   docker build --target db-seed -t z8-db-seed .
#   docker build --target worker -t z8-worker .
#   docker build --target worker-distroless -t z8-worker:distroless .
# =============================================================================

# Build arguments
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG ALPINE_VERSION=3.21

# =============================================================================
# Stage 1: base - Alpine runtime with Node.js and pnpm
# =============================================================================
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

# Install runtime dependencies for native modules
RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    ca-certificates \
    tini \
    curl

# Enable corepack and install pnpm
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Configure pnpm global binaries path (required for pnpm add -g)
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN mkdir -p "$PNPM_HOME"

# Set production environment
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# =============================================================================
# Stage 2: pruner - Extract webapp workspace using Turbo
# =============================================================================
FROM base AS pruner

# Install turbo globally for workspace pruning
RUN pnpm add -g turbo@2.7.5

# Copy workspace configuration files first (better caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./

# Copy all workspace packages for turbo prune
COPY apps ./apps
COPY packages ./packages

# Prune the monorepo to only webapp and its dependencies
# This creates a minimal workspace in /app/out
RUN turbo prune webapp --docker

# =============================================================================
# Stage 3: deps - Install dependencies (cached layer)
# =============================================================================
FROM base AS deps

# Copy pruned workspace manifest files
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./

# Install all dependencies (including dev for build)
# Use BuildKit cache mount for pnpm store
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# =============================================================================
# Stage 4: workspace - Prepare pruned workspace
# =============================================================================
FROM base AS workspace

# Skip strict env validation during image build.
# Runtime containers still require real environment variables.
ENV SKIP_ENV_VALIDATION=1

# Copy installed dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules

# Copy source code from pruned workspace
COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# =============================================================================
# Stage 5: webapp-builder - Build Next.js webapp
# =============================================================================
FROM workspace AS webapp-builder

# Generate license report (required by build script)
RUN pnpm --filter webapp run generate-licenses || echo "{}" > apps/webapp/src/data/licenses.json

# Build the webapp (Turbopack)
RUN --mount=type=cache,id=next-cache,target=/app/apps/webapp/.next/cache \
    pnpm --filter webapp exec next build

# =============================================================================
# Stage 6: prod-deps - Production dependencies only
# =============================================================================
FROM base AS prod-deps

# Copy pruned workspace manifest files
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./

# Install production dependencies only
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# =============================================================================
# Stage 7: webapp - Production Next.js server (Alpine)
# =============================================================================
# Note: Using standard build (not standalone) because standalone is not
# compatible with cacheComponents in Next.js 16. This results in larger
# images (~500MB vs ~300MB) but ensures full compatibility.
# =============================================================================
FROM base AS webapp

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy production dependencies
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nextjs:nodejs /app/apps/webapp/node_modules ./apps/webapp/node_modules

# Copy built application
COPY --from=webapp-builder --chown=nextjs:nodejs /app/apps/webapp/.next ./apps/webapp/.next
COPY --from=workspace --chown=nextjs:nodejs /app/apps/webapp/public ./apps/webapp/public
COPY --from=workspace --chown=nextjs:nodejs /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace --chown=nextjs:nodejs /app/apps/webapp/next.config.ts ./apps/webapp/
COPY --from=workspace --chown=nextjs:nodejs /app/apps/webapp/cache-handler.js ./apps/webapp/

# Copy workspace config for pnpm/next to work correctly
COPY --from=workspace --chown=nextjs:nodejs /app/package.json ./
COPY --from=workspace --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./

WORKDIR /app/apps/webapp

USER nextjs

EXPOSE 3000

# Health check for Kubernetes liveness/readiness probes
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start Next.js production server using next start
CMD ["pnpm", "start"]

# =============================================================================
# Note: webapp-distroless stage removed because distroless requires standalone
# output mode, which is not compatible with cacheComponents in Next.js 16.
# Use the Alpine-based webapp target instead - it's still secure (non-root user)
# and only slightly larger.
# =============================================================================

# =============================================================================
# Stage 8: migration - One-shot Drizzle migration runner
# =============================================================================
FROM base AS migration

# Copy dependencies (including drizzle-kit)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules

# Copy webapp files needed for migration execution
# Include full src to support path aliases (e.g. @/...) when drizzle reads schema files.
COPY --from=workspace /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace /app/apps/webapp/scripts ./apps/webapp/scripts
COPY --from=workspace /app/apps/webapp/drizzle ./apps/webapp/drizzle
COPY --from=workspace /app/apps/webapp/drizzle.config.ts ./apps/webapp/
COPY --from=workspace /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace /app/apps/webapp/tsconfig.json ./apps/webapp/

WORKDIR /app/apps/webapp

# Run migrations under an advisory lock
# Uses DATABASE_URL if provided, or falls back to POSTGRES_* variables.
CMD ["node", "./scripts/migrate-with-lock.js"]

# =============================================================================
# Stage 9: db-seed - One-shot database seeder
# =============================================================================
FROM base AS db-seed

# Install tsx for running TypeScript
RUN pnpm add -g tsx

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules

# Copy database code and seed scripts
COPY --from=workspace /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace /app/apps/webapp/tsconfig.json ./apps/webapp/

WORKDIR /app/apps/webapp

# Run the seeder
CMD ["tsx", "src/db/seed/do-seed.ts"]

# =============================================================================
# Stage 10: worker - BullMQ worker with repeatable cron jobs (Alpine)
# =============================================================================
FROM base AS worker

# Install tsx for running TypeScript
RUN pnpm add -g tsx

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/webapp/node_modules ./apps/webapp/node_modules

# Copy application source (worker needs access to lib modules)
COPY --from=workspace /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace /app/apps/webapp/tsconfig.json ./apps/webapp/

WORKDIR /app/apps/webapp

USER worker

# Health check - verify worker can connect to Redis/Valkey
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const Redis=require('ioredis');const r=new Redis({host:process.env.VALKEY_HOST||'localhost',port:process.env.VALKEY_PORT||6379,password:process.env.VALKEY_PASSWORD,lazyConnect:false});r.ping().then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Use tini as PID 1
ENTRYPOINT ["/sbin/tini", "--"]

# Start worker process
CMD ["tsx", "src/worker.ts"]

# =============================================================================
# Stage 11: worker-distroless - Secure worker variant
# =============================================================================
# NOTE: Distroless worker is NOT recommended because:
# 1. Worker uses tsx to run TypeScript directly
# 2. Distroless doesn't include tsx or TypeScript runtime
# 3. Would require a separate compilation step for worker code
#
# If you need a distroless worker, pre-compile worker.ts to JavaScript:
#   tsc apps/webapp/src/worker.ts --outDir apps/webapp/dist
#   Then use: CMD ["dist/worker.js"]
#
# For now, use the Alpine worker target which has full debugging capabilities.
# The Alpine image is still very small (~280MB) and runs as non-root user.

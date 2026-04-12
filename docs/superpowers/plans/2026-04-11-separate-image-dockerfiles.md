# Separate Image Dockerfiles Implementation Plan

> Historical note: This document reflects the pre-2026-04-12 layout. Active Dockerfile paths were later relocated to `docker/Dockerfile.*` by the 2026-04-12 layout reorganization.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared target-based root `Dockerfile` with one Dockerfile per published image and wire every publish workflow to the matching file and ignore rules.

**Architecture:** Extract the existing per-target logic into five standalone Dockerfiles: `webapp`, `worker`, `migration`, `marketing`, and `docs`. Give each image its own Dockerfile-specific ignore file so the Docker build context is isolated per image, then update the GitHub Actions workflows to build from those files directly and retire the old shared root `Dockerfile`.

**Tech Stack:** Docker, Docker Buildx, GitHub Actions, pnpm, Turborepo, Next.js, Bun

---

## File Map

- Create: `Dockerfile.webapp`
  Purpose: build and publish only the `z8-webapp` image.
- Create: `Dockerfile.worker`
  Purpose: build and publish only the `z8-worker` image.
- Create: `Dockerfile.migration`
  Purpose: build and publish only the `z8-migration` image.
- Create: `Dockerfile.marketing`
  Purpose: build and publish only the `z8-marketing` image.
- Create: `Dockerfile.docs`
  Purpose: build and publish only the `z8-docs` image.
- Create: `Dockerfile.webapp.dockerignore`
  Purpose: keep only files needed by the webapp image build context.
- Create: `Dockerfile.worker.dockerignore`
  Purpose: keep only files needed by the worker image build context.
- Create: `Dockerfile.migration.dockerignore`
  Purpose: keep only files needed by the migration image build context.
- Create: `Dockerfile.marketing.dockerignore`
  Purpose: keep only files needed by the marketing image build context.
- Create: `Dockerfile.docs.dockerignore`
  Purpose: keep only files needed by the docs image build context.
- Modify: `.github/workflows/publish-images.yml`
  Purpose: point `webapp`, `worker`, and `migration` publishes at explicit Dockerfiles.
- Modify: `.github/workflows/publish-marketing-image.yml`
  Purpose: point the marketing publish workflow at `Dockerfile.marketing`.
- Modify: `.github/workflows/publish-docs-image.yml`
  Purpose: point the docs publish workflow at `Dockerfile.docs`.
- Modify: `.dockerignore`
  Purpose: keep only generic exclusions that should apply regardless of image.
- Delete: `Dockerfile`
  Purpose: retire the old shared target-based packaging file after all workflow references are migrated.

### Task 1: Split The Shared App-Service Dockerfile Logic

**Files:**
- Create: `Dockerfile.webapp`
- Create: `Dockerfile.worker`
- Create: `Dockerfile.migration`
- Modify: `Dockerfile`
- Test: `Dockerfile.webapp`
- Test: `Dockerfile.worker`
- Test: `Dockerfile.migration`

- [ ] **Step 1: Write a temporary inventory note in your scratchpad of the stages that must be preserved exactly**

Copy these stage responsibilities out of the current `Dockerfile` before editing anything:

```text
Shared base/tooling:
- ARG ALPINE_VERSION=3.21
- ARG NODE_VERSION=22
- ARG PNPM_VERSION=10.28.0
- ARG TURBO_VERSION=2.8.10
- base
- turbo-source

Webapp path:
- pruner
- deps
- workspace
- webapp-builder
- app-runtime payload contents
- webapp runtime metadata

Worker path:
- same dependency/workspace payload as app-runtime
- worker runtime metadata

Migration path:
- same dependency/workspace payload as app-runtime
- migration runtime metadata
```

- [ ] **Step 2: Create `Dockerfile.webapp` by extracting only the webapp path**

Use this structure as the implementation skeleton:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.8.10
ARG NEXT_PUBLIC_BUILD_HASH

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
RUN apk add --no-cache ca-certificates curl libc6-compat libstdc++ tini
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p "${PNPM_HOME}"
WORKDIR /app

FROM base AS turbo-source
ARG TURBO_VERSION
RUN pnpm add -g turbo@${TURBO_VERSION}
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

FROM turbo-source AS pruner
RUN turbo prune webapp --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

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
RUN --mount=type=cache,id=next-cache,target=/app/apps/webapp/.next/cache pnpm --filter webapp exec next build

FROM base AS webapp
RUN pnpm add -g tsx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -f http://localhost:3000/api/health || exit 1
```

- [ ] **Step 3: Create `Dockerfile.worker` by extracting only the worker path**

Use the same `base`, `turbo-source`, `pruner`, `deps`, and `workspace` stages as `Dockerfile.webapp`, then keep only the worker runtime stage:

```Dockerfile
FROM base AS worker
RUN pnpm add -g tsx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
COPY --from=deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=app:nodejs /app/apps/webapp/node_modules ./apps/webapp/node_modules
COPY --from=workspace --chown=app:nodejs /app/apps/webapp/.next ./apps/webapp/.next
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
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/worker.ts"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "const Redis=require('ioredis');const r=new Redis({host:process.env.VALKEY_HOST||'localhost',port:process.env.VALKEY_PORT||6379,password:process.env.VALKEY_PASSWORD,lazyConnect:false});r.ping().then(()=>process.exit(0)).catch(()=>process.exit(1))"
```

- [ ] **Step 4: Create `Dockerfile.migration` by extracting only the migration path**

Use the same `base`, `turbo-source`, `pruner`, `deps`, and `workspace` stages as `Dockerfile.webapp`, then keep only the migration runtime stage:

```Dockerfile
FROM base AS migration
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules
COPY --from=workspace /app/apps/webapp/.next ./apps/webapp/.next
COPY --from=workspace /app/apps/webapp/public ./apps/webapp/public
COPY --from=workspace /app/apps/webapp/src ./apps/webapp/src
COPY --from=workspace /app/apps/webapp/scripts ./apps/webapp/scripts
COPY --from=workspace /app/apps/webapp/drizzle ./apps/webapp/drizzle
COPY --from=workspace /app/apps/webapp/drizzle.config.ts ./apps/webapp/
COPY --from=workspace /app/apps/webapp/next.config.ts ./apps/webapp/
COPY --from=workspace /app/apps/webapp/package.json ./apps/webapp/
COPY --from=workspace /app/apps/webapp/tsconfig.json ./apps/webapp/
COPY --from=workspace /app/package.json ./
COPY --from=workspace /app/pnpm-workspace.yaml ./
WORKDIR /app/apps/webapp
CMD ["node", "./scripts/migrate-with-lock.js"]
```

- [ ] **Step 5: Run targeted string checks so the three new Dockerfiles contain the expected prune and runtime commands**

Run:

```bash
grep -n 'turbo prune webapp --docker' Dockerfile.webapp Dockerfile.worker Dockerfile.migration
grep -n 'CMD \["pnpm", "start"\]' Dockerfile.webapp
grep -n 'CMD \["tsx", "src/worker.ts"\]' Dockerfile.worker
grep -n 'CMD \["node", "./scripts/migrate-with-lock.js"\]' Dockerfile.migration
```

Expected: one matching prune line in each file and the correct runtime command in each image-specific Dockerfile.

- [ ] **Step 6: Commit the app-service Dockerfile split**

```bash
git add Dockerfile.webapp Dockerfile.worker Dockerfile.migration
git commit -m "refactor: split app service Dockerfiles"
```

### Task 2: Split Marketing And Docs Into Their Own Dockerfiles

**Files:**
- Create: `Dockerfile.marketing`
- Create: `Dockerfile.docs`
- Modify: `Dockerfile`
- Test: `Dockerfile.marketing`
- Test: `Dockerfile.docs`

- [ ] **Step 1: Create `Dockerfile.marketing` from the current marketing stages only**

Preserve the existing Bun runtime and marketing build pipeline with this shape:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.8.10

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
RUN apk add --no-cache ca-certificates curl libc6-compat libstdc++ tini
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p "${PNPM_HOME}"
WORKDIR /app

FROM base AS turbo-source
ARG TURBO_VERSION
RUN pnpm add -g turbo@${TURBO_VERSION}
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

FROM turbo-source AS marketing-pruner
RUN turbo prune marketing --docker

FROM base AS marketing-deps
COPY --from=marketing-pruner /app/out/json/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS marketing-workspace
ENV SKIP_ENV_VALIDATION=1
COPY --from=marketing-deps /app/node_modules ./node_modules
COPY --from=marketing-deps /app/apps/marketing/node_modules ./apps/marketing/node_modules
COPY --from=marketing-pruner /app/out/full/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

FROM marketing-workspace AS marketing-builder
RUN mkdir -p /app/apps/marketing/public
RUN --mount=type=cache,id=next-cache-marketing,target=/app/apps/marketing/.next/cache pnpm --filter marketing exec next build

FROM base AS marketing-runtime-deps
COPY --from=marketing-pruner /app/out/json/ ./
COPY --from=marketing-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod

FROM oven/bun:1.3.11-alpine AS marketing
RUN apk add --no-cache curl tini
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 marketing
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -f http://localhost:3000 || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "x", "next", "start", "-p", "3000"]
```

- [ ] **Step 2: Create `Dockerfile.docs` from the current docs stages only**

Preserve the docs build path with this shape:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.8.10

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
RUN apk add --no-cache ca-certificates curl libc6-compat libstdc++ tini
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p "${PNPM_HOME}"
WORKDIR /app

FROM base AS turbo-source
ARG TURBO_VERSION
RUN pnpm add -g turbo@${TURBO_VERSION}
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

FROM turbo-source AS docs-pruner
RUN turbo prune docs --docker

FROM base AS docs-deps
COPY --from=docs-pruner /app/out/json/ ./
COPY --from=docs-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS docs-workspace
ENV SKIP_ENV_VALIDATION=1
COPY --from=docs-deps /app/node_modules ./node_modules
COPY --from=docs-deps /app/apps/docs/node_modules ./apps/docs/node_modules
COPY --from=docs-pruner /app/out/full/ ./
COPY --from=docs-pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

FROM docs-workspace AS docs-builder
RUN --mount=type=cache,id=next-cache-docs,target=/app/apps/docs/.next/cache pnpm --filter docs exec next build

FROM base AS docs-runtime-deps
COPY --from=docs-pruner /app/out/json/ ./
COPY --from=docs-pruner /app/out/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod

FROM base AS docs
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 docs
COPY --from=docs-runtime-deps --chown=docs:nodejs /app/node_modules ./node_modules
COPY --from=docs-runtime-deps --chown=docs:nodejs /app/apps/docs/node_modules ./apps/docs/node_modules
COPY --from=docs-builder --chown=docs:nodejs /app/apps/docs/.next ./apps/docs/.next
COPY --from=docs-workspace --chown=docs:nodejs /app/apps/docs/public ./apps/docs/public
COPY --from=docs-workspace --chown=docs:nodejs /app/apps/docs/content ./apps/docs/content
COPY --from=docs-workspace --chown=docs:nodejs /app/apps/docs/next.config.mjs ./apps/docs/
COPY --from=docs-workspace --chown=docs:nodejs /app/apps/docs/source.config.ts ./apps/docs/
COPY --from=docs-workspace --chown=docs:nodejs /app/apps/docs/package.json ./apps/docs/
COPY --from=docs-workspace --chown=docs:nodejs /app/package.json ./
COPY --from=docs-workspace --chown=docs:nodejs /app/pnpm-workspace.yaml ./
WORKDIR /app/apps/docs
USER docs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -f http://localhost:3001 || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start"]
```

- [ ] **Step 3: Run targeted string checks so the two new Dockerfiles keep the expected prune and runtime commands**

Run:

```bash
grep -n 'turbo prune marketing --docker' Dockerfile.marketing
grep -n 'CMD \["bun", "x", "next", "start", "-p", "3000"\]' Dockerfile.marketing
grep -n 'turbo prune docs --docker' Dockerfile.docs
grep -n 'CMD \["pnpm", "start"\]' Dockerfile.docs
```

Expected: one matching prune line and one matching runtime command in each file.

- [ ] **Step 4: Commit the marketing/docs Dockerfile split**

```bash
git add Dockerfile.marketing Dockerfile.docs
git commit -m "refactor: split docs and marketing Dockerfiles"
```

### Task 3: Add Dockerfile-Specific Ignore Files And Simplify The Root Ignore File

**Files:**
- Create: `Dockerfile.webapp.dockerignore`
- Create: `Dockerfile.worker.dockerignore`
- Create: `Dockerfile.migration.dockerignore`
- Create: `Dockerfile.marketing.dockerignore`
- Create: `Dockerfile.docs.dockerignore`
- Modify: `.dockerignore`

- [ ] **Step 1: Create a shared baseline block that each Dockerfile-specific ignore file starts with**

Use this exact baseline in each new `Dockerfile.*.dockerignore` file:

```dockerignore
node_modules
**/node_modules
.pnpm-store
.next
**/.next
.turbo
**/.turbo
dist
**/dist
build
**/build
out
*.tsbuildinfo
.git
.gitignore
.github
.vscode
.idea
*.swp
*.swo
*~
coverage
.nyc_output
**/*.test.ts
**/*.spec.ts
**/__tests__
vitest.config.*
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.env
.env.*
!.env.example
!.env.template
apps/webapp/.env.local
.DS_Store
Thumbs.db
Desktop.ini
*.pem
*.key
*.crt
*.md
!apps/webapp/README.md
docs/
deploy/.vault-data
deploy/k8s
.npmrc
.yarnrc
apps/webapp/src/data/licenses.json
```

- [ ] **Step 2: Create `Dockerfile.webapp.dockerignore`, `Dockerfile.worker.dockerignore`, and `Dockerfile.migration.dockerignore`**

Append the same app-selection rules to all three files:

```dockerignore
apps/docs
apps/marketing
apps/desktop
apps/mobile
```

Do not exclude `apps/webapp` or `packages/`, because these three images depend on that graph.

- [ ] **Step 3: Create `Dockerfile.marketing.dockerignore` and `Dockerfile.docs.dockerignore`**

Use these app-selection tails:

```dockerignore
# Dockerfile.marketing.dockerignore tail
apps/docs
apps/webapp
apps/desktop
apps/mobile

# Dockerfile.docs.dockerignore tail
apps/marketing
apps/webapp
apps/desktop
apps/mobile
```

Do not exclude `packages/` in either file unless a local build proves the target does not need them.

- [ ] **Step 4: Simplify the root `.dockerignore` so it keeps only generic exclusions**

Replace the app-specific section with this neutral form:

```dockerignore
# Other local apps
apps/desktop
apps/mobile
```

Keep the rest of the generic exclusions intact. The root file must stop carrying image-specific rules for `apps/docs`, `apps/marketing`, or `apps/webapp`.

- [ ] **Step 5: Run content checks to confirm the right apps are excluded per image**

Run:

```bash
grep -n '^apps/docs$' Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.marketing.dockerignore
grep -n '^apps/marketing$' Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.docs.dockerignore
grep -n '^apps/webapp$' Dockerfile.marketing.dockerignore Dockerfile.docs.dockerignore
grep -n '^apps/docs$' .dockerignore && exit 1 || true
grep -n '^apps/marketing$' .dockerignore && exit 1 || true
grep -n '^apps/webapp$' .dockerignore && exit 1 || true
```

Expected: image-specific files contain only the exclusions they should, and the root `.dockerignore` does not exclude `apps/docs`, `apps/marketing`, or `apps/webapp`.

- [ ] **Step 6: Commit the ignore-file split**

```bash
git add .dockerignore Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.marketing.dockerignore Dockerfile.docs.dockerignore
git commit -m "refactor: isolate docker build contexts"
```

### Task 4: Rewire GitHub Actions To Build Explicit Dockerfiles

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/publish-marketing-image.yml`
- Modify: `.github/workflows/publish-docs-image.yml`

- [ ] **Step 1: Update `publish-images.yml` to carry Dockerfile paths in the matrix instead of Dockerfile targets**

Change the matrix entries from this shape:

```yaml
- repository: z8-webapp
  target: webapp
  arch: amd64
```

to this shape:

```yaml
- repository: z8-webapp
  dockerfile: Dockerfile.webapp
  arch: amd64

- repository: z8-worker
  dockerfile: Dockerfile.worker
  arch: amd64

- repository: z8-migration
  dockerfile: Dockerfile.migration
  arch: amd64
```

Repeat the same pattern for `arm64` entries.

- [ ] **Step 2: Update the `docker/build-push-action` step in `publish-images.yml`**

Replace the shared-file contract:

```yaml
file: ./Dockerfile
target: ${{ matrix.target }}
cache-from: type=gha,scope=${{ matrix.repository }}-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=${{ matrix.repository }}-${{ matrix.arch }}
```

with the explicit-file contract:

```yaml
file: ./${{ matrix.dockerfile }}
cache-from: type=gha,scope=${{ matrix.repository }}-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=${{ matrix.repository }}-${{ matrix.arch }}
```

Do not keep any `target:` field in this workflow.

- [ ] **Step 3: Update `publish-marketing-image.yml` to build `Dockerfile.marketing` directly**

Replace:

```yaml
file: ./Dockerfile
target: marketing
cache-from: type=gha,scope=${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=${{ matrix.arch }}
```

with:

```yaml
file: ./Dockerfile.marketing
cache-from: type=gha,scope=marketing-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=marketing-${{ matrix.arch }}
```

- [ ] **Step 4: Update `publish-docs-image.yml` to build `Dockerfile.docs` directly**

Replace:

```yaml
file: ./Dockerfile
target: docs
cache-from: type=gha,scope=docs-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=docs-${{ matrix.arch }}
```

with:

```yaml
file: ./Dockerfile.docs
cache-from: type=gha,scope=docs-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=docs-${{ matrix.arch }}
```

- [ ] **Step 5: Verify the workflows no longer reference the retired root Dockerfile or `target:` values**

Run:

```bash
grep -RIn 'file: ./Dockerfile$' .github/workflows && exit 1 || true
grep -RIn 'target:' .github/workflows && exit 1 || true
grep -RIn 'Dockerfile.webapp\|Dockerfile.worker\|Dockerfile.migration\|Dockerfile.marketing\|Dockerfile.docs' .github/workflows
```

Expected: no workflow references `file: ./Dockerfile` or any `target:` key, and every new Dockerfile name appears in workflow config.

- [ ] **Step 6: Commit the workflow rewiring**

```bash
git add .github/workflows/publish-images.yml .github/workflows/publish-marketing-image.yml .github/workflows/publish-docs-image.yml
git commit -m "refactor: point image workflows at explicit Dockerfiles"
```

### Task 5: Retire The Shared Root Dockerfile And Verify References

**Files:**
- Delete: `Dockerfile`
- Test: `Dockerfile.webapp`
- Test: `Dockerfile.worker`
- Test: `Dockerfile.migration`
- Test: `Dockerfile.marketing`
- Test: `Dockerfile.docs`

- [ ] **Step 1: Delete the old root `Dockerfile` after all workflows and ignore files are in place**

The file should be removed entirely. Do not leave a stub or compatibility wrapper.

- [ ] **Step 2: Verify no repo references to the deleted root Dockerfile remain**

Run:

```bash
grep -RIn '\bDockerfile\b' .github/workflows docs/superpowers/plans docs/superpowers/specs | grep -v 'Dockerfile\.'
```

Expected: no workflow references to the retired shared root file. It is acceptable for older design documents to still mention the historical root `Dockerfile` if they are clearly historical context rather than active implementation references.

- [ ] **Step 3: Verify Turbo prune still works for each build graph represented by the new files**

Run:

```bash
pnpm exec turbo prune webapp --docker
pnpm exec turbo prune marketing --docker
pnpm exec turbo prune docs --docker
```

Expected: each command succeeds and reports `Generating pruned monorepo` plus `Added <app>`.

- [ ] **Step 4: If Docker is available, run one local build per new Dockerfile**

Run:

```bash
docker build -f Dockerfile.webapp .
docker build -f Dockerfile.worker .
docker build -f Dockerfile.migration .
docker build -f Dockerfile.marketing .
docker build -f Dockerfile.docs .
```

Expected: all five builds complete successfully.

If Docker is not available in the execution environment, explicitly note that limitation in the final handoff and do not claim local image builds passed.

- [ ] **Step 5: Commit the root Dockerfile removal and final verification-friendly state**

```bash
git add Dockerfile.webapp Dockerfile.worker Dockerfile.migration Dockerfile.marketing Dockerfile.docs \
  Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore \
  Dockerfile.marketing.dockerignore Dockerfile.docs.dockerignore \
  .dockerignore .github/workflows/publish-images.yml .github/workflows/publish-marketing-image.yml .github/workflows/publish-docs-image.yml
git rm Dockerfile
git commit -m "refactor: isolate docker packaging per image"
```

## Spec Coverage Check

- Separate Dockerfiles per published image: covered by Tasks 1 and 2.
- Separate Dockerfile-specific ignore files: covered by Task 3.
- Workflow rewiring to explicit files: covered by Task 4.
- Retirement of the shared root `Dockerfile`: covered by Task 5.
- Verification of prune/build wiring and workflow references: covered by Tasks 4 and 5.

## Notes For The Implementer

- Keep runtime commands, users, ports, and healthchecks byte-for-byte aligned with the current working Dockerfile behavior.
- Do not redesign application packaging during this refactor. This is a packaging split, not an application deployment redesign.
- If any image unexpectedly needs additional shared files in its ignore file, add only the minimum needed include/exclude adjustment and verify it with a local build or prune step.

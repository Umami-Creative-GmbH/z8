# Separate Image Dockerfiles Design

> Historical note: This document reflects the pre-2026-04-12 layout. Active Dockerfile paths were later relocated to `docker/Dockerfile.*` by the 2026-04-12 layout reorganization.

## Summary

Split the current shared root `Dockerfile` into one Dockerfile per published image, and give each Dockerfile its own Docker-specific ignore file so every publish workflow builds from an isolated, image-specific context contract.

## Context

- The repo currently publishes five image repositories: `z8-webapp`, `z8-worker`, `z8-migration`, `z8-marketing`, and `z8-docs`.
- `webapp`, `worker`, `migration`, `marketing`, and `docs` are all currently defined in one root `Dockerfile` as separate targets.
- The docs publish failure in GitHub Actions exposed a structural problem: image targets share one build context and one root `.dockerignore`, so excluding files for one image can accidentally break another image.
- `publish-images.yml` currently uses one shared Dockerfile for `webapp`, `worker`, and `migration`, while `publish-marketing-image.yml` and `publish-docs-image.yml` each build different targets from that same file.

## Goals

- Give each published image its own Dockerfile.
- Give each published image its own `.dockerignore` rules.
- Remove target coupling inside a shared root Dockerfile.
- Keep image names, tags, and workflow triggers unchanged.
- Preserve the current runtime behavior of each image.

## Non-Goals

- No changes to application behavior.
- No changes to GHCR repository names.
- No changes to deployment manifests.
- No attempt to optimize build count by reintroducing cross-image sharing in CI.

## Options Considered

### 1. Recommended: one Dockerfile and one ignore file per published image

- Add `Dockerfile.webapp`, `Dockerfile.worker`, `Dockerfile.migration`, `Dockerfile.marketing`, and `Dockerfile.docs`.
- Add `Dockerfile.webapp.dockerignore`, `Dockerfile.worker.dockerignore`, `Dockerfile.migration.dockerignore`, `Dockerfile.marketing.dockerignore`, and `Dockerfile.docs.dockerignore`.
- Update each workflow to build from the matching file instead of using `target:` against a shared file.

This is the clearest operational model. Each image publishes from its own explicit packaging definition, and each build context can exclude unrelated apps safely.

### 2. Separate Dockerfiles only for `docs` and `marketing`, keep one shared app-services Dockerfile

- Solves the immediate docs failure.
- Keeps some duplication down.
- Retains shared coupling between `webapp`, `worker`, and `migration`.

This is an improvement, but it stops short of the isolation goal.

### 3. Separate Dockerfiles with shared shell scripts or generated fragments

- Reduces duplicated Docker instructions.
- Adds indirection and makes CI/debugging harder.

This is not warranted for the current scope.

## Approved Direction

Adopt option 1: one Dockerfile per published image, with one Dockerfile-specific ignore file per published image.

The design prefers operational clarity over maximum DRYness. The duplication is acceptable because these are build artifacts that need to be independently understandable and independently safe to change.

## File Layout

### New Dockerfiles

- `Dockerfile.webapp`
- `Dockerfile.worker`
- `Dockerfile.migration`
- `Dockerfile.marketing`
- `Dockerfile.docs`

### New Docker ignore files

- `Dockerfile.webapp.dockerignore`
- `Dockerfile.worker.dockerignore`
- `Dockerfile.migration.dockerignore`
- `Dockerfile.marketing.dockerignore`
- `Dockerfile.docs.dockerignore`

### Existing files to modify

- `.github/workflows/publish-images.yml`
- `.github/workflows/publish-marketing-image.yml`
- `.github/workflows/publish-docs-image.yml`
- `.dockerignore`

### Existing file to retire

- `Dockerfile`

The old root `Dockerfile` should be removed once all workflows reference the new files and verification is complete.

## Dockerfile Design

### Shared conventions across all Dockerfiles

Every Dockerfile should keep the same global defaults where applicable:

- `ARG ALPINE_VERSION=3.21`
- `ARG NODE_VERSION=22`
- `ARG PNPM_VERSION=10.28.0`
- `ARG TURBO_VERSION=2.8.10`

Each Dockerfile should also keep the same base setup pattern where needed:

- install Alpine runtime packages
- enable `pnpm` via Corepack
- set `PNPM_HOME`
- set `NODE_ENV=production`
- set `NEXT_TELEMETRY_DISABLED=1`
- set the app working directory to `/app`

The duplication here is intentional. It keeps each Dockerfile independently readable.

### `Dockerfile.webapp`

Purpose: build and publish only `ghcr.io/umami-creative-gmbh/z8-webapp`.

It should contain:

- the `webapp` prune/build pipeline only
- the webapp runtime image only
- the existing webapp runtime metadata:
  - `USER app`
  - port `3000`
  - `ENTRYPOINT ["/sbin/tini", "--"]`
  - `CMD ["pnpm", "start"]`
  - the current HTTP healthcheck

### `Dockerfile.worker`

Purpose: build and publish only `ghcr.io/umami-creative-gmbh/z8-worker`.

It should contain:

- the `webapp` dependency/build pipeline needed to assemble the worker runtime payload
- the worker runtime image only
- the existing worker runtime metadata:
  - `USER app`
  - `ENTRYPOINT ["/sbin/tini", "--"]`
  - `CMD ["tsx", "src/worker.ts"]`
  - the current Redis healthcheck

Although the worker is not a Next.js server, it currently depends on the same monorepo payload assembled for the shared app runtime. This refactor should preserve that packaging behavior rather than redesign it.

### `Dockerfile.migration`

Purpose: build and publish only `ghcr.io/umami-creative-gmbh/z8-migration`.

It should contain:

- the `webapp` dependency/build pipeline needed for the migration runtime payload
- the migration runtime image only
- the existing migration command:
  - `CMD ["node", "./scripts/migrate-with-lock.js"]`

### `Dockerfile.marketing`

Purpose: build and publish only `ghcr.io/umami-creative-gmbh/z8-marketing`.

It should contain:

- only the marketing prune/build/runtime stages
- the existing Bun-based runtime setup
- the existing port and healthcheck behavior

### `Dockerfile.docs`

Purpose: build and publish only `ghcr.io/umami-creative-gmbh/z8-docs`.

It should contain:

- only the docs prune/build/runtime stages
- the existing docs runtime behavior:
  - `USER docs`
  - port `3001`
  - `ENTRYPOINT ["/sbin/tini", "--"]`
  - `CMD ["pnpm", "start"]`
  - the current HTTP healthcheck

## Docker Ignore Design

Each Dockerfile-specific ignore file should express what that specific image needs in its build context.

Required principle:

- exclude unrelated apps by default for that image
- include the target app and any packages/shared root files it needs
- do not rely on the root `.dockerignore` for image-specific exclusions

Expected examples:

- `Dockerfile.docs.dockerignore` should keep `apps/docs`, required `packages/*`, and shared workspace files, while excluding `apps/webapp`, `apps/marketing`, `apps/mobile`, and `apps/desktop` unless they are actually needed.
- `Dockerfile.marketing.dockerignore` should keep `apps/marketing`, required `packages/*`, and shared workspace files.
- `Dockerfile.webapp.dockerignore`, `Dockerfile.worker.dockerignore`, and `Dockerfile.migration.dockerignore` should keep `apps/webapp`, required `packages/*`, and shared workspace files.

The root `.dockerignore` should stop carrying image-specific exclusions. It can remain as a generic fallback for editor junk, local caches, git metadata, secrets, and other universally excluded files.

## Workflow Changes

### `publish-images.yml`

Keep the existing workflow shape and image names, but change the matrix/build contract:

- replace the `target` field with a `dockerfile` field
- build with `file: ./Dockerfile.webapp`, `./Dockerfile.worker`, or `./Dockerfile.migration`
- remove `target: ${{ matrix.target }}`
- make cache scopes image-specific so they follow the Dockerfile identity, for example `z8-webapp-amd64`

Recommended matrix entries:

- `repository: z8-webapp`, `dockerfile: Dockerfile.webapp`
- `repository: z8-worker`, `dockerfile: Dockerfile.worker`
- `repository: z8-migration`, `dockerfile: Dockerfile.migration`

This keeps the workflow structure stable while making each build input explicit.

### `publish-marketing-image.yml`

- switch from `file: ./Dockerfile` plus `target: marketing`
- to `file: ./Dockerfile.marketing`
- remove `target: marketing`
- update cache scopes to include `marketing`

### `publish-docs-image.yml`

- switch from `file: ./Dockerfile` plus `target: docs`
- to `file: ./Dockerfile.docs`
- remove `target: docs`
- keep docs image names and tagging unchanged
- update cache scopes to include `docs`

## Migration Sequence

1. Create the five new Dockerfiles by extracting the current per-image logic from the root `Dockerfile`.
2. Create the five Dockerfile-specific ignore files.
3. Update all image publish workflows to reference the new files.
4. Simplify the root `.dockerignore` so it contains only generic exclusions.
5. Verify the repo no longer references the old shared `Dockerfile` from image workflows.
6. Remove the old root `Dockerfile`.

The old file should be removed last to keep the refactor easy to validate in incremental steps.

## Error Handling And Safety

- Fail CI immediately if any workflow still points at the retired root `Dockerfile`.
- Keep published image names and tags unchanged so deployment consumers are unaffected.
- Preserve current runtime commands, users, ports, and healthchecks exactly.
- Avoid incidental application code changes during this refactor.

## Testing And Verification

### Required verification

- Confirm each workflow references the intended Dockerfile path.
- Confirm no workflow still relies on `target:` from the old shared Dockerfile.
- Confirm each Dockerfile-specific ignore file excludes unrelated apps and retains the target app.
- Build each Dockerfile locally if Docker is available.
- Confirm `pnpm exec turbo prune <app> --docker` still succeeds for `webapp`, `marketing`, and `docs` against the repo state used by the Dockerfiles.

### Runtime checks after image builds

- `webapp` still exposes port `3000` and keeps its HTTP healthcheck.
- `worker` still runs `tsx src/worker.ts` and keeps its Redis healthcheck.
- `migration` still runs `node ./scripts/migrate-with-lock.js`.
- `marketing` still uses Bun and serves on port `3000`.
- `docs` still serves on port `3001`.

### Workflow checks

- `publish-images.yml` still publishes `z8-webapp`, `z8-worker`, and `z8-migration` for `amd64` and `arm64`.
- `publish-marketing-image.yml` still publishes `z8-marketing` for `amd64` and `arm64`.
- `publish-docs-image.yml` still publishes `z8-docs` for `amd64` and `arm64`.
- manifest assembly remains unchanged from the consumer perspective.

## Risks And Mitigations

### Risk: base setup drifts between Dockerfiles

Mitigation: keep the shared setup blocks intentionally identical and review them together during implementation.

### Risk: an image-specific ignore file excludes a required package

Mitigation: explicitly verify prune/build behavior for each image and keep ignore files narrow and readable.

### Risk: workflow references and cache scopes drift during the split

Mitigation: make each workflow entry carry the image repository name and Dockerfile path explicitly.

## Success Criteria

- Each published image has its own Dockerfile.
- Each published image has its own Docker-specific ignore file.
- No publish workflow depends on the old shared target-based root `Dockerfile`.
- The docs build no longer depends on unrelated root ignore-file behavior.
- Published image names, tags, and runtime behavior remain unchanged.

## Notes

- This design intentionally favors isolation and maintainability over deduplicating every Docker instruction.
- I did not create a git commit for this spec because no commit was requested.

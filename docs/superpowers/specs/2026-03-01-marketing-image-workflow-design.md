# Marketing Docker Publish Workflow Design

Date: 2026-03-01
Status: Approved

## Goal

Create a dedicated GitHub Actions workflow to build and publish a multi-architecture Docker image for the marketing app to GHCR as `ghcr.io/umami-creative-gmbh/z8-marketing`.

## Constraints and Decisions

- Outcome: build and push image to GHCR.
- Trigger strategy: run on pushes to `main`, version tags (`v*.*.*`), and manual dispatch.
- Naming: use `ghcr.io/umami-creative-gmbh/z8-marketing`.
- Scope: workflow design only (no deployment step, no scan integration, no refactor of existing publish workflows).

## Approach Options Considered

1. Dedicated workflow for marketing only (selected)
   - Pros: low risk to existing publish pipelines, clear ownership, minimal blast radius.
   - Cons: duplicates some publish logic.

2. Extend existing `publish-images.yml`
   - Pros: shared logic in one file.
   - Cons: increases risk to webapp/worker/migration publishing path.

3. Reusable workflow + thin callers
   - Pros: best long-term maintainability.
   - Cons: larger upfront refactor not required for current goal.

## Selected Design

### Architecture

- Add `.github/workflows/publish-marketing-image.yml`.
- Keep existing `.github/workflows/publish-images.yml` unchanged.
- Build from monorepo root context (`.`) so workspace and pnpm dependency resolution remain consistent.
- Use a dedicated Docker build target for marketing image creation.

### Components and Data Flow

- Job 1 (`build-native`): matrix build for `linux/amd64` and `linux/arm64`.
  - Build and push image by digest using `docker/build-push-action`.
  - Save each architecture digest as artifact.
- Job 2 (`publish-manifest`): download digests and publish multi-arch manifest tags.
  - Use `docker/metadata-action` to produce tags:
    - `latest` for default branch
    - `sha-*`
    - semver tags for release tags (`vX.Y.Z`, `vX.Y`, `vX`)
  - Create manifest list tags that reference amd64 and arm64 digest images.

### Error Handling and Safety

- Add workflow concurrency by ref to avoid duplicate publishes for the same ref.
- Use strict permissions: `contents: read`, `packages: write`.
- Set `if-no-files-found: error` for digest artifact handling.
- Use strict shell flags (`set -euo pipefail`) in manifest publish step.
- Keep matrix `fail-fast: true` and explicit timeouts per job.

### Testing and Verification

- CI run verifies cross-architecture image builds and manifest assembly.
- Post-run verification checks:
  - `ghcr.io/umami-creative-gmbh/z8-marketing:latest` exists on default branch runs.
  - Semver tags exist on version tag runs.
  - Manifest includes both `linux/amd64` and `linux/arm64`.

## Out of Scope (YAGNI)

- Runtime deployment automation.
- Security scanning additions.
- Consolidation of existing image workflows into reusable workflow modules.

# GHCR Publish Workflow Design

Date: 2026-02-23
Status: Approved
Approach: A (single release workflow)

## Goal

Create one GitHub Actions workflow that builds and publishes production container images to GHCR for the web application stack, with traceable tags and a minimal quality gate.

## Scope

In scope:

- Add one workflow file at `.github/workflows/publish-images.yml`
- Publish three images from the root `Dockerfile` targets:
  - `webapp` -> `ghcr.io/umami-creative-gmbh/z8-webapp`
  - `worker` -> `ghcr.io/umami-creative-gmbh/z8-worker`
  - `migration` -> `ghcr.io/umami-creative-gmbh/z8-migration`
- Build for `linux/amd64` and `linux/arm64`
- Use `main` and semver tags as publish triggers
- Generate `latest`, `sha-*`, and semver tags
- Run a pre-publish build gate (`pnpm build:webapp`)

Out of scope (v1):

- Deployment to Kubernetes or any runtime cluster
- SBOM/signing/provenance attestation
- Extra runtime smoke tests in CI
- Advanced caching optimization

## Triggers

Workflow triggers:

- `push` on `main`
- `push` on tags `v*.*.*`
- `workflow_dispatch` for manual execution

## Workflow Architecture

Single workflow with two jobs:

1. `build-check`
   - Checks out repository
   - Sets up Node and pnpm
   - Installs dependencies
   - Runs `pnpm build:webapp`
   - Fails fast if build is broken

2. `publish-images` (needs `build-check`)
   - Sets up QEMU and Buildx
   - Logs in to `ghcr.io` with `GITHUB_TOKEN`
   - Computes tags and labels for each image
   - Builds and pushes each target image

## Tagging Strategy

Main branch pushes:

- `latest`
- `sha-<shortsha>`

Semver tag pushes (e.g. `v1.4.0`):

- `v1.4.0`
- `v1.4`
- `v1`
- `sha-<shortsha>`

Rules:

- `latest` is only emitted from `main`
- SHA tags are immutable rollback anchors

## Permissions and Security

Workflow-level permissions:

- `contents: read`
- `packages: write`

Authentication:

- Use `GITHUB_TOKEN` for GHCR publish within the org
- No long-lived PAT required in v1

Safety controls:

- Concurrency group per ref (cancel stale runs on same ref)
- Publish job is blocked unless build gate passes

## Data Flow

1. Trigger on `main`, semver tag, or manual run
2. Run `build-check` (`pnpm build:webapp`)
3. If successful, run `publish-images`
4. For each image target (`webapp`, `worker`, `migration`):
   - Generate tags/labels
   - Build multi-arch image
   - Push to GHCR
5. Workflow ends with published artifacts ready for deployment consumption

## Error Handling

- Build gate failure stops the pipeline before any publish
- Image build/push failure fails the workflow immediately
- No silent partial success behavior

## Validation Plan

1. Push a branch with workflow syntax changes and validate action execution
2. Verify build gate behavior by introducing/removing a controlled build failure in a test branch
3. Push to `main` and confirm for all three repos:
   - `latest` exists
   - `sha-*` exists
4. Push a semver tag (e.g. `v1.0.0`) and confirm semver tag set exists
5. Pull test from a client machine:
   - `docker pull ghcr.io/umami-creative-gmbh/z8-webapp:latest`
   - `docker pull ghcr.io/umami-creative-gmbh/z8-worker:latest`
   - `docker pull ghcr.io/umami-creative-gmbh/z8-migration:latest`

## Trade-off Summary

Why Approach A now:

- Fastest path to a working release pipeline
- Minimal moving parts and easy troubleshooting
- Matches current repo maturity (no existing workflows)

Known downside:

- Less modular than reusable-workflow/matrix variants, but acceptable for v1

## Follow-up

After this design doc is committed, create an implementation plan using the `writing-plans` skill. Do not implement the workflow in this design phase.

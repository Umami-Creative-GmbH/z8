# GitHub Actions Image Change Filters Design

## Purpose

Reduce unnecessary GHCR image builds on `main` pushes by only running image publishing workflows when files relevant to that image surface changed. Release tag pushes and manual dispatches must continue to publish images without path restrictions.

## Current State

The repo has three image publishing workflows:

- `.github/workflows/publish-images.yml` builds `z8-webapp`, `z8-worker`, and `z8-migration` from a matrix.
- `.github/workflows/publish-marketing-image.yml` builds `z8-marketing`.
- `.github/workflows/publish-docs-image.yml` builds `z8-docs`.

All three currently run on every push to `main`, every `v*.*.*` tag, and manual `workflow_dispatch`.

## Design

Add workflow-level `paths` filters under each workflow's `push` trigger. These filters apply to branch pushes and keep unrelated `main` changes from starting image builds. Tag pushes remain configured so release tags still publish images even when the tag points at an already-built commit. Manual dispatch remains available for operator-driven rebuilds.

Deployment should follow a changed-surface model. If a workflow is skipped because its files did not change, the corresponding Kubernetes deployment remains on its previous image tag. The system should not try to keep every deployment on the same commit SHA.

The dedicated workflows get image-specific path sets:

- Marketing: `apps/marketing/**`, `docker/Dockerfile.marketing`, `docker/Dockerfile.marketing.dockerignore`, shared workspace manifests, lockfile, Turbo config, and `packages/**`.
- Docs: `apps/docs/**`, `docker/Dockerfile.docs`, `docker/Dockerfile.docs.dockerignore`, shared workspace manifests, lockfile, Turbo config, and `packages/**`.

The combined app runtime workflow gets a broader path set because webapp, worker, and migration share `apps/webapp`, `docker/scripts`, and `docker/targets` runtime preparation:

- `apps/webapp/**`
- `docker/Dockerfile.webapp`, `docker/Dockerfile.worker`, `docker/Dockerfile.migration`
- matching Dockerfile dockerignore files
- `docker/scripts/**`
- `docker/targets/**`
- shared workspace manifests, lockfile, Turbo config, and `packages/**`

## Trade-Offs

This keeps the implementation small and understandable. The trade-off is that `publish-images.yml` still builds webapp, worker, and migration together when any shared runtime path changes. Splitting that workflow later would provide finer-grained builds, but it is not required for the requested optimization and would increase change risk.

## Validation

Update the existing workflow verifier scripts in `scripts/ci` so they assert the expected path filters. Run each verifier after editing the workflows.

## Scope

This change affects workflow triggering. It does not alter Docker build steps, image tags, manifests, package cleanup, or deployment manifests.

# Dockerfile Layout Reorganization Design

## Goal

Move the image-specific Dockerfiles and their matching `.dockerignore` files out of the repository root into a dedicated `docker/` directory without changing build behavior.

## Why

The repository now has one Dockerfile per image, which is easier to reason about than the retired shared target-based Dockerfile. The remaining issue is organization: the root directory is carrying six Dockerfiles plus six Dockerfile-specific ignore files, and that makes unrelated top-level assets harder to scan. This change should improve structure without changing the way images are built.

## Recommended Structure

Use a flat `docker/` directory and preserve the current explicit filenames:

- `docker/Dockerfile.webapp`
- `docker/Dockerfile.worker`
- `docker/Dockerfile.migration`
- `docker/Dockerfile.db-seed`
- `docker/Dockerfile.docs`
- `docker/Dockerfile.marketing`
- matching `docker/Dockerfile.*.dockerignore` files beside each Dockerfile

This keeps the root clean while minimizing churn in references, documentation, and CI validation logic. The behavior change is only the file path.

## Non-Goals

- No Docker build logic changes inside the Dockerfiles
- No image naming changes
- No build context changes; builds still run with `context: .`
- No additional directory nesting such as `docker/webapp/Dockerfile`

## Affected References

All references to the current root-relative Dockerfiles must move to the new `docker/` paths.

Expected update areas:

- `package.json` docker build scripts
- `docker-compose.prod.yml`
- `.github/workflows/publish-images.yml`
- `.github/workflows/publish-docs-image.yml`
- `.github/workflows/publish-marketing-image.yml`
- `scripts/ci/verify-publish-images-workflow.mjs`
- `deploy/README.md`
- any remaining docs or automation that still mention the root paths

## Behavior Constraints

To keep the move safe, the reorganization must preserve these invariants:

- Docker builds still execute from the repository root as context `.`
- Compose services continue to reference the same images and commands as before
- GitHub Actions still point at the correct Dockerfile per image and keep the same matrix behavior
- Dockerfile-specific ignore files remain discoverable by Docker after the move
- Local developer commands remain predictable and documented with the new paths

## Validation

The implementation should verify the reorganization with path-focused checks rather than image-content changes:

- search for stale root-relative references like `Dockerfile.webapp`
- run the CI verification script that asserts workflow Dockerfile paths
- run targeted local commands that validate the updated file references resolve correctly

## Risks

The main risk is incomplete path migration. A single missed reference in CI, Compose, or docs would make the move look partially broken even though the Dockerfiles themselves still work. The implementation should therefore prefer broad reference updates plus a final repository-wide search for stale root-level Dockerfile paths.

## Implementation Shape

This should be handled as a coordinated path migration:

1. Move the Dockerfiles and matching ignore files into `docker/`
2. Update runtime, CI, and documentation references to the new paths
3. Run targeted verification for workflows and local references

Because the Dockerfile contents are not changing, the safest implementation is the smallest one that only updates paths.

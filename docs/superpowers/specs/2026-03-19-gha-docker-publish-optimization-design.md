# GHA Docker Publish Optimization Design

## Summary

Reduce repeated native Docker builds in the GitHub Actions publish workflow while preserving the distinct runtime behavior required for `z8-webapp`, `z8-worker`, and `z8-migration`.

## Context

- `/.github/workflows/publish-images.yml` previously built the shared runtime graph once per architecture and then published three repository tags from the same digests.
- A later workflow change switched to a `repository x arch` matrix and now runs six native builds: `webapp`, `worker`, and `migration` for both `amd64` and `arm64`.
- The three final images still need different runtime metadata because they do not share the same `CMD`, `ENTRYPOINT`, or healthcheck behavior.
- The Dockerfile already models this as a shared `app-runtime` stage with lightweight final stages: `webapp`, `worker`, and `migration`.

## Goals

- Cut the expensive native build work back down to one shared build per architecture.
- Preserve target-specific runtime behavior for `webapp`, `worker`, and `migration`.
- Keep published tags and manifest behavior unchanged from the consumer perspective.
- Make the workflow easier to reason about than the current repetitive matrix.

## Non-Goals

- No application code changes.
- No change to image names, tag formats, or registry.
- No attempt to merge `webapp`, `worker`, and `migration` into one identical final image.
- No marketing image workflow changes.

## Approved Direction

Use a two-phase publish flow:

1. Build the shared `app-runtime` image once for `amd64` and once for `arm64`.
2. Publish `webapp`, `worker`, and `migration` from that shared per-arch result using lightweight target-specific finalization so runtime metadata stays correct.

This keeps the expensive build graph deduplicated while still producing three distinct final images.

## Options Considered

### 1. Recommended: shared runtime build plus lightweight target publishing

- Build `app-runtime` once per architecture.
- Reuse that result to produce the three target images via an explicit external base-image contract.
- Preserve distinct `CMD`, `ENTRYPOINT`, exposed ports, and healthchecks.
- Best balance of speed, correctness, and workflow readability.

### 2. Keep the six-build matrix and rely on cache tuning

- Minimal workflow redesign.
- Still schedules six native builds and keeps the repetition.
- Improves symptoms, not the root inefficiency.

### 3. Full `docker bake`-driven publish graph

- Can express the shared graph cleanly.
- Adds more CI complexity than needed for three closely related targets.
- Not necessary for the current scope.

## Architecture

### 1. Shared build job by architecture

Replace the current `repository x arch` native build matrix with an `arch`-only matrix:

- `amd64` on `ubuntu-latest`
- `arm64` on `ubuntu-24.04-arm`

Each run builds and pushes the shared `app-runtime` image by digest to a dedicated internal repository:

- `ghcr.io/umami-creative-gmbh/z8-app-runtime`

The job exports one artifact per architecture containing:

- shared image repository
- architecture
- digest
- full pull reference such as `ghcr.io/umami-creative-gmbh/z8-app-runtime@sha256:...`

This restores the efficient structure seen before the regression while matching the Dockerfile's shared build graph.

### 2. Target publish job by repository and architecture

Introduce a second matrix over:

- `repository`: `z8-webapp`, `z8-worker`, `z8-migration`
- `target`: `webapp`, `worker`, `migration`
- `arch`: `amd64`, `arm64`

This job should not rebuild the full dependency and Next.js graph. It should only produce the target-specific final image from the already-built shared runtime for that architecture.

Implementation contract:

- Adjust the existing `Dockerfile` so the final target stages can consume either the internal `app-runtime` stage or an externally published runtime image.
- Recommended pattern:

```Dockerfile
ARG RUNTIME_BASE_IMAGE=app-runtime
...
FROM base AS app-runtime
...

FROM ${RUNTIME_BASE_IMAGE} AS webapp
...

FROM ${RUNTIME_BASE_IMAGE} AS migration
...

FROM ${RUNTIME_BASE_IMAGE} AS worker
...
```

- `RUNTIME_BASE_IMAGE` must be declared in global scope before the first `FROM` so it is valid in later `FROM ${RUNTIME_BASE_IMAGE}` instructions.
- If the Dockerfile needs to reference the same arg value outside a `FROM`, re-declare `ARG RUNTIME_BASE_IMAGE` in the relevant stage as normal Dockerfile syntax requires.

- In local or single-pass builds, the default remains `app-runtime`.
- In `publish-targets`, pass `RUNTIME_BASE_IMAGE=ghcr.io/umami-creative-gmbh/z8-app-runtime@sha256:...` for the matching architecture.

This makes the second-phase builds depend on the already-published shared runtime image instead of the expensive internal build graph.

The important requirement is that each final image retains its own runtime config:

- `webapp`: `USER app`, `pnpm start`, port `3000`, `tini`, HTTP healthcheck
- `worker`: `USER app`, `tsx src/worker.ts`, `tini`, worker healthcheck
- `migration`: default root user, migration command

### 3. Manifest assembly per repository

After the per-arch target images exist, publish multi-arch manifests for:

- `ghcr.io/umami-creative-gmbh/z8-webapp`
- `ghcr.io/umami-creative-gmbh/z8-worker`
- `ghcr.io/umami-creative-gmbh/z8-migration`

Tag generation remains driven by `docker/metadata-action` so `latest`, `sha-*`, and semver tags continue to behave exactly as they do now.

## Data Flow

1. `build-shared` checks out the repo and builds `app-runtime` once per architecture into `ghcr.io/umami-creative-gmbh/z8-app-runtime`.
2. The shared artifact for each architecture contains the full external base-image reference.
3. `publish-targets` downloads the appropriate shared reference for the matching architecture.
4. `publish-targets` creates and pushes target-specific single-arch images for `webapp`, `worker`, and `migration`.
5. `publish-manifests` combines the `amd64` and `arm64` digests for each repository into the final multi-arch tags.

`publish-targets` output contract:

- Upload one artifact per `repository + arch`.
- Artifact naming: `target-digest-${repository}-${arch}`.
- Artifact contents:
  - final repository name
  - architecture
  - produced digest
  - canonical image reference such as `ghcr.io/umami-creative-gmbh/z8-worker@sha256:...`

`publish-manifests` must consume only these target artifacts, not the shared runtime artifacts.

## Workflow Shape

Recommended jobs:

- `build-shared`
- `publish-targets`
- `publish-manifests`

Recommended matrix responsibilities:

- `build-shared`: `arch`
- `publish-targets`: `repository + target + arch`
- `publish-manifests`: `repository`

This keeps the expensive work isolated in the smallest matrix and pushes the fan-out to the lightweight stage.

## Dockerfile Contract

The workflow should align with the existing Dockerfile stage boundaries:

- `app-runtime` is the shared runtime payload.
- `webapp`, `worker`, and `migration` are target-specific wrappers around that shared runtime.

Required Dockerfile adjustment:

- Parameterize the base image used by the final `webapp`, `worker`, and `migration` stages with a global `ARG RUNTIME_BASE_IMAGE=app-runtime` declared before the first `FROM`.
- Keep all expensive stages unchanged.
- Limit the refactor to the final runtime wrapper stages so the application build graph remains shared and single-sourced.

## Error Handling

- Fail immediately if any shared digest is missing.
- Fail immediately if any shared image reference artifact is malformed or points to the wrong architecture.
- Use explicit artifact names so architecture and repository cannot be mixed up.
- Keep digest validation before manifest creation.
- Ensure manifest publishing depends on completion of every required per-arch target publish.

## Testing And Verification

- Validate workflow YAML structure before merging.
- Confirm the run graph shows exactly two heavy native `build-shared` jobs and six lightweight `publish-targets` jobs.
- Use `docker buildx imagetools inspect` on each published repository to confirm multi-arch manifests exist for `linux/amd64` and `linux/arm64`.
- Verify target metadata stays distinct by checking the published config for each single-arch image with either `docker buildx imagetools inspect --raw` plus JSON parsing or `docker pull --platform ...` followed by `docker inspect`.
- Required config checks:
  - `z8-webapp`: `User=app`, `Entrypoint=["/sbin/tini","--"]`, `Cmd=["pnpm","start"]`
  - `z8-worker`: `User=app`, `Entrypoint=["/sbin/tini","--"]`, `Cmd=["tsx","src/worker.ts"]`
  - `z8-migration`: root user, `Cmd=["node","./scripts/migrate-with-lock.js"]`
- Confirm the webapp image continues to expose port `3000` and retains its healthcheck, and the worker image retains its Redis healthcheck.
- Example verification commands:

```bash
docker buildx imagetools inspect ghcr.io/umami-creative-gmbh/z8-webapp:sha-<commit>
docker pull --platform linux/amd64 ghcr.io/umami-creative-gmbh/z8-webapp:sha-<commit>
docker inspect ghcr.io/umami-creative-gmbh/z8-webapp:sha-<commit>
```

## Expected Outcome

- Native heavy build count drops from six full builds to two full shared builds.
- Final image behavior remains unchanged for deployments.
- Workflow duplication is reduced and future maintenance becomes clearer.

## Notes

- This design intentionally optimizes the webapp publish workflow only.
- I did not create a git commit for this spec because no commit was requested.

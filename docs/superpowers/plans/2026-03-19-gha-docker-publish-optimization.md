# GHA Docker Publish Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore an efficient GHCR publish pipeline that does two heavy native shared-runtime builds, preserves distinct `webapp` / `worker` / `migration` runtime metadata, and still publishes the same multi-arch image tags.

**Architecture:** Refactor the root `Dockerfile` so the final runtime stages can either inherit from the internal `app-runtime` stage or from an externally published shared runtime image. Then rewrite `.github/workflows/publish-images.yml` into three jobs: `build-shared` to publish `z8-app-runtime` per architecture, `publish-targets` to create the six lightweight single-arch final images from that shared base, and `publish-manifests` to assemble the public multi-arch tags for each repository.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, multi-stage Dockerfile, Node.js ESM verification scripts, `pnpm dlx actionlint`, GitHub CLI

---

## References To Read First

- `AGENTS.md`
- `docs/superpowers/specs/2026-03-19-gha-docker-publish-optimization-design.md`
- `.github/workflows/publish-images.yml`
- `Dockerfile`
- `deploy/README.md`

## File Map

### Docker runtime reuse contract

- Modify: `Dockerfile`
  - Add a global `RUNTIME_BASE_IMAGE` arg and switch the final `webapp`, `worker`, and `migration` stages to `FROM ${RUNTIME_BASE_IMAGE}` so CI can reuse the published shared runtime image without rebuilding the heavy graph.
- Create: `scripts/ci/verify-runtime-base-contract.mjs`
  - Fast structural contract check for the Dockerfile base-image reuse pattern.

### Workflow optimization

- Modify: `.github/workflows/publish-images.yml`
  - Replace the current `repository x arch` heavy-build matrix with `build-shared`, `publish-targets`, and `publish-manifests`.
- Create: `scripts/ci/verify-publish-images-workflow.mjs`
  - Fast workflow-shape contract check for the new jobs, artifact filenames, shared runtime repo, and validation guards.

### Documentation

- Modify: `deploy/README.md`
  - Update the workflow explanation so it documents the shared runtime repository and distinct final images instead of saying all three repos point at the same digest.

## Delivery Strategy

Implement in four passes:

1. Lock the Dockerfile contract first so later workflow steps have a valid external shared-runtime base.
2. Introduce `build-shared` plus explicit shared-artifact export and validation.
3. Add `publish-targets` and `publish-manifests` using validated artifact handoff.
4. Update docs and run local plus published-image verification commands.

## Artifact Contracts

### Shared runtime artifact: `shared-runtime-${arch}`

The uploaded artifact directory must contain exactly these files:

- `reference.txt` - full canonical reference, example: `ghcr.io/umami-creative-gmbh/z8-app-runtime@sha256:abc...`
- `digest.txt` - digest only, example: `sha256:abc...`
- `repository.txt` - literal `z8-app-runtime`
- `arch.txt` - literal `amd64` or `arm64`

### Final target artifact: `target-digest-${repository}-${arch}`

The uploaded artifact directory must contain exactly these files:

- `reference.txt` - full canonical reference, example: `ghcr.io/umami-creative-gmbh/z8-worker@sha256:def...`
- `digest.txt` - digest only, example: `sha256:def...`
- `repository.txt` - literal `z8-webapp`, `z8-worker`, or `z8-migration`
- `arch.txt` - literal `amd64` or `arm64`

Every workflow step that reads one of these artifacts must fail if any file is missing, empty, malformed, or mismatched against the current matrix values.

## Task 1: Add the shared runtime base-image contract to the Dockerfile

**Files:**
- Create: `scripts/ci/verify-runtime-base-contract.mjs`
- Modify: `Dockerfile`

- [ ] **Step 1: Write the failing Dockerfile contract check**

```js
import { readFileSync } from "node:fs";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

const requiredSnippets = [
  "ARG RUNTIME_BASE_IMAGE=app-runtime",
  "FROM ${RUNTIME_BASE_IMAGE} AS webapp",
  "FROM ${RUNTIME_BASE_IMAGE} AS migration",
  "FROM ${RUNTIME_BASE_IMAGE} AS worker",
];

for (const snippet of requiredSnippets) {
  if (!dockerfile.includes(snippet)) {
    throw new Error(`Missing Dockerfile contract snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "FROM app-runtime AS webapp",
  "FROM app-runtime AS migration",
  "FROM app-runtime AS worker",
];

for (const snippet of forbiddenSnippets) {
  if (dockerfile.includes(snippet)) {
    throw new Error(`Old fixed runtime base still present: ${snippet}`);
  }
}

console.log("Docker runtime base contract OK");
```

- [ ] **Step 2: Run the contract check to prove it fails on the current Dockerfile**

Run: `node scripts/ci/verify-runtime-base-contract.mjs`
Expected: FAIL with `Missing Dockerfile contract snippet: ARG RUNTIME_BASE_IMAGE=app-runtime` or one of the `FROM ${RUNTIME_BASE_IMAGE}` checks.

- [ ] **Step 3: Refactor the final runtime stages to use the configurable base image**

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG RUNTIME_BASE_IMAGE=app-runtime

ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.8.10
ARG NEXT_PUBLIC_BUILD_HASH

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
...
FROM base AS app-runtime
...
FROM ${RUNTIME_BASE_IMAGE} AS webapp
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start"]

FROM ${RUNTIME_BASE_IMAGE} AS migration
CMD ["node", "./scripts/migrate-with-lock.js"]

FROM ${RUNTIME_BASE_IMAGE} AS worker
USER app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/worker.ts"]
```

Keep the expensive stages (`pruner`, `deps`, `workspace`, `webapp-builder`, `app-runtime`) unchanged. Only refactor the final wrapper stages.

Keep `# syntax=docker/dockerfile:1.4` as line 1. Insert `ARG RUNTIME_BASE_IMAGE=app-runtime` immediately after it and before the first `FROM`.

- [ ] **Step 4: Re-run the contract check**

Run: `node scripts/ci/verify-runtime-base-contract.mjs`
Expected: PASS with `Docker runtime base contract OK`.

- [ ] **Step 5: Smoke-test the external runtime base path locally**

Run:

```bash
docker buildx build --platform linux/amd64 --target app-runtime --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --load -t z8-app-runtime:plan-smoke .
docker buildx build --platform linux/amd64 --target worker --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --build-arg RUNTIME_BASE_IMAGE=z8-app-runtime:plan-smoke --load -t z8-worker:plan-smoke .
docker inspect z8-worker:plan-smoke --format '{{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}'
```

Expected: PASS. The final `docker inspect` output includes `"app"`, `[`"/sbin/tini","--"`]`, and `[`"tsx","src/worker.ts"`]`.

- [ ] **Step 6: Commit the Dockerfile contract change**

```bash
git add Dockerfile scripts/ci/verify-runtime-base-contract.mjs
git commit -m "build: parameterize runtime base image"
```

## Task 2: Add the shared-runtime build job and shared artifact validation

**Files:**
- Create: `scripts/ci/verify-publish-images-workflow.mjs`
- Modify: `.github/workflows/publish-images.yml`

- [ ] **Step 1: Write the failing workflow-shape verifier**

```js
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/publish-images.yml", import.meta.url), "utf8");

const requiredSnippets = [
  "build-shared:",
  "publish-targets:",
  "publish-manifests:",
  "ghcr.io/umami-creative-gmbh/z8-app-runtime",
  "name: shared-runtime-${{ matrix.arch }}",
  "name: target-digest-${{ matrix.repository }}-${{ matrix.arch }}",
  "reference.txt",
  "digest.txt",
  "repository.txt",
  "arch.txt",
  'echo "::error::shared runtime artifact is missing reference.txt"',
  'echo "::error::target artifact digest is empty"',
  "RUNTIME_BASE_IMAGE=${{ env.RUNTIME_BASE_IMAGE }}",
];

for (const snippet of requiredSnippets) {
  if (!workflow.includes(snippet)) {
    throw new Error(`Missing workflow snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "name: Build Native (${{ matrix.repository }} ${{ matrix.arch }})",
  "name: digests-${{ matrix.repository }}-${{ matrix.arch }}",
];

for (const snippet of forbiddenSnippets) {
  if (workflow.includes(snippet)) {
    throw new Error(`Old workflow structure still present: ${snippet}`);
  }
}

console.log("Publish workflow contract OK");
```

- [ ] **Step 2: Run the workflow-shape verifier to confirm the current workflow still fails**

Run: `node scripts/ci/verify-publish-images-workflow.mjs`
Expected: FAIL with `Missing workflow snippet: build-shared:`.

- [ ] **Step 3: Preserve the existing workflow header and env contract**

Keep these sections from the current `.github/workflows/publish-images.yml` intact while editing the jobs below them:

- the `on:` trigger block at the top of the file
- the `permissions:` block
- the `concurrency:` block
- the existing `DIGEST_ROOT`, `IMAGE_NAMESPACE`, and `REGISTRY` env vars

Add only:

```yaml
env:
  SHARED_RUNTIME_REPOSITORY: z8-app-runtime
```

- [ ] **Step 4: Replace the current `build-native` job with `build-shared`**

Add this job skeleton:

```yaml
  build-shared:
    name: Build Shared Runtime (${{ matrix.arch }})
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 120
    strategy:
      fail-fast: true
      matrix:
        include:
          - arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm

    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push shared runtime by digest
        id: build_shared
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: app-runtime
          platforms: ${{ matrix.platform }}
          outputs: type=image,name=${{ env.REGISTRY }}/${{ env.IMAGE_NAMESPACE }}/${{ env.SHARED_RUNTIME_REPOSITORY }},push-by-digest=true,name-canonical=true,push=true
          build-args: |
            NEXT_PUBLIC_BUILD_HASH=${{ github.sha }}
      - name: Upload shared runtime artifact
        uses: actions/upload-artifact@v4
        with:
          name: shared-runtime-${{ matrix.arch }}
          path: ${{ env.DIGEST_ROOT }}/shared/*
          if-no-files-found: error
```

- [ ] **Step 5: Temporarily update `publish-manifests.needs` so the workflow stays lintable between tasks**

In the existing `publish-manifests` job, change:

```yaml
needs: build-native
```

to:

```yaml
needs: build-shared
```

Task 3 will replace the job contents and retarget `needs` to `publish-targets`, but this temporary edit keeps `actionlint` green after removing `build-native`.

- [ ] **Step 6: Export and validate the shared artifact payload**

Insert this exact validation flow between the shared build step and the upload step:

```yaml
      - name: Export shared runtime artifact
        env:
          ARCH: ${{ matrix.arch }}
          IMAGE_DIGEST: ${{ steps.build_shared.outputs.digest }}
        run: |
          set -euo pipefail

          if [ -z "${IMAGE_DIGEST}" ]; then
            echo "::error::shared image digest output is empty"
            exit 1
          fi

          case "${IMAGE_DIGEST}" in
            sha256:*) ;;
            *)
              echo "::error::shared image digest has unexpected format: ${IMAGE_DIGEST}"
              exit 1
              ;;
          esac

          SHARED_REF="${REGISTRY}/${IMAGE_NAMESPACE}/${SHARED_RUNTIME_REPOSITORY}@${IMAGE_DIGEST}"

          case "${SHARED_REF}" in
            ghcr.io/umami-creative-gmbh/z8-app-runtime@sha256:*) ;;
            *)
              echo "::error::shared image reference has unexpected format: ${SHARED_REF}"
              exit 1
              ;;
          esac

          mkdir -p "${DIGEST_ROOT}/shared"
          printf '%s\n' "${SHARED_REF}" > "${DIGEST_ROOT}/shared/reference.txt"
          printf '%s\n' "${IMAGE_DIGEST}" > "${DIGEST_ROOT}/shared/digest.txt"
          printf '%s\n' "${SHARED_RUNTIME_REPOSITORY}" > "${DIGEST_ROOT}/shared/repository.txt"
          printf '%s\n' "${ARCH}" > "${DIGEST_ROOT}/shared/arch.txt"
```

- [ ] **Step 7: Re-run the workflow-shape verifier**

Run: `node scripts/ci/verify-publish-images-workflow.mjs`
Expected: still FAIL, but now on a later missing snippet for `publish-targets:` or target artifact handling rather than `build-shared:`.

- [ ] **Step 8: Lint the in-progress workflow**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS with no lint errors.

- [ ] **Step 9: Commit the shared-runtime job foundation**

```bash
git add .github/workflows/publish-images.yml scripts/ci/verify-publish-images-workflow.mjs
git commit -m "ci: add shared runtime docker publish job"
```

## Task 3: Add target finalization and manifest publishing from validated artifacts

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `scripts/ci/verify-publish-images-workflow.mjs`

- [ ] **Step 1: Add the `publish-targets` job header**

```yaml
  publish-targets:
    name: Publish Target (${{ matrix.repository }} ${{ matrix.arch }})
    needs: build-shared
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 60
    strategy:
      fail-fast: true
```

- [ ] **Step 2: Add the six explicit `publish-targets` matrix entries**

```yaml
      matrix:
        include:
          - repository: z8-webapp
            target: webapp
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - repository: z8-webapp
            target: webapp
            arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm
          - repository: z8-worker
            target: worker
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - repository: z8-worker
            target: worker
            arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm
          - repository: z8-migration
            target: migration
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - repository: z8-migration
            target: migration
            arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm
```

- [ ] **Step 3: Restore the standard job setup steps in `publish-targets`**

```yaml
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Add the shared runtime artifact download step**

```yaml
      - name: Download shared runtime artifact
        uses: actions/download-artifact@v4
        with:
          name: shared-runtime-${{ matrix.arch }}
          path: ${{ env.DIGEST_ROOT }}/shared
```

- [ ] **Step 5: Add the shared runtime artifact validation step**

```yaml
      - name: Validate shared runtime artifact
        env:
          EXPECTED_ARCH: ${{ matrix.arch }}
        run: |
          set -euo pipefail

          for file in reference.txt digest.txt repository.txt arch.txt; do
            if [ ! -s "${DIGEST_ROOT}/shared/${file}" ]; then
              echo "::error::shared runtime artifact is missing ${file}"
              exit 1
            fi
          done

          SHARED_REF="$(tr -d '\n' < "${DIGEST_ROOT}/shared/reference.txt")"
          SHARED_DIGEST="$(tr -d '\n' < "${DIGEST_ROOT}/shared/digest.txt")"
          SHARED_REPOSITORY="$(tr -d '\n' < "${DIGEST_ROOT}/shared/repository.txt")"
          SHARED_ARCH="$(tr -d '\n' < "${DIGEST_ROOT}/shared/arch.txt")"

          if [ "${SHARED_REPOSITORY}" != "${SHARED_RUNTIME_REPOSITORY}" ]; then
            echo "::error::shared runtime repository mismatch: ${SHARED_REPOSITORY}"
            exit 1
          fi

          if [ "${SHARED_ARCH}" != "${EXPECTED_ARCH}" ]; then
            echo "::error::shared runtime artifact arch mismatch: expected ${EXPECTED_ARCH}, got ${SHARED_ARCH}"
            exit 1
          fi

          case "${SHARED_DIGEST}" in
            sha256:*) ;;
            *)
              echo "::error::shared runtime digest has unexpected format: ${SHARED_DIGEST}"
              exit 1
              ;;
          esac

          case "${SHARED_REF}" in
            ghcr.io/umami-creative-gmbh/z8-app-runtime@sha256:*) ;;
            *)
              echo "::error::shared runtime reference has unexpected format: ${SHARED_REF}"
              exit 1
              ;;
          esac

          echo "RUNTIME_BASE_IMAGE=${SHARED_REF}" >> "${GITHUB_ENV}"
```

- [ ] **Step 6: Add the target build step**

```yaml
      - name: Build and push target by digest
        id: build_target
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: ${{ matrix.target }}
          platforms: ${{ matrix.platform }}
          outputs: type=image,name=${{ env.REGISTRY }}/${{ env.IMAGE_NAMESPACE }}/${{ matrix.repository }},push-by-digest=true,name-canonical=true,push=true
          build-args: |
            NEXT_PUBLIC_BUILD_HASH=${{ github.sha }}
            RUNTIME_BASE_IMAGE=${{ env.RUNTIME_BASE_IMAGE }}
```

- [ ] **Step 7: Add the target artifact export step**

```yaml
      - name: Export target artifact
        env:
          ARCH: ${{ matrix.arch }}
          REPOSITORY: ${{ matrix.repository }}
          IMAGE_DIGEST: ${{ steps.build_target.outputs.digest }}
        run: |
          set -euo pipefail

          if [ -z "${IMAGE_DIGEST}" ]; then
            echo "::error::target artifact digest is empty"
            exit 1
          fi

          case "${IMAGE_DIGEST}" in
            sha256:*) ;;
            *)
              echo "::error::target artifact digest has unexpected format: ${IMAGE_DIGEST}"
              exit 1
              ;;
          esac

          TARGET_REF="${REGISTRY}/${IMAGE_NAMESPACE}/${REPOSITORY}@${IMAGE_DIGEST}"
          mkdir -p "${DIGEST_ROOT}/target"
          printf '%s\n' "${TARGET_REF}" > "${DIGEST_ROOT}/target/reference.txt"
          printf '%s\n' "${IMAGE_DIGEST}" > "${DIGEST_ROOT}/target/digest.txt"
          printf '%s\n' "${REPOSITORY}" > "${DIGEST_ROOT}/target/repository.txt"
          printf '%s\n' "${ARCH}" > "${DIGEST_ROOT}/target/arch.txt"
```

- [ ] **Step 8: Add the target artifact upload step**

```yaml
      - name: Upload target artifact
        uses: actions/upload-artifact@v4
        with:
          name: target-digest-${{ matrix.repository }}-${{ matrix.arch }}
          path: ${{ env.DIGEST_ROOT }}/target/*
          if-no-files-found: error
```

- [ ] **Step 9: Add the `publish-manifests` job header and setup steps**

```yaml
  publish-manifests:
    name: Publish Manifests (${{ matrix.repository }})
    needs: publish-targets
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: true
      matrix:
        repository:
          - z8-webapp
          - z8-worker
          - z8-migration

    steps:
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 10: Add the amd64 and arm64 target artifact download steps**

```yaml
      - name: Download amd64 target artifact
        uses: actions/download-artifact@v4
        with:
          name: target-digest-${{ matrix.repository }}-amd64
          path: ${{ env.DIGEST_ROOT }}/amd64
      - name: Download arm64 target artifact
        uses: actions/download-artifact@v4
        with:
          name: target-digest-${{ matrix.repository }}-arm64
          path: ${{ env.DIGEST_ROOT }}/arm64
```

- [ ] **Step 11: Add the target artifact validation step in `publish-manifests`**

```yaml
      - name: Validate target artifacts
        env:
          REPOSITORY: ${{ matrix.repository }}
        run: |
          set -euo pipefail

          validate_target_dir() {
            local dir="$1"
            local expected_arch="$2"

            for file in reference.txt digest.txt repository.txt arch.txt; do
              if [ ! -s "${dir}/${file}" ]; then
                echo "::error::target artifact is missing ${file} in ${dir}"
                exit 1
              fi
            done

            local ref="$(tr -d '\n' < "${dir}/reference.txt")"
            local digest="$(tr -d '\n' < "${dir}/digest.txt")"
            local repository="$(tr -d '\n' < "${dir}/repository.txt")"
            local arch="$(tr -d '\n' < "${dir}/arch.txt")"

            if [ "${repository}" != "${REPOSITORY}" ]; then
              echo "::error::target artifact repository mismatch in ${dir}: ${repository}"
              exit 1
            fi

            if [ "${arch}" != "${expected_arch}" ]; then
              echo "::error::target artifact arch mismatch in ${dir}: ${arch}"
              exit 1
            fi

            case "${digest}" in
              sha256:*) ;;
              *)
                echo "::error::target artifact digest has unexpected format: ${digest}"
                exit 1
                ;;
            esac

            case "${ref}" in
              ghcr.io/umami-creative-gmbh/${REPOSITORY}@sha256:*) ;;
              *)
                echo "::error::target artifact reference has unexpected format: ${ref}"
                exit 1
                ;;
            esac
          }

          validate_target_dir "${DIGEST_ROOT}/amd64" amd64
          validate_target_dir "${DIGEST_ROOT}/arm64" arm64
```

- [ ] **Step 12: Add the `docker/metadata-action` step exactly once per repository**

Copy the tag behavior from the current workflow:

```yaml
      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAMESPACE }}/${{ matrix.repository }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern=v{{version}}
            type=semver,pattern=v{{major}}.{{minor}}
            type=semver,pattern=v{{major}}
```

- [ ] **Step 13: Add the manifest publish step using the validated canonical references**

Use the validated `reference.txt` payload directly instead of reconstructing references from digest filenames:

```yaml
      - name: Create and push multi-arch manifests
        env:
          TAGS: ${{ steps.meta.outputs.tags }}
        run: |
          set -euo pipefail

          AMD64_REF="$(tr -d '\n' < "${DIGEST_ROOT}/amd64/reference.txt")"
          ARM64_REF="$(tr -d '\n' < "${DIGEST_ROOT}/arm64/reference.txt")"

          for tag in ${TAGS}; do
            docker buildx imagetools create \
              -t "${tag}" \
              "${AMD64_REF}" \
              "${ARM64_REF}"
          done
```

- [ ] **Step 14: Re-run the workflow-shape verifier**

Run: `node scripts/ci/verify-publish-images-workflow.mjs`
Expected: PASS with `Publish workflow contract OK`.

- [ ] **Step 15: Lint the workflow**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS with no lint errors.

- [ ] **Step 16: Commit the target finalization and manifest flow**

```bash
git add .github/workflows/publish-images.yml scripts/ci/verify-publish-images-workflow.mjs
git commit -m "ci: optimize docker publish workflow"
```

## Task 4: Update docs and verify both local builds and published outputs

**Files:**
- Modify: `deploy/README.md`
- Test: `Dockerfile`
- Test: `.github/workflows/publish-images.yml`
- Test: `scripts/ci/verify-runtime-base-contract.mjs`
- Test: `scripts/ci/verify-publish-images-workflow.mjs`

**Remote verification prerequisites:**
- authenticated `gh` CLI
- push access to the current branch
- permission to dispatch workflows in the repo
- permission to pull the branch-published GHCR images

- [ ] **Step 1: Update the deployment docs to match the new image flow**

Replace the outdated workflow bullets in `deploy/README.md` with text like:

```md
- Uses native `amd64` and native `arm64` runners (no QEMU emulation)
- Builds one shared `z8-app-runtime` image per architecture, then derives target-specific final images from that shared runtime
- Publishes `z8-webapp`, `z8-worker`, and `z8-migration` as distinct final images with their own runtime metadata
- Publishes multi-arch manifests for each final repository after both architecture-specific target images exist
```

- [ ] **Step 2: Re-run the fast verification checks**

Run:

```bash
node scripts/ci/verify-runtime-base-contract.mjs
node scripts/ci/verify-publish-images-workflow.mjs
pnpm dlx actionlint .github/workflows/publish-images.yml
```

Expected: PASS. Both scripts print their `... OK` messages and `actionlint` prints no errors.

- [ ] **Step 3: Build the shared runtime smoke-test image once**

Run:

```bash
docker buildx build --platform linux/amd64 --target app-runtime --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --load -t z8-app-runtime:plan-smoke .
```

Expected: PASS and a local image named `z8-app-runtime:plan-smoke` exists.

- [ ] **Step 4: Smoke-build and inspect the webapp image from the external shared runtime**

Run:

```bash
docker buildx build --platform linux/amd64 --target webapp --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --build-arg RUNTIME_BASE_IMAGE=z8-app-runtime:plan-smoke --load -t z8-webapp:plan-smoke .
docker inspect z8-webapp:plan-smoke --format '{{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}} {{json .Config.ExposedPorts}}'
docker inspect z8-webapp:plan-smoke --format '{{json .Config.Healthcheck.Test}}'
```

Expected: PASS. Output shows `"app"`, `[`"/sbin/tini","--"`]`, `[`"pnpm","start"`]`, `3000/tcp`, and the HTTP healthcheck command.

- [ ] **Step 5: Smoke-build and inspect the worker image from the external shared runtime**

Run:

```bash
docker buildx build --platform linux/amd64 --target worker --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --build-arg RUNTIME_BASE_IMAGE=z8-app-runtime:plan-smoke --load -t z8-worker:plan-smoke .
docker inspect z8-worker:plan-smoke --format '{{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker inspect z8-worker:plan-smoke --format '{{json .Config.Healthcheck.Test}}'
```

Expected: PASS. Output shows `"app"`, `[`"/sbin/tini","--"`]`, `[`"tsx","src/worker.ts"`]`, and the Redis healthcheck command.

- [ ] **Step 6: Smoke-build and inspect the migration image from the external shared runtime**

Run:

```bash
docker buildx build --platform linux/amd64 --target migration --build-arg NEXT_PUBLIC_BUILD_HASH=plan-smoke --build-arg RUNTIME_BASE_IMAGE=z8-app-runtime:plan-smoke --load -t z8-migration:plan-smoke .
docker inspect z8-migration:plan-smoke --format '{{json .Config.User}} {{json .Config.Cmd}}'
```

Expected: PASS. Output shows an empty root user and `[`"node","./scripts/migrate-with-lock.js"`]`.

- [ ] **Step 7: Push the branch and manually dispatch the workflow for published-image verification**

Run:

```bash
git push -u origin HEAD
gh workflow run publish-images.yml --ref "$(git branch --show-current)"
RUN_ID="$(gh run list --workflow publish-images.yml --branch "$(git branch --show-current)" --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: PASS. GitHub starts a workflow run for the current branch and `RUN_ID` is populated.

- [ ] **Step 8: Wait for the run and verify the published multi-arch outputs**

Run:

```bash
gh run watch "${RUN_ID}" --exit-status
SHORT_SHA="$(git rev-parse --short=7 HEAD)"
docker buildx imagetools inspect "ghcr.io/umami-creative-gmbh/z8-webapp:sha-${SHORT_SHA}"
docker buildx imagetools inspect "ghcr.io/umami-creative-gmbh/z8-worker:sha-${SHORT_SHA}"
docker buildx imagetools inspect "ghcr.io/umami-creative-gmbh/z8-migration:sha-${SHORT_SHA}"
```

Expected: PASS. Each manifest lists both `linux/amd64` and `linux/arm64`.

- [ ] **Step 9: Pull one published platform image per target and verify the runtime metadata**

Run:

```bash
SHORT_SHA="$(git rev-parse --short=7 HEAD)"
docker pull --platform linux/amd64 "ghcr.io/umami-creative-gmbh/z8-webapp:sha-${SHORT_SHA}"
docker pull --platform linux/amd64 "ghcr.io/umami-creative-gmbh/z8-worker:sha-${SHORT_SHA}"
docker pull --platform linux/amd64 "ghcr.io/umami-creative-gmbh/z8-migration:sha-${SHORT_SHA}"
docker inspect "ghcr.io/umami-creative-gmbh/z8-webapp:sha-${SHORT_SHA}" --format '{{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}} {{json .Config.ExposedPorts}} {{json .Config.Healthcheck.Test}}'
docker inspect "ghcr.io/umami-creative-gmbh/z8-worker:sha-${SHORT_SHA}" --format '{{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}} {{json .Config.Healthcheck.Test}}'
docker inspect "ghcr.io/umami-creative-gmbh/z8-migration:sha-${SHORT_SHA}" --format '{{json .Config.User}} {{json .Config.Cmd}}'
```

Expected: PASS. Published image metadata matches the local smoke-build expectations.

- [ ] **Step 10: Review the final diff before committing**

Run: `git diff -- Dockerfile .github/workflows/publish-images.yml deploy/README.md scripts/ci/verify-runtime-base-contract.mjs scripts/ci/verify-publish-images-workflow.mjs`
Expected: Review shows only the Dockerfile contract refactor, workflow rewrite, verification scripts, and README update.

- [ ] **Step 11: Commit the docs and verification polish**

```bash
git add deploy/README.md
git commit -m "docs: document shared docker runtime publish flow"
```

## Final Verification Checklist

- `node scripts/ci/verify-runtime-base-contract.mjs`
- `node scripts/ci/verify-publish-images-workflow.mjs`
- `pnpm dlx actionlint .github/workflows/publish-images.yml`
- Local `docker buildx build` smoke builds for `app-runtime`, `webapp`, `worker`, and `migration`
- `docker inspect` confirms distinct metadata for the three local final images
- `gh workflow run publish-images.yml --ref <branch>` completes successfully
- `docker buildx imagetools inspect` confirms `linux/amd64` and `linux/arm64` for all three published repos
- `docker inspect` confirms published `webapp` / `worker` healthchecks, `webapp` port `3000`, and target-specific commands

## Expected End State

- `.github/workflows/publish-images.yml` performs two heavy shared-runtime native builds and six lightweight target finalizations.
- `Dockerfile` supports both the default in-repo `app-runtime` flow and the CI external shared-base flow.
- `deploy/README.md` accurately describes the optimized publish pipeline.

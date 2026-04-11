# Docs Image Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated GHCR workflow for `z8-docs` and document the exact later deployment commands for the prepared docs Kubernetes resources.

**Architecture:** Reuse the existing root `Dockerfile` `docs` target and publish it through a standalone workflow that mirrors the repo's `publish-marketing-image` pattern. Keep deployment rollout out of scope and instead add operator-facing commands in `deploy/README.md` that point to the prepared manifests and verify `deployment/docs`, `service/docs`, and `ingress/docs` for `docs.z8-time.app`.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, YAML, Markdown, Kubernetes, pnpm

---

## File Structure

- Create: `.github/workflows/publish-docs-image.yml`
  Purpose: Build and publish `ghcr.io/umami-creative-gmbh/z8-docs` for `amd64` and `arm64`, then create multi-arch manifest tags.
- Modify: `deploy/README.md`
  Purpose: Document the new docs image and exact later `kubectl` apply and verification commands for the prepared docs deployment.

---

### Task 1: Add The Docs GHCR Publish Workflow

**Files:**
- Create: `.github/workflows/publish-docs-image.yml`

- [ ] **Step 1: Write the failing workflow test by checking that the file does not exist yet**

Run:

```bash
test -f .github/workflows/publish-docs-image.yml
```

Expected: command exits non-zero because the workflow file has not been created yet.

- [ ] **Step 2: Create the docs workflow using the marketing workflow shape and the docs Docker target**

Create `.github/workflows/publish-docs-image.yml` with this content:

```yaml
name: Publish Docs Image

on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: publish-docs-image-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-native:
    name: Build Native (${{ matrix.arch }})
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

      - name: Build and push docs image by digest
        id: build_docs
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: docs
          platforms: ${{ matrix.platform }}
          outputs: type=image,name=ghcr.io/umami-creative-gmbh/z8-docs,push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=docs-${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=docs-${{ matrix.arch }}

      - name: Export digest artifact
        env:
          DOCS_DIGEST: ${{ steps.build_docs.outputs.digest }}
        run: |
          mkdir -p /tmp/digests/docs
          touch "/tmp/digests/docs/${DOCS_DIGEST#sha256:}"

      - name: Upload docs digest
        uses: actions/upload-artifact@v4
        with:
          name: digests-docs-${{ matrix.arch }}
          path: /tmp/digests/docs/*
          if-no-files-found: error

  publish-manifest:
    name: Publish Manifest
    needs: build-native
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Download amd64 digest
        uses: actions/download-artifact@v4
        with:
          name: digests-docs-amd64
          path: /tmp/digests/amd64

      - name: Download arm64 digest
        uses: actions/download-artifact@v4
        with:
          name: digests-docs-arm64
          path: /tmp/digests/arm64

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/umami-creative-gmbh/z8-docs
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern=v{{version}}
            type=semver,pattern=v{{major}}.{{minor}}
            type=semver,pattern=v{{major}}

      - name: Create and push multi-arch manifests
        env:
          IMAGE_NAME: ghcr.io/umami-creative-gmbh/z8-docs
          TAGS: ${{ steps.meta.outputs.tags }}
        run: |
          set -euo pipefail

          set -- /tmp/digests/amd64/*
          AMD64_DIGEST="sha256:${1##*/}"

          set -- /tmp/digests/arm64/*
          ARM64_DIGEST="sha256:${1##*/}"

          for tag in $TAGS; do
            docker buildx imagetools create \
              -t "$tag" \
              "$IMAGE_NAME@$AMD64_DIGEST" \
              "$IMAGE_NAME@$ARM64_DIGEST"
          done
```

- [ ] **Step 3: Run a focused check to verify the new workflow file exists and references the expected image and target**

Run:

```bash
rg -n "Publish Docs Image|target: docs|ghcr.io/umami-creative-gmbh/z8-docs" .github/workflows/publish-docs-image.yml
```

Expected: matches for the workflow name, `target: docs`, and `ghcr.io/umami-creative-gmbh/z8-docs`.

- [ ] **Step 4: Commit the workflow change**

```bash
git add .github/workflows/publish-docs-image.yml
git commit -m "ci: publish docs image"
```

Expected: a commit containing only the new docs image workflow.

### Task 2: Document The Later Docs Deployment Commands

**Files:**
- Modify: `deploy/README.md`

- [ ] **Step 1: Write the failing doc test by confirming the README does not mention the docs image yet**

Run:

```bash
rg -n "z8-docs|deployment/docs|docs.z8-time.app" deploy/README.md
```

Expected: no matches.

- [ ] **Step 2: Update the deployment README to include the docs image and later apply commands**

Apply these edits to `deploy/README.md`:

1. Extend the container image table with a docs row:

```md
| `docs` | z8-docs | Next.js documentation site | Built from the root `Dockerfile` `docs` target |
```

2. Add the published docs image under the GHCR section:

```md
- `ghcr.io/umami-creative-gmbh/z8-docs`
```

3. Add a docs build example under "Build Individual Images":

```bash
docker build --target docs -t z8-docs:latest .
```

4. Add a new subsection after the existing Kubernetes deployment guidance with this content:

```md
### Docs App Deployment

The docs app is prepared for deployment through the manifests under `infra/hetzner-k8s/k8s` and is intentionally configured to run as a single replica.

Resources:

- `infra/hetzner-k8s/k8s/app/docs-deployment.yaml`
- `infra/hetzner-k8s/k8s/app/docs-service.yaml`
- `infra/hetzner-k8s/k8s/app/docs-ingress.yaml`

Image:

- `ghcr.io/umami-creative-gmbh/z8-docs`

When you are ready to roll it out:

```bash
kubectl apply -k infra/hetzner-k8s/k8s
kubectl rollout status deployment/docs -n app-prod --timeout=300s
kubectl get deployment docs -n app-prod
kubectl get service docs -n app-prod
kubectl get ingress docs -n app-prod
```

Expected host:

- `docs.z8-time.app`
```

- [ ] **Step 3: Run a focused check to verify the README now includes the docs image and rollout commands**

Run:

```bash
rg -n "z8-docs|deployment/docs|docs.z8-time.app|kubectl apply -k infra/hetzner-k8s/k8s" deploy/README.md
```

Expected: matches for all four strings.

- [ ] **Step 4: Commit the README update**

```bash
git add deploy/README.md
git commit -m "docs: add docs deployment instructions"
```

Expected: a commit containing only the deployment documentation update.

### Task 3: Verify The Prepared Publishing And Deployment Changes Together

**Files:**
- Verify: `.github/workflows/publish-docs-image.yml`
- Verify: `deploy/README.md`
- Verify: `Dockerfile`
- Verify: `docker-compose.prod.yml`
- Verify: `infra/hetzner-k8s/k8s/kustomization.yaml`
- Verify: `infra/hetzner-k8s/k8s/app/docs-deployment.yaml`
- Verify: `infra/hetzner-k8s/k8s/app/docs-service.yaml`
- Verify: `infra/hetzner-k8s/k8s/app/docs-ingress.yaml`

- [ ] **Step 1: Run repo-local verification commands**

Run:

```bash
pnpm build:docs
git diff --check
rg -n "ghcr.io/umami-creative-gmbh/z8-docs|target: docs|docs.z8-time.app|replicas: 1" .github/workflows/publish-docs-image.yml deploy/README.md Dockerfile docker-compose.prod.yml infra/hetzner-k8s/k8s/kustomization.yaml infra/hetzner-k8s/k8s/app/docs-deployment.yaml infra/hetzner-k8s/k8s/app/docs-service.yaml infra/hetzner-k8s/k8s/app/docs-ingress.yaml
```

Expected:

- `pnpm build:docs` succeeds
- `git diff --check` prints nothing
- `rg` matches the docs image name, Docker target, host, and single-replica deployment setting

- [ ] **Step 2: Run environment-dependent validation commands if the required tools are available**

Run:

```bash
docker compose -f docker-compose.prod.yml config
kubectl kustomize infra/hetzner-k8s/k8s
```

Expected: both commands succeed.

If either tool is missing, record that verification gap explicitly instead of claiming full validation.

- [ ] **Step 3: Commit any remaining prepared deployment files together if they are not already committed**

```bash
git add Dockerfile docker-compose.prod.yml infra/hetzner-k8s/k8s/kustomization.yaml infra/hetzner-k8s/k8s/app/docs-deployment.yaml infra/hetzner-k8s/k8s/app/docs-service.yaml infra/hetzner-k8s/k8s/app/docs-ingress.yaml .github/workflows/publish-docs-image.yml deploy/README.md
git commit -m "deploy: prepare docs app publishing and rollout"
```

Expected: a final commit exists for the prepared docs publishing and deployment changes, unless the task was intentionally split into earlier commits.

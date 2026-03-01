# Marketing Image Publish Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated GitHub Actions pipeline that builds and publishes a multi-arch Docker image for the marketing app to `ghcr.io/umami-creative-gmbh/z8-marketing` on `main`, semver tags, and manual dispatch.

**Architecture:** Add a dedicated `marketing` build target in the root `Dockerfile`, then create a separate workflow that mirrors the existing digest-based publish pattern: per-arch native builds push immutable digests, then a manifest job publishes multi-arch tags (`latest`, `sha-*`, semver). Keep this isolated from the existing publish workflow to minimize blast radius.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, `docker/build-push-action`, `docker/metadata-action`, pnpm monorepo, Next.js marketing app (`apps/marketing`).

---

### Task 1: Add Docker Build Support for Marketing App

**Files:**
- Modify: `Dockerfile`
- Test: `Dockerfile`

**Step 1: Add marketing prune/build/runtime stages**

Implement dedicated stages equivalent in structure to existing app targets:

- `RUN turbo prune marketing --docker`
- install deps for pruned workspace
- build with `pnpm --filter marketing exec next build`
- runtime stage copies `apps/marketing/.next`, `apps/marketing/public`, and required workspace files
- runtime command uses `pnpm start` from `apps/marketing`

Use target name `marketing` so CI can call `--target marketing`.

**Step 2: Build locally to validate target exists**

Run: `docker build --target marketing -t z8-marketing:local .`
Expected: PASS and image builds successfully.

**Step 3: Commit Dockerfile target change**

```bash
git add Dockerfile
git commit -m "build(docker): add marketing image target"
```

### Task 2: Create Dedicated Marketing Publish Workflow Skeleton

**Files:**
- Create: `.github/workflows/publish-marketing-image.yml`
- Test: `.github/workflows/publish-marketing-image.yml`

**Step 1: Add workflow metadata, triggers, permissions, and concurrency**

Include:

```yaml
name: Publish Marketing Image

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
  group: publish-marketing-image-${{ github.ref }}
  cancel-in-progress: true
```

**Step 2: Add a placeholder job and lint workflow syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-marketing-image.yml`
Expected: PASS with no syntax or action errors.

**Step 3: Commit workflow skeleton**

```bash
git add .github/workflows/publish-marketing-image.yml
git commit -m "ci: add marketing image workflow skeleton"
```

### Task 3: Implement Native Per-Architecture Digest Builds

**Files:**
- Modify: `.github/workflows/publish-marketing-image.yml`
- Test: `.github/workflows/publish-marketing-image.yml`

**Step 1: Add `build-native` matrix job for amd64 and arm64**

Include matrix entries:

- amd64 -> `linux/amd64` on `ubuntu-latest`
- arm64 -> `linux/arm64` on `ubuntu-24.04-arm`

Add steps for checkout, buildx setup, GHCR login, and build/push by digest:

```yaml
- name: Build and push marketing by digest
  id: build_marketing
  uses: docker/build-push-action@v6
  with:
    context: .
    file: ./Dockerfile
    target: marketing
    platforms: ${{ matrix.platform }}
    outputs: type=image,name=ghcr.io/umami-creative-gmbh/z8-marketing,push-by-digest=true,name-canonical=true,push=true
```

Export/upload digest artifact per architecture.

**Step 2: Validate syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-marketing-image.yml`
Expected: PASS.

**Step 3: Commit native build job**

```bash
git add .github/workflows/publish-marketing-image.yml
git commit -m "ci: add native digest builds for marketing image"
```

### Task 4: Publish Multi-Arch Manifest Tags

**Files:**
- Modify: `.github/workflows/publish-marketing-image.yml`
- Test: `.github/workflows/publish-marketing-image.yml`

**Step 1: Add `publish-manifest` job dependent on `build-native`**

Add steps to:

- download amd64/arm64 digest artifacts
- compute tags via `docker/metadata-action@v5`
- publish manifest list with both digests

Required tags:

```yaml
tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=sha,prefix=sha-
  type=semver,pattern=v{{version}}
  type=semver,pattern=v{{major}}.{{minor}}
  type=semver,pattern=v{{major}}
```

Use strict shell flags in manifest script (`set -euo pipefail`).

**Step 2: Validate syntax again**

Run: `pnpm dlx actionlint .github/workflows/publish-marketing-image.yml`
Expected: PASS.

**Step 3: Commit manifest publish job**

```bash
git add .github/workflows/publish-marketing-image.yml
git commit -m "ci: publish multi-arch marketing image manifests"
```

### Task 5: Verify End-to-End Behavior and Document Outcomes

**Files:**
- Test: `.github/workflows/publish-marketing-image.yml`
- Optional Modify: `docs/plans/2026-03-01-marketing-image-workflow-implementation.md`

**Step 1: Dry-run review of workflow delta**

Run: `git diff -- .github/workflows/publish-marketing-image.yml Dockerfile`
Expected: Only marketing Docker target and new workflow changes are present.

**Step 2: Trigger workflow on main (or `workflow_dispatch`)**

Run: trigger `Publish Marketing Image` in GitHub Actions.
Expected: `build-native` succeeds for both architectures; `publish-manifest` succeeds.

**Step 3: Verify published image and platforms**

Run:

```bash
docker buildx imagetools inspect ghcr.io/umami-creative-gmbh/z8-marketing:latest
```

Expected: Manifest includes both `linux/amd64` and `linux/arm64`.

**Step 4: Verify semver tags on release tag event**

Run: push tag `vX.Y.Z` and inspect GHCR tags.
Expected: `vX.Y.Z`, `vX.Y`, `vX`, and `sha-*` tags are present.

**Step 5: Commit verification notes if docs were updated**

```bash
git add docs/plans/2026-03-01-marketing-image-workflow-implementation.md
git commit -m "docs(ci): record marketing image publish verification"
```

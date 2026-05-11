# GHCR Publish Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub Actions workflow that builds and publishes `webapp`, `worker`, and `migration` Docker images to GHCR with `latest`, `sha-*`, and semver tags.

**Architecture:** Use a single workflow with two jobs: `build-check` (pnpm build gate) and `publish-images` (Docker Buildx multi-arch publish). Keep the pipeline minimal, deterministic, and traceable by pushing immutable SHA tags plus release semver tags. Publish only from `main` and semver tags, with manual dispatch available.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, `docker/metadata-action`, pnpm, existing root `Dockerfile` targets (`webapp`, `worker`, `migration`).

---

### Task 1: Create Workflow Skeleton and Validate Triggers

**Files:**
- Create: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Add minimal workflow skeleton**

```yaml
name: Publish Images

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
  group: publish-images-${{ github.ref }}
  cancel-in-progress: true

jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Workflow skeleton ready"
```

**Step 2: Validate workflow syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS with no lint errors.

**Step 3: Commit skeleton**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: add GHCR publish workflow skeleton"
```

### Task 2: Add Build Gate Job

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Replace `noop` with `build-check` job**

```yaml
jobs:
  build-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build webapp gate
        run: pnpm build:webapp
```

**Step 2: Validate workflow syntax again**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS.

**Step 3: Commit build gate**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: add webapp build gate before publish"
```

### Task 3: Add GHCR Publish Job Base (Buildx + Login)

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Add `publish-images` job with dependency on `build-check`**

```yaml
  publish-images:
    runs-on: ubuntu-latest
    needs: build-check
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Validate syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS.

**Step 3: Commit publish job base**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: add GHCR publish job base"
```

### Task 4: Add Webapp Image Metadata and Push Step

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Add metadata step for webapp tags**

```yaml
      - name: Docker metadata (webapp)
        id: meta_webapp
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/umami-creative-gmbh/z8-webapp
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
```

**Step 2: Add webapp build/push step (multi-arch)**

```yaml
      - name: Build and push webapp
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: webapp
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta_webapp.outputs.tags }}
          labels: ${{ steps.meta_webapp.outputs.labels }}
```

**Step 3: Validate syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS.

**Step 4: Commit webapp publish logic**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: publish webapp image to GHCR"
```

### Task 5: Add Worker and Migration Image Publish Steps

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Add worker metadata + build/push steps**

```yaml
      - name: Docker metadata (worker)
        id: meta_worker
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/umami-creative-gmbh/z8-worker
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - name: Build and push worker
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: worker
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta_worker.outputs.tags }}
          labels: ${{ steps.meta_worker.outputs.labels }}
```

**Step 2: Add migration metadata + build/push steps**

```yaml
      - name: Docker metadata (migration)
        id: meta_migration
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/umami-creative-gmbh/z8-migration
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - name: Build and push migration
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          target: migration
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta_migration.outputs.tags }}
          labels: ${{ steps.meta_migration.outputs.labels }}
```

**Step 3: Validate syntax**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS.

**Step 4: Commit worker and migration publishing**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: publish worker and migration images to GHCR"
```

### Task 6: Add Branch/Tag Safety Conditions and Final Verification

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Test: `.github/workflows/publish-images.yml`

**Step 1: Ensure `latest` only comes from default branch**

Confirm all `metadata-action` blocks include:

```yaml
type=raw,value=latest,enable={{is_default_branch}}
```

**Step 2: Validate workflow syntax one final time**

Run: `pnpm dlx actionlint .github/workflows/publish-images.yml`
Expected: PASS.

**Step 3: Run git diff review to verify scope**

Run: `git diff -- .github/workflows/publish-images.yml`
Expected: Only the new workflow file content changes.

**Step 4: Commit final hardening**

```bash
git add .github/workflows/publish-images.yml
git commit -m "ci: finalize GHCR tagging and publish safety rules"
```

### Task 7: Manual Runtime Verification After Merge

**Files:**
- Test: `.github/workflows/publish-images.yml`

**Step 1: Trigger main branch run**

Run: push to `main` (or use `workflow_dispatch` on `main`).
Expected: `build-check` passes, publish job pushes all three images.

**Step 2: Verify GHCR tags from main run**

Check GHCR repos for:

- `ghcr.io/umami-creative-gmbh/z8-webapp:latest`
- `ghcr.io/umami-creative-gmbh/z8-worker:latest`
- `ghcr.io/umami-creative-gmbh/z8-migration:latest`
- matching `sha-*` tags for each image

Expected: Tags exist and point to newly built manifests.

**Step 3: Trigger semver release run**

Run: push tag `v1.0.0`.
Expected: semver tags are published for each image (`v1.0.0`, `v1.0`, `v1`) plus `sha-*`.

**Step 4: Pull smoke test**

```bash
docker pull ghcr.io/umami-creative-gmbh/z8-webapp:latest
docker pull ghcr.io/umami-creative-gmbh/z8-worker:latest
docker pull ghcr.io/umami-creative-gmbh/z8-migration:latest
```

Expected: Pull succeeds for all three images.

**Step 5: Commit (if any verification doc updates were made)**

```bash
git add <only-doc-files-if-updated>
git commit -m "docs: record GHCR workflow verification results"
```

# Package Lock Sync Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pull-request GitHub Actions check that verifies root workspace and Docker target package/lock files are in sync before merge.

**Architecture:** Add one focused workflow under `.github/workflows` that uses pnpm's native frozen install for the root workspace and the existing `pnpm docker:sync:non-web-targets` generator for Docker targets. The workflow fails on any resulting diff in known package, workspace config, or lockfile paths.

**Tech Stack:** GitHub Actions, pnpm 11, Node.js 24, existing `docker:sync:non-web-targets` script.

---

## File Structure

- Create `.github/workflows/check-package-lock-sync.yml`: pull-request workflow that installs pnpm, verifies the root lockfile with `pnpm install --frozen-lockfile`, regenerates Docker target manifests/lockfiles, and fails on stale generated files.
- Keep `docs/superpowers/specs/2026-05-26-package-lock-sync-check-design.md`: approved design context.
- Keep this plan at `docs/superpowers/plans/2026-05-26-package-lock-sync-check.md`: execution checklist.

## Task 1: Add Package Lock Sync Workflow

**Files:**
- Create: `.github/workflows/check-package-lock-sync.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/check-package-lock-sync.yml` with this content:

```yaml
name: Check Package Lock Sync

on:
  pull_request:
    branches:
      - main
    paths:
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "apps/**/package.json"
      - "packages/**/package.json"
      - "docker/targets/**/package.json"
      - "docker/targets/**/pnpm-lock.yaml"
      - "docker/targets/**/pnpm-workspace.yaml"
      - "docker/scripts/**"
      - ".github/workflows/check-package-lock-sync.yml"

permissions:
  contents: read

concurrency:
  group: check-package-lock-sync-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check-package-lock-sync:
    name: Check Package Lock Sync
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Set up pnpm
        uses: pnpm/action-setup@f0950f56a12b43e60c9bd5b01d57bc3dfb4b235d # v4.1.0
        with:
          package_json_file: package.json

      - name: Set up Node.js
        uses: actions/setup-node@b4ffde65f46336ab88eb53be808477a3936bae11 # v6.0.0
        with:
          node-version: 24
          cache: pnpm

      - name: Verify root lockfile
        run: pnpm install --frozen-lockfile

      - name: Regenerate Docker target package files
        run: pnpm docker:sync:non-web-targets

      - name: Verify generated package files are committed
        run: |
          set -euo pipefail

          if ! git diff --exit-code -- \
            package.json \
            pnpm-lock.yaml \
            pnpm-workspace.yaml \
            docker/targets/worker/package.json \
            docker/targets/worker/pnpm-lock.yaml \
            docker/targets/worker/pnpm-workspace.yaml \
            docker/targets/migration/package.json \
            docker/targets/migration/pnpm-lock.yaml \
            docker/targets/migration/pnpm-workspace.yaml \
            docker/targets/db-seed/package.json \
            docker/targets/db-seed/pnpm-lock.yaml \
            docker/targets/db-seed/pnpm-workspace.yaml; then
            echo "::error::Package files or lockfiles are stale. Run 'pnpm docker:sync:non-web-targets' and commit the generated changes."
            exit 1
          fi
```

- [ ] **Step 2: Check workflow syntax by reading the file**

Run: `pnpm node -e "const fs=require('node:fs'); const text=fs.readFileSync('.github/workflows/check-package-lock-sync.yml','utf8'); for (const required of ['on:', 'pull_request:', 'pnpm install --frozen-lockfile', 'pnpm docker:sync:non-web-targets', 'git diff --exit-code']) { if (!text.includes(required)) throw new Error('missing '+required); } console.log('workflow content check passed');"`

Expected: PASS with `workflow content check passed`.

- [ ] **Step 3: Verify root lockfile locally**

Run: `pnpm install --frozen-lockfile`

Expected: PASS. If this fails, inspect the pnpm error; do not edit dependencies unless the error says the committed root lockfile is stale.

- [ ] **Step 4: Regenerate Docker target package files locally**

Run: `pnpm docker:sync:non-web-targets`

Expected: PASS. The command may print `wrote docker/targets/.../package.json` for generated manifests.

- [ ] **Step 5: Verify no package or lockfile drift remains**

Run: `git diff --exit-code -- package.json pnpm-lock.yaml pnpm-workspace.yaml docker/targets/worker/package.json docker/targets/worker/pnpm-lock.yaml docker/targets/worker/pnpm-workspace.yaml docker/targets/migration/package.json docker/targets/migration/pnpm-lock.yaml docker/targets/migration/pnpm-workspace.yaml docker/targets/db-seed/package.json docker/targets/db-seed/pnpm-lock.yaml docker/targets/db-seed/pnpm-workspace.yaml`

Expected: PASS with no diff. If this fails, inspect the diff; stale generated target files should be kept and reported in the final response as additional changes caused by the sync command.

- [ ] **Step 6: Inspect final worktree diff**

Run: `git diff -- .github/workflows/check-package-lock-sync.yml docs/superpowers/specs/2026-05-26-package-lock-sync-check-design.md docs/superpowers/plans/2026-05-26-package-lock-sync-check.md package.json pnpm-lock.yaml pnpm-workspace.yaml docker/targets/worker/package.json docker/targets/worker/pnpm-lock.yaml docker/targets/worker/pnpm-workspace.yaml docker/targets/migration/package.json docker/targets/migration/pnpm-lock.yaml docker/targets/migration/pnpm-workspace.yaml docker/targets/db-seed/package.json docker/targets/db-seed/pnpm-lock.yaml docker/targets/db-seed/pnpm-workspace.yaml`

Expected: diff shows the new workflow plus the spec and plan files. It should not show package or lockfile changes unless Step 4 found real stale generated output.

- [ ] **Step 7: Commit only if explicitly requested**

If the user explicitly asks for a commit, run these commands after inspecting `git status` and the full diff:

```bash
git add .github/workflows/check-package-lock-sync.yml docs/superpowers/specs/2026-05-26-package-lock-sync-check-design.md docs/superpowers/plans/2026-05-26-package-lock-sync-check.md
git commit -m "ci: check package lock sync before merge"
```

If Step 4 produced package or lockfile changes, include only those generated files that are part of this task after confirming their diff.

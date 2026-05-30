# PR Vitest Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions PR check that runs `pnpm test` and reports the result in the Actions step summary.

**Architecture:** Create one focused workflow file, `.github/workflows/tests.yml`, following the existing workflow conventions for pinned actions, pnpm setup, Node 24, caching, permissions, and concurrency. The test step wraps `pnpm test` so the workflow summary records pass or fail while preserving the command's exit code.

**Tech Stack:** GitHub Actions, pnpm 11.4.0 from `package.json`, Node.js 24, Turbo test pipeline, Vitest package test scripts.

---

## File Structure

- Create: `.github/workflows/tests.yml` - PR workflow responsible for installing dependencies, running `pnpm test`, and writing a concise GitHub Actions summary.
- Reference: `package.json` - confirms `pnpm test` is the documented root test command.
- Reference: `.github/workflows/biome.yml` - source of existing setup pattern for pinned checkout, pnpm, Node 24, cache, and install.
- Reference: `.github/workflows/check-package-lock-sync.yml` - source of existing package-path trigger conventions.

### Task 1: Add PR Test Workflow

**Files:**
- Create: `.github/workflows/tests.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/tests.yml` with exactly this content:

```yaml
name: Tests

on:
  pull_request:
    branches:
      - main
    paths:
      - "apps/**"
      - "packages/**"
      - "docker/scripts/**"
      - "docker/Dockerfile.*"
      - "docker/targets/**"
      - "infra/hetzner-k8s/k8s/app/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
      - ".github/workflows/tests.yml"

permissions:
  contents: read

concurrency:
  group: tests-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  tests:
    name: Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Set up pnpm
        uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
        with:
          package_json_file: package.json

      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: |
          set +e
          pnpm test
          status=$?

          {
            echo "## Test Results"
            echo ""
            echo "Command: \`pnpm test\`"
            echo ""
            if [ "$status" -eq 0 ]; then
              echo "Result: passed"
            else
              echo "Result: failed"
            fi
          } >> "$GITHUB_STEP_SUMMARY"

          exit "$status"
```

- [ ] **Step 2: Inspect the workflow syntax**

Run: `git diff -- .github/workflows/tests.yml`

Expected: The diff shows one new workflow file. Check indentation is two spaces, the pinned action SHAs match existing workflows, and the `Run tests` step exits with the original `pnpm test` status.

- [ ] **Step 3: Run the CI command locally**

Run: `pnpm test`

Expected: The command completes successfully with exit code `0`. If it fails, inspect the failing test output and decide whether the failure is caused by this workflow change. This workflow change should not alter runtime or test code.

- [ ] **Step 4: Review changed files**

Run: `git diff --stat && git diff -- .github/workflows/tests.yml docs/superpowers/specs/2026-05-30-pr-vitest-workflow-design.md docs/superpowers/plans/2026-05-30-pr-vitest-workflow.md`

Expected: The only implementation file change is `.github/workflows/tests.yml`; the spec and plan documents are present if this planning workflow is being kept.

- [ ] **Step 5: Commit if requested by the user**

Only run this step if the user explicitly asks for a commit.

```bash
git add .github/workflows/tests.yml docs/superpowers/specs/2026-05-30-pr-vitest-workflow-design.md docs/superpowers/plans/2026-05-30-pr-vitest-workflow.md
git commit -m "ci: add pull request test workflow"
```

Expected: Git creates a commit containing the workflow and planning documents.

## Self-Review

- Spec coverage: The plan creates `.github/workflows/tests.yml`, runs on PRs to `main`, filters test-relevant paths including Docker scripts, Dockerfiles, Docker target files, and infra app manifests, uses Node 24 and pnpm, installs with `--frozen-lockfile`, runs `pnpm test`, and writes pass/fail output to `$GITHUB_STEP_SUMMARY`.
- Placeholder scan: No placeholders remain. The workflow content, commands, paths, and expected outcomes are explicit.
- Type and name consistency: The workflow name, job name, file path, command, and concurrency group are consistent across tasks.

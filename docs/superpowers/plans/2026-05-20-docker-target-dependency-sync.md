# Docker Target Dependency Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail local tests when generated Docker target manifests drift from traced webapp dependencies.

**Architecture:** Extend `docker/scripts/prepare-target-runtime.mjs` with a `check` command that regenerates target manifests, compares generated files with committed files, restores originals, and reports actionable sync guidance. Add node:test coverage in `docker/scripts/prepare-target-runtime.test.mjs` so `pnpm test` enforces current target manifests.

**Tech Stack:** Node.js ESM, `node:test`, `assert/strict`, pnpm scripts.

---

### Task 1: Add Drift Detection Coverage

**Files:**
- Modify: `docker/scripts/prepare-target-runtime.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that temporarily stale `docker/targets/migration/package.json`, run `prepare-target-runtime.mjs check migration`, expect a failure mentioning `pnpm docker:sync:non-web-targets`, restore the file, then verify `check worker migration db-seed` succeeds for committed files.

- [ ] **Step 2: Run targeted tests**

Run: `node --test docker/scripts/prepare-target-runtime.test.mjs`

Expected: fails because `check` command is not implemented yet.

### Task 2: Implement Check Command

**Files:**
- Modify: `docker/scripts/prepare-target-runtime.mjs`

- [ ] **Step 1: Add manifest drift check helper**

Implement a helper that stores original `package.json` and `pnpm-workspace.yaml`, calls the existing manifest writer, reads generated files, restores originals, and throws if any generated file differs.

- [ ] **Step 2: Wire CLI command**

Add `check` to the CLI usage and dispatch so tests and developers can run `pnpm node docker/scripts/prepare-target-runtime.mjs check worker migration db-seed`.

- [ ] **Step 3: Run targeted tests**

Run: `node --test docker/scripts/prepare-target-runtime.test.mjs`

Expected: all Docker runtime tests pass.

### Task 3: Verify End-to-End

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full tests**

Run: `pnpm test`

Expected: full project test suite passes, including the new Docker target drift checks.

- [ ] **Step 2: Inspect git diff**

Run: `git diff --stat && git status --short`

Expected: only the plan, Docker runtime script, and test file changed.

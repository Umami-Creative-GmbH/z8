# Webapp Biome PR Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions pull request workflow that runs Biome CI against `apps/webapp/src` only.

**Architecture:** Create one PR-only workflow file under `.github/workflows`. The job follows existing repository workflow conventions: pinned checkout/setup actions, `pnpm`, Node 24, read-only permissions, concurrency cancellation, and a frozen lockfile install before running the app-local Biome binary.

**Tech Stack:** GitHub Actions, pnpm 11.4.0, Node.js 24, Biome 2.4.16.

---

### Task 1: Add Webapp Biome Workflow

**Files:**
- Create: `.github/workflows/biome.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Biome

on:
  pull_request:
    branches:
      - main
    paths:
      - "apps/webapp/src/**"
      - ".github/workflows/biome.yml"

permissions:
  contents: read

concurrency:
  group: biome-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  biome:
    name: Biome
    runs-on: ubuntu-latest
    timeout-minutes: 10

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

      - name: Run Biome
        working-directory: apps/webapp
        run: pnpm exec biome ci src
```

- [ ] **Step 2: Verify workflow syntax and local command viability**

Run: `pnpm --dir apps/webapp exec biome ci src`

Expected: Biome runs against `apps/webapp/src`. Existing source diagnostics may fail this command, but the command must resolve the local Biome binary and target the intended directory.

- [ ] **Step 3: Inspect git diff**

Run: `git diff -- .github/workflows/biome.yml docs/superpowers/plans/2026-05-30-webapp-biome-pr-workflow.md`
Expected: Diff contains the new workflow and this plan only.

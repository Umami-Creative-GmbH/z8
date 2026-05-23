# GitHub Actions Image Change Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only publish GHCR images for changed surfaces on `main` pushes while preserving full tag/manual builds.

**Architecture:** Add workflow-level `push.paths` filters to the publishing workflows and extend the existing workflow contract scripts to assert those filters.

**Tech Stack:** GitHub Actions YAML, Node.js ESM verifier scripts, pnpm.

---

## File Structure

- Modify `.github/workflows/publish-images.yml`: add app-runtime path filters to the `push` trigger.
- Modify `.github/workflows/publish-marketing-image.yml`: add marketing-specific path filters to the `push` trigger.
- Modify `.github/workflows/publish-docs-image.yml`: add docs-specific path filters to the `push` trigger.
- Modify `scripts/ci/verify-publish-images-workflow.mjs`: assert the app-runtime path filter contract.
- Modify `scripts/ci/verify-publish-marketing-image-workflow.mjs`: assert the marketing path filter contract.
- Modify `scripts/ci/verify-publish-docs-image-workflow.mjs`: assert the docs path filter contract.

---

### Task 1: Add Workflow Contract Tests For Path Filters

**Files:**
- Modify: `scripts/ci/verify-publish-images-workflow.mjs`
- Modify: `scripts/ci/verify-publish-marketing-image-workflow.mjs`
- Modify: `scripts/ci/verify-publish-docs-image-workflow.mjs`

- [ ] **Step 1: Add path filter assertions to the app-runtime verifier**

In `scripts/ci/verify-publish-images-workflow.mjs`, add this helper after `includesAll`:

```js
function expectPushPathFilters(expectedPaths) {
	includesAll(
		workflow,
		[
			"  push:",
			"    branches:",
			"      - main",
			"    tags:",
			'      - "v*.*.*"',
			"    paths:"
		],
		"push trigger path filters"
	);

	for (const expectedPath of expectedPaths) {
		expect(workflow.includes(`      - "${expectedPath}"`), `push trigger paths missing: ${expectedPath}`);
	}
}
```

Then add this call after the job existence `expect(...)` block:

```js
expectPushPathFilters([
	"apps/webapp/**",
	"docker/Dockerfile.webapp",
	"docker/Dockerfile.webapp.dockerignore",
	"docker/Dockerfile.worker",
	"docker/Dockerfile.worker.dockerignore",
	"docker/Dockerfile.migration",
	"docker/Dockerfile.migration.dockerignore",
	"docker/scripts/**",
	"docker/targets/**",
	"packages/**",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json"
]);
```

- [ ] **Step 2: Add path filter assertions to the marketing verifier**

In `scripts/ci/verify-publish-marketing-image-workflow.mjs`, add this helper after `includesAll`:

```js
function expectPushPathFilters(expectedPaths) {
	includesAll(
		workflow,
		[
			"  push:",
			"    branches:",
			"      - main",
			"    tags:",
			'      - "v*.*.*"',
			"    paths:"
		],
		"push trigger path filters"
	);

	for (const expectedPath of expectedPaths) {
		expect(workflow.includes(`      - "${expectedPath}"`), `push trigger paths missing: ${expectedPath}`);
	}
}
```

Then add this call after the job existence `expect(...)` block:

```js
expectPushPathFilters([
	"apps/marketing/**",
	"docker/Dockerfile.marketing",
	"docker/Dockerfile.marketing.dockerignore",
	"packages/**",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json"
]);
```

- [ ] **Step 3: Add path filter assertions to the docs verifier**

In `scripts/ci/verify-publish-docs-image-workflow.mjs`, add this helper after `includesAll`:

```js
function expectPushPathFilters(expectedPaths) {
	includesAll(
		workflow,
		[
			"  push:",
			"    branches:",
			"      - main",
			"    tags:",
			'      - "v*.*.*"',
			"    paths:"
		],
		"push trigger path filters"
	);

	for (const expectedPath of expectedPaths) {
		expect(workflow.includes(`      - "${expectedPath}"`), `push trigger paths missing: ${expectedPath}`);
	}
}
```

Then add this call after the job existence `expect(...)` block:

```js
expectPushPathFilters([
	"apps/docs/**",
	"docker/Dockerfile.docs",
	"docker/Dockerfile.docs.dockerignore",
	"packages/**",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json"
]);
```

- [ ] **Step 4: Run the app-runtime verifier and confirm it fails**

Run: `node scripts/ci/verify-publish-images-workflow.mjs`

Expected: FAIL with at least `push trigger path filters missing:     paths:` or `push trigger paths missing: apps/webapp/**`.

- [ ] **Step 5: Run the dedicated image verifiers and confirm they fail**

Run: `node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs`

Expected: FAIL on the first verifier with missing `paths` assertions. If using separate commands, each verifier should fail before workflow YAML is updated.

---

### Task 2: Add Workflow Path Filters

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/publish-marketing-image.yml`
- Modify: `.github/workflows/publish-docs-image.yml`

- [ ] **Step 1: Add app-runtime path filters**

In `.github/workflows/publish-images.yml`, replace the current `on.push` block with:

```yaml
on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
    paths:
      - "apps/webapp/**"
      - "docker/Dockerfile.webapp"
      - "docker/Dockerfile.webapp.dockerignore"
      - "docker/Dockerfile.worker"
      - "docker/Dockerfile.worker.dockerignore"
      - "docker/Dockerfile.migration"
      - "docker/Dockerfile.migration.dockerignore"
      - "docker/scripts/**"
      - "docker/targets/**"
      - "packages/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
  workflow_dispatch:
```

- [ ] **Step 2: Add marketing path filters**

In `.github/workflows/publish-marketing-image.yml`, replace the current `on.push` block with:

```yaml
on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
    paths:
      - "apps/marketing/**"
      - "docker/Dockerfile.marketing"
      - "docker/Dockerfile.marketing.dockerignore"
      - "packages/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
  workflow_dispatch:
```

- [ ] **Step 3: Add docs path filters**

In `.github/workflows/publish-docs-image.yml`, replace the current `on.push` block with:

```yaml
on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
    paths:
      - "apps/docs/**"
      - "docker/Dockerfile.docs"
      - "docker/Dockerfile.docs.dockerignore"
      - "packages/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
  workflow_dispatch:
```

- [ ] **Step 4: Run all workflow verifier scripts**

Run: `node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs`

Expected: PASS with these lines:

```text
Publish images workflow contract OK
Publish marketing image workflow contract OK
Publish docs image workflow contract OK
```

- [ ] **Step 5: Commit workflow trigger changes**

```bash
git add .github/workflows/publish-images.yml .github/workflows/publish-marketing-image.yml .github/workflows/publish-docs-image.yml scripts/ci/verify-publish-images-workflow.mjs scripts/ci/verify-publish-marketing-image-workflow.mjs scripts/ci/verify-publish-docs-image-workflow.mjs
git commit -m "ci: filter image publishing workflows by changed files"
```

---

### Task 3: Final Verification

**Files:**
- Verify: workflow files and verifier scripts

- [ ] **Step 1: Run workflow contract verifiers**

Run: `node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs`

Expected: PASS with all three `workflow contract OK` messages.

- [ ] **Step 2: Inspect final diff**

Run: `git diff -- .github/workflows scripts/ci docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md docs/superpowers/plans/2026-05-10-gha-image-change-filters.md`

Expected: Diff only contains workflow path filters, verifier assertions, and the approved spec/plan docs.

- [ ] **Step 3: Commit plan document if not already committed**

```bash
git add docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md docs/superpowers/plans/2026-05-10-gha-image-change-filters.md
git commit -m "docs: plan image workflow path filters"
```

---

## Self-Review

- Spec coverage: Task 1 and Task 2 cover workflow path filters and verifier updates. Task 3 covers final verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: workflow path filter examples match the existing image workflow and verifier script contracts.

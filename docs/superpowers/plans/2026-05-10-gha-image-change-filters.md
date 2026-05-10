# GitHub Actions Image Change Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only publish GHCR images for changed surfaces on `main` pushes while preserving full tag/manual builds and changed-surface deploy-webhook behavior.

**Architecture:** Add workflow-level `push.paths` filters to the four publishing workflows and extend the existing workflow contract scripts to assert those filters. Preserve deploy-webhook’s current independent group behavior by adding regression tests, not new deployment state or path-detection code.

**Tech Stack:** GitHub Actions YAML, Node.js ESM verifier scripts, Vitest, pnpm.

---

## File Structure

- Modify `.github/workflows/publish-images.yml`: add app-runtime path filters to the `push` trigger.
- Modify `.github/workflows/publish-marketing-image.yml`: add marketing-specific path filters to the `push` trigger.
- Modify `.github/workflows/publish-docs-image.yml`: add docs-specific path filters to the `push` trigger.
- Modify `.github/workflows/publish-deploy-webhook-image.yml`: add deploy-webhook-specific path filters to the `push` trigger.
- Modify `scripts/ci/verify-publish-images-workflow.mjs`: assert the app-runtime path filter contract.
- Modify `scripts/ci/verify-publish-marketing-image-workflow.mjs`: assert the marketing path filter contract.
- Modify `scripts/ci/verify-publish-docs-image-workflow.mjs`: assert the docs path filter contract.
- Modify `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`: assert the deploy-webhook path filter contract.
- Modify `apps/deploy-webhook/src/reconciler.test.ts`: add explicit regression tests that docs and marketing deploy independently and app runtime still waits for its three package tags.

---

### Task 1: Add Workflow Contract Tests For Path Filters

**Files:**
- Modify: `scripts/ci/verify-publish-images-workflow.mjs`
- Modify: `scripts/ci/verify-publish-marketing-image-workflow.mjs`
- Modify: `scripts/ci/verify-publish-docs-image-workflow.mjs`
- Modify: `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

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

- [ ] **Step 4: Add path filter assertions to the deploy-webhook verifier**

In `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`, add this helper after `includesAll`:

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
	"apps/deploy-webhook/**",
	"docker/Dockerfile.deploy-webhook",
	"packages/**",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json"
]);
```

- [ ] **Step 5: Run the app-runtime verifier and confirm it fails**

Run: `node scripts/ci/verify-publish-images-workflow.mjs`

Expected: FAIL with at least `push trigger path filters missing:     paths:` or `push trigger paths missing: apps/webapp/**`.

- [ ] **Step 6: Run the dedicated image verifiers and confirm they fail**

Run: `node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs && node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

Expected: FAIL on the first verifier with missing `paths` assertions. If using separate commands, each verifier should fail before workflow YAML is updated.

---

### Task 2: Add Workflow Path Filters

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/publish-marketing-image.yml`
- Modify: `.github/workflows/publish-docs-image.yml`
- Modify: `.github/workflows/publish-deploy-webhook-image.yml`

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

- [ ] **Step 4: Add deploy-webhook path filters**

In `.github/workflows/publish-deploy-webhook-image.yml`, replace the current `on.push` block with:

```yaml
on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
    paths:
      - "apps/deploy-webhook/**"
      - "docker/Dockerfile.deploy-webhook"
      - "packages/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
  workflow_dispatch:
```

- [ ] **Step 5: Run all workflow verifier scripts**

Run: `node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs && node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

Expected: PASS with these lines:

```text
Publish images workflow contract OK
Publish marketing image workflow contract OK
Publish docs image workflow contract OK
Publish deploy webhook image workflow contract OK
```

- [ ] **Step 6: Commit workflow trigger changes**

```bash
git add .github/workflows/publish-images.yml .github/workflows/publish-marketing-image.yml .github/workflows/publish-docs-image.yml .github/workflows/publish-deploy-webhook-image.yml scripts/ci/verify-publish-images-workflow.mjs scripts/ci/verify-publish-marketing-image-workflow.mjs scripts/ci/verify-publish-docs-image-workflow.mjs scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs
git commit -m "ci: filter image publishing workflows by changed files"
```

---

### Task 3: Add Deploy Webhook Changed-Surface Regression Tests

**Files:**
- Modify: `apps/deploy-webhook/src/reconciler.test.ts`

- [ ] **Step 1: Add docs-only regression test**

In `apps/deploy-webhook/src/reconciler.test.ts`, add this test after `rolls out docs independently when the registry tag exists`:

```ts
  it("deploys docs without requiring app or marketing tags for the same commit", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-docs", "sha-docs123", "2026-05-08T10:00:00.000Z"));

    expect(dependencies.calls).toEqual([
      "hasTag:z8-docs:sha-docs123",
      "set:docs/docs:ghcr.io/umami-creative-gmbh/z8-docs:sha-docs123",
      "wait:docs:60000"
    ]);
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-webapp", "sha-docs123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-worker", "sha-docs123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-migration", "sha-docs123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-marketing", "sha-docs123");
  });
```

- [ ] **Step 2: Add marketing-only regression test**

In `apps/deploy-webhook/src/reconciler.test.ts`, add this test after `rolls out marketing independently`:

```ts
  it("deploys marketing without requiring app or docs tags for the same commit", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-marketing", "sha-market123", "2026-05-08T10:00:00.000Z"));

    expect(dependencies.calls).toEqual([
      "hasTag:z8-marketing:sha-market123",
      "set:marketing/marketing:ghcr.io/umami-creative-gmbh/z8-marketing:sha-market123",
      "wait:marketing:60000"
    ]);
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-webapp", "sha-market123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-worker", "sha-market123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-migration", "sha-market123");
    expect(dependencies.registry.hasTag).not.toHaveBeenCalledWith("z8-docs", "sha-market123");
  });
```

- [ ] **Step 3: Add app-runtime wait regression test**

In `apps/deploy-webhook/src/reconciler.test.ts`, add this test after `records app observations and waits for all app package tags before rollout`:

```ts
  it("does not deploy app runtime until webapp worker and migration share the same tag", async () => {
    const dependencies = createDependencies({
      observed: { "sha-app123": ["z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-webapp", "sha-app123", "2026-05-08T10:00:00.000Z"));

    expect(dependencies.registry.hasTag).not.toHaveBeenCalled();
    expect(dependencies.kube.runMigration).not.toHaveBeenCalled();
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
    expect(dependencies.kube.waitForDeploymentRollout).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run deploy-webhook tests**

Run: `pnpm --filter deploy-webhook test -- src/reconciler.test.ts`

Expected: PASS for `src/reconciler.test.ts`.

- [ ] **Step 5: Commit deploy-webhook regression tests**

```bash
git add apps/deploy-webhook/src/reconciler.test.ts
git commit -m "test: cover changed-surface deploy webhook behavior"
```

---

### Task 4: Final Verification

**Files:**
- Verify: workflow files, verifier scripts, deploy-webhook tests

- [ ] **Step 1: Run workflow contract verifiers**

Run: `node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-marketing-image-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs && node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

Expected: PASS with all four `workflow contract OK` messages.

- [ ] **Step 2: Run deploy-webhook tests**

Run: `pnpm --filter deploy-webhook test -- src/reconciler.test.ts`

Expected: PASS for `src/reconciler.test.ts`.

- [ ] **Step 3: Run full deploy-webhook package tests**

Run: `pnpm --filter deploy-webhook test`

Expected: PASS for all deploy-webhook Vitest suites.

- [ ] **Step 4: Inspect final diff**

Run: `git diff -- .github/workflows scripts/ci apps/deploy-webhook/src/reconciler.test.ts docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md docs/superpowers/plans/2026-05-10-gha-image-change-filters.md`

Expected: Diff only contains workflow path filters, verifier assertions, deploy-webhook regression tests, and the approved spec/plan docs.

- [ ] **Step 5: Commit plan document if not already committed**

```bash
git add docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md docs/superpowers/plans/2026-05-10-gha-image-change-filters.md
git commit -m "docs: plan image workflow path filters"
```

---

## Self-Review

- Spec coverage: Task 1 and Task 2 cover workflow path filters and verifier updates. Task 3 covers changed-surface deploy-webhook behavior. Task 4 covers final verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Test snippets use existing `ImageObservation` package names, existing `createDependencies`, existing `appObservation`, and existing `Reconciler` APIs.

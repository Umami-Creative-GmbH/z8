# Remove Deploy Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete `deploy-webhook` app and all source-controlled references to it.

**Architecture:** Delete the unused workspace package, Dockerfile, GitHub Actions workflow, and CI verifier rather than replacing them with stubs. Update the lockfile and the one Docker fixture test that still enumerates the deleted Dockerfile. Remove source-controlled planning/spec references so searches no longer report deploy-webhook outside this removal spec and plan.

**Tech Stack:** pnpm workspace, Turborepo, GitHub Actions YAML, Node.js `node:test`.

---

## File Structure

- Delete: `apps/deploy-webhook/` - obsolete Node/TypeScript webhook service package.
- Delete: `docker/Dockerfile.deploy-webhook` - obsolete image build definition.
- Delete: `.github/workflows/publish-deploy-webhook-image.yml` - obsolete GHCR publish workflow.
- Delete: `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs` - obsolete workflow contract verifier.
- Modify: `docker/scripts/prepare-target-runtime.test.mjs` - remove the deleted Dockerfile from the static Dockerfile fixture list.
- Modify: `pnpm-lock.yaml` - remove `apps/deploy-webhook` importer and dependency-only lock entries that become unused.
- Delete: `docs/superpowers/specs/2026-05-08-k8s-image-webhook-rollout-design.md` - obsolete deploy-webhook design archive.
- Delete: `docs/superpowers/plans/2026-05-08-k8s-image-webhook-rollout.md` - obsolete deploy-webhook implementation plan archive.
- Modify or delete: `docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md` - remove deploy-webhook references or delete if it only documents obsolete deploy-webhook behavior.
- Modify or delete: `docs/superpowers/plans/2026-05-10-gha-image-change-filters.md` - remove deploy-webhook references or delete if it only documents obsolete deploy-webhook behavior.

### Task 1: Remove Live App And Build Surfaces

**Files:**
- Delete: `apps/deploy-webhook/`
- Delete: `docker/Dockerfile.deploy-webhook`
- Delete: `.github/workflows/publish-deploy-webhook-image.yml`
- Delete: `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`
- Modify: `docker/scripts/prepare-target-runtime.test.mjs`

- [ ] **Step 1: Delete obsolete deploy-webhook source and CI files**

Run:

```bash
rm -rf apps/deploy-webhook docker/Dockerfile.deploy-webhook .github/workflows/publish-deploy-webhook-image.yml scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs
```

Expected: command exits successfully and these paths no longer exist.

- [ ] **Step 2: Update the Docker runtime test fixture**

In `docker/scripts/prepare-target-runtime.test.mjs`, replace the Dockerfile list in `Dockerfiles with global pnpm installs put pnpm global bin on PATH` with:

```js
	const dockerfiles = [
		"Dockerfile.db-seed",
		"Dockerfile.docs",
		"Dockerfile.marketing",
		"Dockerfile.migration",
		"Dockerfile.webapp",
		"Dockerfile.worker",
	];
```

- [ ] **Step 3: Run targeted Docker fixture test**

Run:

```bash
pnpm node --test docker/scripts/prepare-target-runtime.test.mjs
```

Expected: PASS. Before Step 2 this would fail because `Dockerfile.deploy-webhook` was deleted but still enumerated.

### Task 2: Regenerate Workspace Lockfile

**Files:**
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Regenerate lockfile without deploy-webhook importer**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` no longer contains an `apps/deploy-webhook:` importer block.

- [ ] **Step 2: Verify lockfile reference removal**

Run:

```bash
rg "apps/deploy-webhook|deploy-webhook|z8-deploy-webhook|Dockerfile\.deploy-webhook|publish-deploy-webhook-image" pnpm-lock.yaml
```

Expected: no matches.

### Task 3: Clean Source-Controlled Documentation References

**Files:**
- Delete: `docs/superpowers/specs/2026-05-08-k8s-image-webhook-rollout-design.md`
- Delete: `docs/superpowers/plans/2026-05-08-k8s-image-webhook-rollout.md`
- Modify or delete: `docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md`
- Modify or delete: `docs/superpowers/plans/2026-05-10-gha-image-change-filters.md`

- [ ] **Step 1: Delete obsolete deploy-webhook-only archives**

Run:

```bash
rm docs/superpowers/specs/2026-05-08-k8s-image-webhook-rollout-design.md docs/superpowers/plans/2026-05-08-k8s-image-webhook-rollout.md
```

Expected: both files are removed.

- [ ] **Step 2: Clean mixed image change filter docs**

Open `docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md` and `docs/superpowers/plans/2026-05-10-gha-image-change-filters.md`.

If a file is mostly obsolete deploy-webhook implementation detail, delete it:

```bash
rm docs/superpowers/specs/2026-05-10-gha-image-change-filters-design.md docs/superpowers/plans/2026-05-10-gha-image-change-filters.md
```

If the file contains useful non-deploy-webhook documentation, remove only lines and sections containing these strings:

```text
deploy-webhook
deploy webhook
z8-deploy-webhook
Dockerfile.deploy-webhook
publish-deploy-webhook-image
```

Expected: source-controlled docs no longer describe the removed app or its publish workflow.

### Task 4: Final Reference Sweep And Verification

**Files:**
- Verify all source-controlled files.

- [ ] **Step 1: Search for remaining source references**

Run:

```bash
rg "deploy-webhook|deploy webhook|z8-deploy-webhook|Dockerfile\.deploy-webhook|publish-deploy-webhook-image|DEPLOY_WEBHOOK" -g '!node_modules' -g '!.git' -g '!.turbo' -g '!.worktrees'
```

Expected: only this removal spec and implementation plan may match. No live code, workflow, Docker, or old docs references remain.

- [ ] **Step 2: Run targeted test again**

Run:

```bash
pnpm node --test docker/scripts/prepare-target-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff -- apps/deploy-webhook docker/Dockerfile.deploy-webhook .github/workflows/publish-deploy-webhook-image.yml scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs docker/scripts/prepare-target-runtime.test.mjs pnpm-lock.yaml docs/superpowers
```

Expected: diff only removes deploy-webhook surfaces, updates the Dockerfile list, updates the lockfile, and adds this removal spec/plan.

## Self-Review

- Spec coverage: Tasks 1 and 2 remove live app, Docker, workflow, verifier, and lockfile references. Task 3 removes source-controlled docs/plans. Task 4 verifies remaining references and targeted tests.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: no new APIs or types are introduced.

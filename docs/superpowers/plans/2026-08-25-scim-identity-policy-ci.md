# SCIM Identity Policy CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed patched SCIM package's immutable externalId and tombstone reprovisioning policy a required PostgreSQL CI contract.

**Architecture:** Extend the guarded disposable-PostgreSQL callback integration suite to exercise SCIM HTTP handlers backed by the patched installed package. Add that suite to the CI PostgreSQL command and preserve the command in contract tests so it cannot be silently removed. Keep patch formatting canonical and let pnpm derive lock integrity only when patch bytes change.

**Tech Stack:** Vitest, PostgreSQL, Better Auth SCIM 1.7.1 patch, pnpm, GitHub Actions.

---

### Task 1: Cover Tombstone Reprovisioning Through Installed Handlers

**Files:**
- Modify: `apps/webapp/src/lib/scim/scim-callback-atomicity.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create a user with `externalId: "subject-original"`, delete it through `/scim/v2/Users/:id`, then POST the same resource. Assert `201` and the returned user ID is the tombstoned user ID. Add separate POST assertions for an unbound resolver result, a changed resolver subject, and a resolver that points to a user from a different provisioning domain; each must return the SCIM 409 identity-link error and must not recreate or relink the tombstone.

- [ ] **Step 2: Run the guarded suite in required mode to verify the coverage fails before patch support is complete**

Run: `APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1 pnpm --filter webapp exec vitest run src/lib/scim/scim-callback-atomicity.integration.test.ts`

Expected: the new handler assertions fail until the fixture supplies `resolveTombstoneUser` and the package patch validates its output.

- [ ] **Step 3: Configure the fixture with per-request tombstone resolutions and add minimal assertions**

Use the patched package's `externalIdPolicy.resolveTombstoneUser` callback. Return only `{ action: "link", userId: tombstoneUserId }` for the matching verified subject; return `{ action: "create" }`, a different same-domain user ID, and a user ID recorded in another domain for the conflict cases. Query persisted SCIM rows after each rejected request to prove no bypass altered the original tombstone binding.

- [ ] **Step 4: Run the guarded suite and verify it passes**

Run: `pnpm --filter webapp test:approval-workflow-repository:integration`

Expected: `scim-callback-atomicity.integration.test.ts` passes against a label-owned disposable PostgreSQL database and skips safely when no runner is available.

### Task 2: Require The Suite In CI And Preserve The Contract

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository-integration-ci.test.ts`

- [ ] **Step 1: Write failing contract expectations**

Add `src/lib/scim/scim-callback-atomicity.integration.test.ts` to each expected test-file list. In the workflow contract test, require `APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1` and the callback suite in the exact PostgreSQL Vitest command.

- [ ] **Step 2: Run the two contract tests and verify they fail**

Run: `pnpm --filter webapp exec vitest run src/lib/approvals/workflow/repository-integration-runner.test.ts src/lib/approvals/workflow/repository-integration-ci.test.ts`

Expected: failure because the workflow does not yet execute the callback suite.

- [ ] **Step 3: Add the callback suite to the CI command**

Append `src/lib/scim/scim-callback-atomicity.integration.test.ts` to the existing required-mode PostgreSQL Vitest invocation in `.github/workflows/tests.yml`.

- [ ] **Step 4: Re-run the contract tests and verify they pass**

Run: `pnpm --filter webapp exec vitest run src/lib/approvals/workflow/repository-integration-runner.test.ts src/lib/approvals/workflow/repository-integration-ci.test.ts`

Expected: both tests pass and assert the suite remains mandatory in CI.

### Task 3: Normalize The Patch And Verify The Delivery

**Files:**
- Modify if needed: `patches/@better-auth__scim@1.7.1.patch`
- Modify if needed: `pnpm-lock.yaml`

- [ ] **Step 1: Normalize the patch without behavior changes**

Ensure all diff lines and context use canonical tab/space formatting and no trailing whitespace. Do not alter `pnpm-lock.yaml` if the patch bytes remain unchanged.

- [ ] **Step 2: Reinstall from the frozen offline store when the patch hash changes**

Run: `pnpm install --offline --frozen-lockfile`

Expected: installation succeeds; pnpm reports a lock mismatch only if changed patch bytes require the lock integrity to be regenerated first.

- [ ] **Step 3: Run delivery verification**

Run: `pnpm --filter webapp exec vitest run src/lib/scim/scim-callback-atomicity.integration.test.ts src/lib/approvals/workflow/repository-integration-runner.test.ts src/lib/approvals/workflow/repository-integration-ci.test.ts`

Run: `pnpm --filter webapp typecheck`

Run: `git diff --check`

Expected: all targeted tests and typecheck pass, and diff check has no output.

- [ ] **Step 4: Commit the completed contract**

Run: `git add .github/workflows/tests.yml apps/webapp/src/lib/scim/scim-callback-atomicity.integration.test.ts apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts apps/webapp/src/lib/approvals/workflow/repository-integration-ci.test.ts patches/@better-auth__scim@1.7.1.patch pnpm-lock.yaml docs/superpowers/plans/2026-08-25-scim-identity-policy-ci.md && git commit -m "test: enforce SCIM identity policy in CI"`

Expected: one commit contains the required suite, CI contract, patch normalization if applicable, lock update if applicable, and the approved execution plan.

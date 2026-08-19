# Time Correction Category Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revalidate mutable work-category entitlement inside pending time-correction approval transactions before any terminal writes.

**Architecture:** Extract submission's organization-scoped employee/team/category-set authorization into one transaction-aware helper. Submission and terminal finalization share it; finalization invokes it only for an approved, non-null category change after terminal evidence is proven and before endpoint or metadata mutations.

**Tech Stack:** TypeScript, Drizzle ORM, Temporal polyfill wrappers, Vitest, PostgreSQL integration harness.

---

### Task 1: Prove Finalization Authorization Requirements

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] **Step 1: Add failing finalizer tests**

Extend `createFinalizerDb` with category, membership, team, assignment, set, and set-category lock rows. Add cases proving an active current entitlement succeeds; inactive/foreign category, removed category-set link, inactive/expired assignment, and stale employee-team evidence fail before mutations; unchanged category and null removal skip category authorization.

- [ ] **Step 2: Add failing structure coverage**

Assert the shared helper uses `organizationId` predicates, sorted locks, Temporal `compareInstants`, and current `teamMembership` plus `team` evidence, and assert the finalizer calls it before the first `update(timeEntry)` or `update(workPeriod)`.

- [ ] **Step 3: Verify RED**

Run: `pnpm test src/lib/approvals/server/time-correction-approvals.test.ts src/lib/approvals/server/time-correction-approvals.integration.test.ts`

Expected: FAIL because the finalizer does not lock or validate current category entitlement.

### Task 2: Extract Shared Transaction Authorization

**Files:**
- Create: `apps/webapp/src/lib/approvals/server/time-correction-category-authorization.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`

- [ ] **Step 1: Move trusted team and category authorization into the helper**

Expose transaction-aware functions equivalent to:

```ts
export async function lockTrustedTimeCorrectionEmployeeTeamId(input: {
	tx: CategoryAuthorizationDb;
	employeeId: string;
	employeeTeamId: string | null;
	organizationId: string;
}): Promise<string | null>;

export async function authorizeTimeCorrectionCategoryChange(input: {
	tx: CategoryAuthorizationDb;
	employeeId: string;
	employeeTeamId: string | null;
	organizationId: string;
	proposedWorkCategoryId: string | null;
	currentWorkCategoryId: string | null;
}): Promise<void>;
```

The helper returns immediately for null or unchanged categories. Otherwise it locks current scoped membership/team evidence, the active org-owned category, candidate assignments in ID order, their org-owned sets in ID order, and the exact set-category link in ID order. It evaluates `effectiveFrom` and `effectiveUntil` against `systemClock.nowInstant()` using `compareInstants` and `instantFromTimeCorrectionBoundary`, then throws the existing generic `ValidationError` on denial.

- [ ] **Step 2: Reuse the helper at submission**

Replace private duplicated category/team authorization while preserving input normalization, submission replay bypass, current lock ordering, and existing error behavior.

- [ ] **Step 3: Revalidate inside terminal approval**

After immutable workflow/source/canonical evidence is locked and validated, but before endpoint activation or metadata CAS, call the helper only when `transition.kind === "approve"`, the current payload proposes a non-null category, and it differs from `period.workCategoryId`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test src/lib/approvals/server/time-correction-approvals.test.ts src/lib/approvals/server/time-correction-approvals.integration.test.ts`

Expected: PASS.

### Task 3: Cover Authority Modes, Rollback, and Replay

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] **Step 1: Add authority-path tests**

Exercise canonical and legacy/shadow pending decisions with valid and revoked entitlement, asserting the existing conflict/validation surface and no durable terminal effects on denial.

- [ ] **Step 2: Add rollback and replay tests**

Use the stateful transaction harness to prove entitlement denial rolls back endpoint and metadata writes. Prove exact completed replay performs no authorization locks, while a pending decision does.

- [ ] **Step 3: Run focused approval, submission, and adapter suites**

Run: `pnpm test src/lib/approvals/server/time-correction-approvals.test.ts src/lib/approvals/server/time-correction-approvals.integration.test.ts src/app/[locale]/\(app\)/time-tracking/actions/corrections.test.ts src/app/[locale]/\(app\)/time-tracking/actions/corrections.behavior.test.ts src/lib/approvals/domain-adapters/time-correction-contract.test.ts src/lib/approvals/domain-adapters/time-correction.adapter.test.ts src/lib/approvals/handlers/time-correction.handler.test.ts`

Expected: PASS.

### Task 4: Verification and Minimality

**Files:**
- Inspect all changed files; do not commit.

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 2: Run production Biome**

Run: `pnpm exec biome ci --max-diagnostics=30 src`

Expected: PASS.

- [ ] **Step 3: Run repository security check**

Run the repository's available security verification command discovered from project configuration; if no dedicated command exists, run the scoped security tests and perform the authorization checklist review.

- [ ] **Step 4: Inspect diff and whitespace**

Run: `git diff --check` and `git diff --stat`.

Expected: no whitespace errors; changes remain limited to the helper, consumers, focused tests, and this plan. No commit.

# Surcharge Break Reconciliation Implementation Plan

> **For implementation:** Execute each task with strict red-green-refactor TDD. Do not change the public clock-out response.

**Goal:** Reconcile terminal surcharges from immutable policy evidence after automatic break enforcement, including every resulting work-period segment and rules valid anywhere in the submitted interval.

**Architecture:** Capture organization surcharge enablement and all rules overlapping the original period in the policy snapshot. At terminal execution, enforce breaks first, then reconcile the exact affected period IDs from the snapshot, then mark work balance dirty. Preserve existing snapshot JSON by encoding captured disabled state as `resolution.kind = "none"`.

**Tech Stack:** TypeScript, Next.js, Effect, Drizzle ORM, Temporal, Vitest, PostgreSQL integration harness.

---

## Task 1: Return exact break-enforcement targets

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/__tests__/break-enforcement.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/break-enforcement.service.ts`

1. Add failing service tests proving no-adjustment returns the original period ID and a split returns both the original and inserted period IDs.
2. Run the focused test and confirm it fails for the missing result contract.
3. Add `affectedWorkPeriodIds` to `BreakEnforcementResult`; make every early return include `[input.workPeriodId]`, and obtain the inserted row ID from the split insert.
4. Run the focused test and confirm it passes.

## Task 2: Reorder no-approval terminal side effects

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.ts`

1. Add failing tests proving break enforcement precedes surcharge reconciliation, split and no-split target lists are exact, no stale pre-split calculation occurs, dirty marking follows reconciliation, and public results remain unchanged.
2. Run both focused test files and confirm ordering/target failures.
3. Reorder both no-approval flows to break -> reconcile each affected period -> dirty mark, using only `affectedWorkPeriodIds` from the internal break result.
4. Run both focused test files and confirm they pass.

## Task 3: Capture organization-scoped interval evidence

**Files:**
- Modify: `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.test.ts`
- Modify: `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.ts`
- Modify callers that construct the resolver input.

1. Add failing resolver tests for an exact single organization row, disabled capture, mid-period starts, mid-period expiries, no overlap, and inclusive interval boundaries with captured offsets.
2. Run the focused test and confirm current end-only filtering and missing enablement fail.
3. Change resolver input to period start/end evidence, query exactly one organization row, return strict `none` when disabled, and select rules where `validFrom <= periodEnd` and `validUntil IS NULL OR validUntil >= periodStart`.
4. Keep Temporal/fixed-offset conversions at business-logic boundaries and native `Date` only at database boundaries.
5. Run focused resolver/parser tests and confirm they pass.

## Task 4: Bypass live enablement for immutable reconciliation

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/surcharge-reconciliation.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/compliance.ts`
- Modify: `apps/webapp/src/lib/effect/services/surcharge.service.ts` only if its immutable entry point needs separation.

1. Add failing tests for captured-disabled/live-enabled and captured-enabled/live-disabled terminal execution.
2. Confirm immutable reconciliation currently fails because the wrapper checks live `surchargesEnabled`.
3. Route immutable snapshot execution directly to snapshot reconciliation; retain the live enablement check only for genuinely live calculations.
4. Run focused surcharge tests and confirm both toggle directions pass.

## Task 5: Prove approval-mode and PostgreSQL parity

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`
- Modify snapshot equality, SQL extraction, or redaction tests only if required by the unchanged strict snapshot representation.

1. Extend executable PostgreSQL cases to all five approval modes for disabled/enabled mutation directions, split/no-split outcomes, exact affected IDs, and terminal ordering/parity.
2. Run the focused static/unit matrix and confirm new cases fail before any needed harness changes.
3. Make the minimum production or harness changes needed for exact terminal parity; do not loosen strict SQL or redaction.
4. Run all focused Task 18 unit/static tests.
5. Run `pnpm test:approval-workflow-repository:integration`; if Docker still crashes before PostgreSQL starts, capture that exact environmental blocker.

## Task 6: Final verification and commit

1. Run focused tests for break enforcement, clocking, on-behalf clock-out, snapshot resolution, surcharge reconciliation, and approval integration definitions.
2. Run project typecheck, Biome checks on changed files, and `git diff --check`.
3. Inspect `git status`, `git diff`, and `git log --oneline -10`; ensure only intended files are staged.
4. Commit exactly `fix: reconcile surcharge after break enforcement` without amend or push.

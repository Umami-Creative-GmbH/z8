# Payroll Canonical Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payroll readiness reconcile legacy rows through their canonical links without treating canonical-native rows as migration gaps.

**Architecture:** Resolve the expected canonical ID for each legacy work period or absence as `canonicalRecordId ?? id`. Use that resolved ID consistently for record, detail, duration, approval-state, and allocation parity checks; define count mismatches as missing legacy coverage rather than absolute table-size differences.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, pnpm.

## Global Constraints

- Payroll authorization and employee scope remain organization-scoped and unchanged.
- Reconciliation remains filtered by `organizationId`.
- Missing or inconsistent linked canonical records remain fail-closed.
- Canonical-native records without legacy counterparts are valid.
- No production data is deleted or rewritten by this code change.
- Use pnpm only.

---

### Task 1: Add linked-ID reconciliation regressions

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts`

**Interfaces:**
- Exercises: `reconcileLegacyToCanonical(organizationId: string): Promise<LegacyCanonicalReconciliation>`.
- Proves: linked IDs are authoritative and canonical-native rows do not create gaps.

- [ ] **Step 1: Add a failing linked-ID and canonical-native test**

Add a test fixture with:

```ts
legacy work: {
	id: "legacy-work-1",
	canonicalRecordId: "canonical-work-1",
	projectId: "project-1",
	durationMinutes: 480,
	approvalStatus: "approved",
}

legacy absence: {
	id: "legacy-absence-1",
	canonicalRecordId: "canonical-absence-1",
	startDate: "2026-01-15",
	startPeriod: "full_day",
	endDate: "2026-01-15",
	endPeriod: "full_day",
	status: "approved",
}
```

Return canonical rows for those linked IDs plus one canonical-native work row
and one canonical-native absence row. Return detail rows and the project
allocation under the linked canonical IDs. Assert every reconciliation metric
is zero.

- [ ] **Step 2: Add a failing missing-linked-record test**

Use a work period with:

```ts
{
	id: "legacy-work-1",
	canonicalRecordId: "missing-canonical-work",
	projectId: null,
	durationMinutes: 480,
	approvalStatus: "approved",
}
```

Return a canonical record whose ID is `legacy-work-1`. Assert:

```ts
expect(result).toMatchObject({
	workCountMismatch: 1,
	missingWorkCanonicalRecords: 1,
	missingWorkDetailRows: 1,
});
```

This proves reconciliation does not silently fall back to the legacy ID after a
canonical link has been established.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
PATH=/tmp/z8-bin:$PATH COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp exec vitest run src/lib/time-record/migration/__tests__/reconciliation.test.ts
```

Expected: the linked-ID test reports missing records/details/allocations and
count mismatches; the missing-linked-record test incorrectly passes coverage
through the legacy ID.

- [ ] **Step 4: Commit the RED tests only**

```bash
git add apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts
git commit -m "test(payroll): reproduce linked canonical reconciliation"
```

### Task 2: Reconcile through canonical links

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/reconciliation.ts`

**Interfaces:**
- Produces unchanged `LegacyCanonicalReconciliation`.
- Internal helper:

```ts
function resolveExpectedCanonicalId(record: {
	id: string;
	canonicalRecordId: string | null | undefined;
}): string;
```

- [ ] **Step 1: Load canonical links with legacy rows**

Add `canonicalRecordId: true` to the selected columns for legacy work periods
and organization-scoped legacy absences. Null-organization absences already
select this field.

- [ ] **Step 2: Resolve expected canonical IDs**

Add:

```ts
function resolveExpectedCanonicalId(record: {
	id: string;
	canonicalRecordId: string | null | undefined;
}) {
	return record.canonicalRecordId ?? record.id;
}
```

Build `expectedWorkCanonicalIds` and `expectedAbsenceCanonicalIds` from the
legacy rows using this helper.

- [ ] **Step 3: Use resolved IDs for all parity checks**

Key the legacy work and absence maps by resolved canonical ID. Build expected
project-allocation keys with the resolved work canonical ID. Compare missing
canonical records and missing work/absence detail rows using the expected
canonical ID sets.

Replace absolute count differences with missing-coverage counts:

```ts
const missingWorkCanonicalRecords = countMissingIds(
	expectedWorkCanonicalIds,
	canonicalWorkIds,
);
const missingAbsenceCanonicalRecords = countMissingIds(
	expectedAbsenceCanonicalIds,
	canonicalAbsenceIds,
);

return {
	workCountMismatch: missingWorkCanonicalRecords,
	absenceCountMismatch: missingAbsenceCanonicalRecords,
	missingWorkCanonicalRecords,
	missingAbsenceCanonicalRecords,
	// existing parity metrics
};
```

- [ ] **Step 4: Run reconciliation tests and verify GREEN**

Run:

```bash
PATH=/tmp/z8-bin:$PATH COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp exec vitest run src/lib/time-record/migration/__tests__/reconciliation.test.ts
```

Expected: all reconciliation tests pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/webapp/src/lib/time-record/migration/reconciliation.ts
git commit -m "fix(payroll): reconcile linked canonical records"
```

### Task 3: Verify payroll readiness and repository health

**Files:**
- Verify only.

- [ ] **Step 1: Run focused payroll and cutover tests**

```bash
PATH=/tmp/z8-bin:$PATH COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp exec vitest run \
  src/lib/time-record/migration/__tests__/reconciliation.test.ts \
  src/lib/time-record/migration/cutover-state.test.ts \
  src/lib/payroll-workspace/summary.cutover.test.ts \
  src/lib/payroll-access/permissions.test.ts \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.start-export.test.ts' \
  'src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx'
```

- [ ] **Step 2: Run formatter checks on touched code**

```bash
COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp exec ultracite check \
  src/lib/time-record/migration/reconciliation.ts \
  src/lib/time-record/migration/__tests__/reconciliation.test.ts
```

- [ ] **Step 3: Run webapp type checking**

```bash
COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp typecheck
```

- [ ] **Step 4: Run the complete webapp suite with stable concurrency**

```bash
PATH=/tmp/z8-bin:$PATH COREPACK_HOME=/tmp/z8-corepack corepack pnpm --filter webapp exec vitest run --reporter=dot --silent=passed-only --maxWorkers=4
```

Expected: 759 test files and 5,345 or more tests pass with zero failures.

- [ ] **Step 5: Review the final diff**

Confirm:

```txt
1. All reconciliation queries remain organization-scoped.
2. Payroll access grants and employee scope are untouched.
3. Linked missing/inconsistent canonical data remains fail-closed.
4. Canonical-native records no longer create false cutover mismatches.
5. The working tree contains no unintended changes.
```

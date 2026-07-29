# Payroll Duration Reconciliation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical backfill converge existing payroll duration and approval-state mismatches without weakening tenant scope or the payroll readiness gate.

**Architecture:** Replace the insert-only `time_record` write with a dedicated bulk upsert targeting the unique `(id, organizationId)` key. On conflict, update only legacy-authoritative `durationMinutes` and `approvalState`; preserve existing detail-row, allocation, decision, linkage, and transaction behavior.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, pnpm.

---

## File Map

- Modify `apps/webapp/src/lib/time-record/migration/backfill.ts`: add the scoped canonical time-record upsert and keep generic insert-only behavior for detail tables.
- Modify `apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts`: prove the composite conflict target, exact parity updates, empty-payload behavior, and unchanged detail inserts.

### Task 1: Reproduce Non-Convergent Existing Rows

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts`

- [ ] **Step 1: Extend the insert-chain mocks**

Add `onConflictDoUpdate` to `mockState`:

```ts
const mockState = vi.hoisted(() => ({
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	// existing mocks remain unchanged
}));
```

Reset it and expose both conflict methods from the insert chain in
`beforeEach`:

```ts
mockState.onConflictDoNothing.mockResolvedValue(undefined);
mockState.onConflictDoUpdate.mockResolvedValue(undefined);
mockState.insertValues.mockReturnValue({
	onConflictDoNothing: mockState.onConflictDoNothing,
	onConflictDoUpdate: mockState.onConflictDoUpdate,
});
```

Add `organizationId` to the mocked `timeRecord` table:

```ts
timeRecord: {
	id: "time-record-id",
	organizationId: "time-record-organization-id",
},
```

- [ ] **Step 2: Add a failing scoped-upsert test**

Import `sql` from `drizzle-orm` in the test, then add this test using the
existing work-period fixture shape:

```ts
it("updates existing canonical parity fields through the scoped conflict key", async () => {
	await runCanonicalBackfill({
		organizationId: "org-1",
		actorId: "actor-1",
		legacy: {
			workPeriods: [
				{
					id: "work-1",
					organizationId: "org-1",
					employeeId: "employee-1",
					startTime: new Date("2026-01-15T08:00:00.000Z"),
					endTime: new Date("2026-01-15T16:00:00.000Z"),
					durationMinutes: 480,
					approvalStatus: "approved",
					projectId: null,
					workCategoryId: null,
					workLocationType: "office",
					createdAt: new Date("2026-01-10T00:00:00.000Z"),
					updatedAt: new Date("2026-01-10T00:00:00.000Z"),
				},
			],
			absenceEntries: [],
			approvalRequests: [],
			absenceCategories: [],
		},
	});

	expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith({
		target: ["time-record-id", "time-record-organization-id"],
		set: {
			durationMinutes: sql.raw("excluded.duration_minutes"),
			approvalState: sql.raw("excluded.approval_state"),
		},
	});
	expect(mockState.onConflictDoUpdate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Strengthen the transaction test for unchanged detail behavior**

In `runs canonical inserts and legacy linkage updates inside one transaction`,
replace the old expectation of three `onConflictDoNothing` calls with:

```ts
expect(mockState.onConflictDoUpdate).toHaveBeenCalledTimes(1);
expect(mockState.onConflictDoNothing).toHaveBeenCalledTimes(2);
```

This proves only the base `time_record` table changes strategy.

- [ ] **Step 4: Add an empty-payload regression**

Add:

```ts
it("does not upsert canonical time records when the payload is empty", async () => {
	await runCanonicalBackfill({
		organizationId: "org-1",
		actorId: "actor-1",
		legacy: {
			workPeriods: [],
			absenceEntries: [],
			approvalRequests: [],
			absenceCategories: [],
		},
	});

	expect(mockState.onConflictDoUpdate).not.toHaveBeenCalled();
	expect(mockState.dbInsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/__tests__/backfill.test.ts
```

Expected: the new scoped-upsert test fails because `time_record` still calls
`onConflictDoNothing`; the existing transaction count expectation also fails
after being updated.

### Task 2: Implement the Scoped Canonical Upsert

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/backfill.ts`

- [ ] **Step 1: Import the SQL helper**

Update the Drizzle import:

```ts
import { eq, inArray, isNull, sql } from "drizzle-orm";
```

- [ ] **Step 2: Route base records through a dedicated helper**

In `runCanonicalBackfill`, replace:

```ts
await insertIfPresent(tx, timeRecord, payload.timeRecords);
```

with:

```ts
await upsertCanonicalTimeRecords(tx, payload.timeRecords);
```

Leave both detail-table calls on `insertIfPresent`:

```ts
await insertIfPresent(tx, timeRecordWork, payload.timeRecordWork);
await insertIfPresent(tx, timeRecordAbsence, payload.timeRecordAbsence);
```

- [ ] **Step 3: Add the scoped upsert helper**

Add immediately before `insertIfPresent`:

```ts
async function upsertCanonicalTimeRecords(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	values: CanonicalBackfillPayload["timeRecords"],
) {
	if (values.length === 0) {
		return;
	}

	await tx
		.insert(timeRecord)
		.values(values)
		.onConflictDoUpdate({
			target: [timeRecord.id, timeRecord.organizationId],
			set: {
				durationMinutes: sql.raw("excluded.duration_minutes"),
				approvalState: sql.raw("excluded.approval_state"),
			},
		});
}
```

Do not add timestamps, employee linkage, record kind, origin, or audit columns
to the conflict update set.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/__tests__/backfill.test.ts
```

Expected: all canonical backfill tests pass.

### Task 3: Verify Cutover and Payroll Readiness

**Files:**
- Verify only.

- [ ] **Step 1: Run migration and payroll readiness tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-record/migration/__tests__/backfill.test.ts \
  src/lib/time-record/migration/__tests__/reconciliation.test.ts \
  src/lib/time-record/migration/cutover-state.test.ts \
  src/lib/payroll-workspace/summary.cutover.test.ts \
  src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.test.ts'
```

Expected: all selected tests pass.

- [ ] **Step 2: Run formatting and type checks**

Run:

```bash
pnpm --filter webapp exec ultracite check \
  src/lib/time-record/migration/backfill.ts \
  src/lib/time-record/migration/__tests__/backfill.test.ts
pnpm --filter webapp typecheck
```

Expected: Ultracite passes. Typecheck may remain blocked only by the known
pre-existing missing generated `@/data/licenses.json`; no new diagnostic may be
introduced by the two changed files.

- [ ] **Step 3: Review tenant scope and diff integrity**

Run:

```bash
git diff --check
git diff -- \
  apps/webapp/src/lib/time-record/migration/backfill.ts \
  apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts
```

Confirm:

```txt
The conflict target is exactly timeRecord.id plus timeRecord.organizationId.
Only durationMinutes and approvalState are updated on conflict.
Detail-table inserts still use onConflictDoNothing.
All writes remain inside the existing transaction.
The payroll readiness gate remains fail-closed.
```

- [ ] **Step 4: Validate production behavior after deployment**

After deploying the repair, request the payroll page once. The automatic
backfill should update the seven stale durations, the post-repair
`durationMismatchRecords` count should become zero, and payroll should load.
If a conflict remains, use the existing aggregate `details.reconciliation`
diagnostics rather than bypassing readiness.

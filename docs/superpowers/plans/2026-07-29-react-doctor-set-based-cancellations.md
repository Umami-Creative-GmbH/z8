# React Doctor Set-Based Cancellations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace safe per-row cancellation loops with tenant-scoped set-based mutations that fail closed on partial compare-and-swap results.

**Architecture:** Preserve existing transaction phases and lock ordering. Build disjunctions for expected row identity/lineage pairs, execute one mutation per independent phase, and compare exact returned ID sets before proceeding to dependent writes.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest

**Delivery constraint:** Leave all edits unstaged and uncommitted for working-tree review.

---

### Task 1: Batch Time-Correction Cancellation Deletes

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts:1084-1117`

- [ ] **Step 1: Add multi-row exact-set tests**

Add tests beside `deleteCancelledTimeCorrectionsInTransaction` coverage:

```ts
it("deletes all validated pending corrections in one scoped mutation", async () => {
	const fixture = cancellationDb();

	await deleteCancelledTimeCorrectionsInTransaction(
		cancellationInput(fixture.dbService),
	);

	expect(fixture.deletes).toHaveLength(1);
});

it("rejects a partial set-based cancellation delete", async () => {
	const fixture = cancellationDb({
		deleteRows: [{ id: cancellationIds.correctionIn }],
	});

	await expect(
		deleteCancelledTimeCorrectionsInTransaction(
			cancellationInput(fixture.dbService),
		),
	).rejects.toThrow("Time correction cancellation delete conflict");
});
```

Change `cancellationDb`'s `deleteRows` option from per-call arrays to one returned row array, defaulting to both expected correction IDs. Update existing two-delete assertions to one. Add duplicate and unexpected returned-ID cases; equal counts with wrong identities must fail.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter webapp test src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: the implementation performs one delete per correction.

- [ ] **Step 3: Replace the delete loop with one exact-pair mutation**

`or` is already imported. Replace only the delete loop; preserve every lock, UTC/timezone evidence check, and replacement-lineage validation before it.

```ts
if (correctionEntries.length === 0) return;

const expectedIds = correctionEntries.map((entry) => entry.id);
const expectedIdSet = new Set(expectedIds);
const deleted = await input.dbService.db
	.delete(timeEntry)
	.where(
		and(
			eq(timeEntry.organizationId, input.organizationId),
			eq(timeEntry.employeeId, input.expectedSource.employeeId),
			eq(timeEntry.type, "correction"),
			eq(timeEntry.isSuperseded, true),
			isNull(timeEntry.supersededById),
			or(
				...correctionEntries.map((entry) =>
					and(
						eq(timeEntry.id, entry.id),
						eq(timeEntry.replacesEntryId, entry.originalId),
					),
				),
			),
		),
	)
	.returning({ id: timeEntry.id });

const deletedIds = new Set(deleted.map((entry) => entry.id));
if (
	expectedIdSet.size !== expectedIds.length ||
	deletedIds.size !== deleted.length ||
	deletedIds.size !== expectedIdSet.size ||
	[...expectedIdSet].some((id) => !deletedIds.has(id))
) {
	throw new Error("Time correction cancellation delete conflict");
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command.

Expected: all time-correction approval tests pass.

### Task 2: Prove Global Absence Cancellation Barriers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts:201-523`

- [ ] **Step 1: Make the existing harness model exact returned rows and rollback**

Extend `harness` with `returnedStageIds?: string[]`, `returnedChainIds?: string[]`, and `returnedRequestIds?: string[]`. Dispatch update builders by table, expose `stageUpdateReturning`, `chainUpdateReturning`, and `requestDeleteReturning`, and record `stage-update:<ids>`, `chain-update:<ids>`, and `request-delete:<ids>`. Snapshot `requestRows` before `withTransaction` and restore it on failure so the fake models database rollback.

- [ ] **Step 2: Add the global barrier test**

Configure the real harness with one chain, two pending stages, and two active requests. Call the public action and assert the three exact mutations and their order:

```ts
await expect(
	mutations.cancelAbsenceRequestForEmployee(absenceId, {
		id: employeeId,
		organizationId,
	}),
).resolves.toEqual({ success: true });

expect(test.stageUpdateReturning).toHaveBeenCalledOnce();
expect(test.chainUpdateReturning).toHaveBeenCalledOnce();
expect(test.requestDeleteReturning).toHaveBeenCalledOnce();
expect(test.events.indexOf("stage-update:stage-1,stage-2")).toBeLessThan(
	test.events.indexOf(`chain-update:${chainId}`),
);
expect(test.events.indexOf(`chain-update:${chainId}`)).toBeLessThan(
	test.events.indexOf(`request-delete:${requestId},${secondRequestId}`),
);
```

- [ ] **Step 3: Add partial, duplicate, and unexpected returned-set tests**

Use harness options to return only `stage-1`, no chain ID, or only one request ID. Add duplicate and equal-count/wrong-ID cases. The public action resolves failure objects, so assert exact errors and that later phases never start:

```ts
await expect(cancel()).resolves.toEqual({
	success: false,
	error: "Legacy approval stage changed during cancellation",
});
expect(test.chainUpdateReturning).not.toHaveBeenCalled();
expect(test.requestDeleteReturning).not.toHaveBeenCalled();
expect(test.committed()).toBe(false);
```

Use `Legacy approval chain changed during cancellation` and `Legacy approval request changed during cancellation` for the other phases. For request failures, assert `requestRows()` is restored and `snapshot()` retains pending state.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/absences/mutations.test.ts'
```

Expected: old per-row mutations do not satisfy the single global barriers or exact returned-set failures.

### Task 3: Implement Global Absence Cancellation Phases

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts:170-279`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`

- [ ] **Step 1: Add `or` and exact-set validation**

Add `or` to the Drizzle import. Add this helper next to `updateExactlyOne`:

```ts
function assertExactIds(
	rows: readonly { id: string }[],
	expectedIds: readonly string[],
	message: string,
): void {
	const expected = new Set(expectedIds);
	const actual = new Set(rows.map((row) => row.id));
	if (
		expected.size !== expectedIds.length ||
		actual.size !== rows.length ||
		actual.size !== expected.size ||
		[...expected].some((id) => !actual.has(id))
	) {
		fail(message);
	}
}
```

- [ ] **Step 2: Flatten and update all pending stages first**

Build `pendingStages` with `input.chains.flatMap`, retaining each `chainId`. When non-empty, issue one update scoped by organization and pending status with an `or` disjunction of exact stage ID, chain ID, and nullable request linkage. Return IDs and validate them with `Legacy approval stage changed during cancellation`.

- [ ] **Step 3: Update all chain roots behind the stage barrier**

When chains exist, issue one update scoped by organization, `absence_entry`, and `input.absenceId`, plus an `or` disjunction of exact chain ID and expected status. Set `status: "cancelled"` and `completedAt: input.cancelledAt`, return IDs, and validate with `Legacy approval chain changed during cancellation`.

- [ ] **Step 4: Delete all eligible requests behind the chain barrier**

```ts
if (requestsToDelete.length > 0) {
	const deleted = await dbService.db
		.delete(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "absence_entry"),
				eq(approvalRequest.entityId, input.absenceId),
				or(
					...requestsToDelete.map((request) =>
						and(
							eq(approvalRequest.id, request.id),
							eq(approvalRequest.status, request.status),
						),
					),
				),
			),
		)
		.returning({ id: approvalRequest.id });

	assertExactIds(
		deleted,
		requestsToDelete.map((request) => request.id),
		"Legacy approval request changed during cancellation",
	);
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 2 Step 4 command. Expected: direct, chain-backed, rollback, historical-preservation, shadow, and ready-mode tests pass. Do not introduce `new Date()` or `Date.now()`; retain the existing Temporal-to-database boundary.

### Task 4: Batch Compatibility Stage Cancellation

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts:80-143`

- [ ] **Step 1: Add exact-set tests**

Add a two-stage cancellation test that expects one stage update and a partial-return test that expects `Time correction cancellation is unavailable` before the chain update.

Import `cancelLegacyTimeCorrectionApprovalRows`, `approvalChainInstance`, `approvalChainStageInstance`, and `approvalRequest`. Add a narrow `cancellationMutationHarness` with table-sensitive update builders, `returnedStageIds`, and recorded update tables/events. Do not reuse the raw-SQL row-writer harness. Assert one stage-table update and this barrier:

```ts
expect(fake.events.indexOf(`stage-update:${fake.stageIds.join(",")}`)).toBeLessThan(
	fake.events.indexOf(`chain-update:${fake.chainId}`),
);
```

For partial, duplicate, and unexpected returned stage sets, assert rejection with the existing error and no chain or request mutation.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter webapp test src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: pending stages are updated one at a time.

- [ ] **Step 3: Add `or` to imports and replace the loop**

Use one update with common organization, chain, and pending predicates plus this identity/linkage disjunction:

```ts
or(
	...pendingStages.map((stage) =>
		and(
			eq(approvalChainStageInstance.id, stage.id),
			stage.approvalRequestId
				? eq(
						approvalChainStageInstance.approvalRequestId,
						stage.approvalRequestId,
					)
				: isNull(approvalChainStageInstance.approvalRequestId),
		),
)
```

Return IDs and reject missing, duplicate, or unexpected rows by comparing row count, unique-set size, and exact membership. Throw the existing cancellation error on mismatch. Keep the chain-root update after exact stage validation.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: all compatibility writer tests pass.

### Task 5: Validate Cancellation Changes

**Files:**
- Verify all files changed in Tasks 1-4

- [ ] **Step 1: Run all focused suites**

```bash
pnpm --filter webapp test \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  'src/app/[locale]/(app)/absences/mutations.test.ts' \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run approval write-boundary tests**

```bash
pnpm --filter webapp test src/lib/approvals/approval-write-boundary.test.ts
```

Expected: all ownership and inventory tests pass.

- [ ] **Step 3: Run typecheck and Temporal smoke tests**

```bash
pnpm --filter webapp typecheck
```

Then run:

```bash
pnpm test:temporal-timezone-smoke
```

Expected: typecheck passes and the smoke suite passes in all configured timezones. Do not change approval ownership maps or exceptions; set-based writes retain the existing function/table/operation inventory.

- [ ] **Step 4: Inspect unstaged changes**

```bash
git diff --check && git status --short
```

Expected: no whitespace errors. Do not stage or commit.

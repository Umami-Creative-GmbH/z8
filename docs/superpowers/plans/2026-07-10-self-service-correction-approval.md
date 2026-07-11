# Self-Service Correction Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep single-entry employee corrections inactive until a manager approves them, including clock-out-only requests.

**Architecture:** Preserve the existing route contract and direct manager path. Add endpoint-agnostic approval metadata and effective-period calculation, then make the route create an inactive correction and pending approval in one transaction for self-service requests.

**Tech Stack:** Next.js 16 route handlers, Drizzle ORM, Effect, Luxon, Vitest, PostgreSQL transactions.

---

## File Map

- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`: allow either correction endpoint and apply only linked replacements.
- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`: cover clock-in-only, clock-out-only, rejection, and workflow metadata.
- Modify `apps/webapp/src/app/api/time-entries/corrections/route.ts`: validate input, scope lookups, and create pending self-service requests atomically.
- Modify `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`: cover POST behavior, tenant isolation, timestamps, and direct corrections.
- Modify `apps/webapp/src/lib/effect/services/time-entry.service.ts`: scope the immediate superseding update by organization and employee.
- Create `apps/webapp/src/lib/effect/services/time-entry.service.test.ts` only if no existing focused service test can express the scoped update.

Do not modify or revert unrelated dirty approval files. Re-read each target immediately before editing and preserve concurrent changes. Do not commit unless explicitly requested.

### Task 1: Make Approval Metadata Endpoint-Agnostic

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts:127-203,315-354,706-809,1006-1042`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts:74-80,227-242,266-314,409-563,665-809`

- [ ] **Step 1: Add a failing workflow test for clock-out-only metadata**

Add a test beside `creates time correction approvals through the shared policy resolver`:

```ts
it("creates a time correction approval linked only to a clock-out correction", async () => {
	const { dbService, inserts } = createPolicyResolutionDbService([]);

	await Effect.runPromise(
		createTimeCorrectionApprovalWorkflow(dbService, {
			organizationId: "org-1",
			requesterEmployeeId: "emp-requester",
			teamId: "team-1",
			workPeriodId: "period-1",
			defaultApproverId: "emp-manager",
			reason: "Correct clock-out",
			overtimeRisk: "warning",
			correctionEntryIds: { clockOutCorrectionId: "entry-clock-out-correction" },
		}),
	);

	expect(inserts[0].values.metadata).toEqual({
		timeCorrection: {
			action: "edit",
			clockInCorrectionId: undefined,
			clockOutCorrectionId: "entry-clock-out-correction",
		},
	});
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run from `apps/webapp`:

```bash
pnpm vitest run src/lib/approvals/server/time-correction-approvals.test.ts -t "clock-out correction"
```

Expected: TypeScript/test failure because `clockInCorrectionId` is required.

- [ ] **Step 3: Relax the input type while requiring one endpoint at runtime**

Change the workflow input to:

```ts
correctionEntryIds?: {
	clockInCorrectionId?: string;
	clockOutCorrectionId?: string;
};
```

Before metadata construction, reject an explicitly supplied empty object with a `ValidationError` on `timeCorrection` so callers cannot create an unlinked modern approval.

- [ ] **Step 4: Re-run the focused test and confirm GREEN**

Run the same command. Expected: PASS.

### Task 2: Approve Either Endpoint Without Replacing the Other

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`

- [ ] **Step 1: Add a failing clock-out-only approval test**

Set `period.clockOutId` to `entry-clock-out-original`, configure approval metadata with only `clockOutCorrectionId`, return the pending clock-out correction from `timeEntry.findFirst`, approve, and assert the work-period update preserves the original clock-in:

```ts
expect(dbService.updateSets).toEqual(
	expect.arrayContaining([
		expect.objectContaining({
			clockInId: "entry-original",
			clockOutId: clockOutCorrection.id,
			startTime: period.startTime,
			endTime: clockOutCorrection.timestamp,
			durationMinutes: 495,
		}),
		{ isSuperseded: false, supersededById: null },
		{ isSuperseded: true, supersededById: clockOutCorrection.id },
	]),
);
expect(dbService.updateSets).not.toEqual(
	expect.arrayContaining([{ isSuperseded: true, supersededById: correction.id }]),
);
```

- [ ] **Step 2: Run the test and confirm RED**

```bash
pnpm vitest run src/lib/approvals/server/time-correction-approvals.test.ts -t "clock-out-only"
```

Expected: rejection with `Clock in correction not found`.

- [ ] **Step 3: Implement effective endpoint calculation**

Replace the mandatory correction-only calculation with effective endpoint values:

```ts
const effectiveClockIn = clockInCorrection
	? { id: clockInCorrection.id, timestamp: clockInCorrection.timestamp }
	: { id: period.clockInId, timestamp: period.startTime };
const effectiveClockOut = clockOutCorrection
	? { id: clockOutCorrection.id, timestamp: clockOutCorrection.timestamp }
	: period.clockOutId && period.endTime
		? { id: period.clockOutId, timestamp: period.endTime }
		: null;
```

Use these values for range validation, duration, work-period updates, canonical record synchronization, dirty-date calculation, and notifications. Keep deletion validation strict: both correction objects must exist.

- [ ] **Step 4: Activate and supersede only linked pairs**

Change `activateApprovedTimeCorrectionEntries` to accept nullable correction entries. Build the activation ID list from present corrections, and execute each original superseding update only when its matching correction exists. Keep employee and organization predicates on every update.

- [ ] **Step 5: Preserve rejection behavior**

Build `correctionEntries` from both nullable linked corrections and filter nulls. Modern metadata must not reactivate originals; legacy fallback behavior remains unchanged. Add a clock-out-only rejection test that asserts only the linked pending clock-out correction remains inactive and the work period receives no endpoint update.

- [ ] **Step 6: Run the approval suite**

```bash
pnpm vitest run src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: all tests PASS, including deletion and legacy approval cases.

### Task 3: Add POST Route Regression Tests

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`

- [ ] **Step 1: Extend the route mock for POST dependencies**

Add mocks for `db.transaction`, `workPeriod`, `createTimeEntry`, `createTimeCorrectionApprovalWorkflow`, `resolveCorrectionApprovalManager`, and `getUserTimezone`. Import `POST` with `GET`.

Model three scoped lookups in order: current employee, target entry, entry owner, then containing work period. The target entry and period mocks must expose enough fields to distinguish clock-in from clock-out.

- [ ] **Step 2: Add a failing self clock-in test**

Submit:

```ts
{
	replacesEntryId: "entry-clock-in",
	timestamp: "2026-07-10T08:15:00+02:00",
	timezone: "Europe/Berlin",
	notes: "Correct start",
}
```

Assert `201`, an `approvalId`, `createTimeEntry` called with `isSuperseded: true`, workflow metadata containing only `clockInCorrectionId`, and no immediate service activation.

- [ ] **Step 3: Add a failing self clock-out test**

Use `replacesEntryId: "entry-clock-out"`. Assert metadata contains only `clockOutCorrectionId`, while the original entry is never updated before approval.

- [ ] **Step 4: Add tenant and timestamp tests**

Add tests asserting:

- target lookup includes `timeEntry.organizationId = activeOrgId`;
- work-period lookup includes ID/employee/organization, `deletedAt IS NULL`, and clock-in-or-clock-out membership;
- `2026-07-10T08:15:00` returns `400`;
- malformed input returns `400`;
- an invalid supplied IANA timezone returns `400`;
- a manager correction still uses immediate activation and returns `Correction applied successfully.`

Add capture assertions for `2026-07-10T08:15:00Z`, Europe/Berlin summer (`utcOffsetMinutes: 120`), and Europe/Berlin winter (`utcOffsetMinutes: 60`). In each case assert the stored `Date` represents the submitted canonical instant.

- [ ] **Step 5: Add atomic rollback and duplicate-pending tests**

Make the transaction mock snapshot inserted corrections. Force `createTimeCorrectionApprovalWorkflow` to reject and assert the response is an error and no correction remains after rollback. Then model an existing pending approval conflict and assert a second submission creates neither a durable correction nor another approval.

- [ ] **Step 6: Run route tests and confirm RED**

```bash
pnpm vitest run src/app/api/time-entries/corrections/route.test.ts
```

Expected: new POST tests fail because the current route applies corrections immediately and uses unscoped/permissive parsing.

### Task 4: Implement Atomic Pending Submission

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts:1-166`

- [ ] **Step 1: Parse and validate the request with Luxon**

Use `DateTime.fromISO(timestamp, { setZone: true })`, require the string to end in `Z` or `[+-]HH:mm`, convert with `.toUTC().toJSDate()`, and return `400` for invalid input. Validate an optional timezone with `isValidIanaTimezone`; otherwise resolve the target employee's saved timezone with `getUserTimezone`.

- [ ] **Step 2: Scope target and period lookups**

Query the target with:

```ts
where(and(eq(timeEntry.id, replacesEntryId), eq(timeEntry.organizationId, activeOrgId)))
```

Query a non-deleted work period by organization, employee, and:

```ts
or(eq(workPeriod.clockInId, replacesEntryId), eq(workPeriod.clockOutId, replacesEntryId))
```

Return `404` when either is absent.

- [ ] **Step 3: Validate the effective period range**

For clock-in corrections compare the proposed instant with `period.endTime`. For clock-out corrections compare with `period.startTime`. Return `400` when end is not after start.

- [ ] **Step 4: Create pending correction and approval in one transaction**

For `isSelfCorrection && !canApprove`, resolve the manager and run one database transaction. Create the correction through the existing `createTimeEntry` helper with `isSuperseded: true`, then invoke `createTimeCorrectionApprovalWorkflow` with the transactional DB service and exactly one endpoint ID:

```ts
correctionEntryIds:
	isClockIn
		? { clockInCorrectionId: correction.id }
		: { clockOutCorrectionId: correction.id }
```

Return `{ entry: correction, approvalId: approval.approvalRequestId, message: "Correction submitted. Awaiting manager approval." }` only after the transaction commits.

- [ ] **Step 5: Preserve the direct path**

Only manager/admin-capable requests call `TimeEntryService.createCorrectionEntry` without `isSuperseded`. Use `manager_target_user_setting` for a correction made for another employee and `user_setting` for the actor's own timezone context.

- [ ] **Step 6: Run route tests and confirm GREEN**

```bash
pnpm vitest run src/app/api/time-entries/corrections/route.test.ts
```

Expected: all GET and POST tests PASS.

### Task 5: Scope Immediate Superseding Updates

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/time-entry.service.ts:317-325`
- Test: existing focused service test, or create `apps/webapp/src/lib/effect/services/time-entry.service.test.ts`

- [ ] **Step 1: Add a failing predicate assertion**

Assert the original superseding update contains ID, employee ID, and organization ID.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run src/lib/effect/services/time-entry.service.test.ts
```

- [ ] **Step 3: Add the full predicate**

```ts
.where(
	and(
		eq(timeEntry.id, input.replacesEntryId),
		eq(timeEntry.employeeId, input.employeeId),
		eq(timeEntry.organizationId, input.organizationId),
	),
)
```

- [ ] **Step 4: Confirm GREEN**

Run the focused service test again. Expected: PASS.

### Task 6: Verify the Correction Fix

- [ ] Run all focused suites:

```bash
pnpm vitest run src/app/api/time-entries/corrections/route.test.ts src/lib/approvals/server/time-correction-approvals.test.ts src/app/\[locale\]/\(app\)/time-tracking/actions/corrections.test.ts src/lib/time-tracking/timezone-capture.test.ts
```

- [ ] Run touched-file formatting/lint checks:

```bash
pnpm exec biome check src/app/api/time-entries/corrections/route.ts src/app/api/time-entries/corrections/route.test.ts src/lib/approvals/server/time-correction-approvals.ts src/lib/approvals/server/time-correction-approvals.test.ts src/lib/effect/services/time-entry.service.ts
```

- [ ] Run typecheck:

```bash
pnpm typecheck
```

Expected: all commands pass. If unrelated concurrent changes fail typecheck, record the exact failures without modifying those files.

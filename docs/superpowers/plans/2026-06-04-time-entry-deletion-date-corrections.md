# Time Entry Deletion And Date Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manager-approved time-entry deletion as an auditable zero-duration correction and allow correction forms to edit endpoint dates as well as times.

**Architecture:** Keep using the existing `time_entry` correction approval type. Add deletion metadata to `work_period`, append pending correction entries for delete requests, branch approval application by `timeCorrection.action`, and hide approved deleted periods from normal read paths with `deletedAt IS NULL` filters.

**Tech Stack:** Next.js server actions, Drizzle ORM/Postgres migrations, Effect, Luxon, TanStack Form, Vitest, Tolgee, pnpm.

---

## File Map

- Modify `apps/webapp/src/db/schema/time-tracking.ts` to add deletion columns to `workPeriod`.
- Create `apps/webapp/drizzle/0045_work_period_deletion_metadata.sql` and update `apps/webapp/drizzle/meta/_journal.json` with idx `45`, tag `0045_work_period_deletion_metadata`, and a `when` greater than `1780304304745`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts` to add date fields and deletion request input types.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/time-utils.ts` to parse local date+time in an employee timezone.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts` to use date+time correction inputs and add `requestTimeEntryDeletion`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts` to remove or stop exporting immediate hard-delete behavior from UI paths.
- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts` to store `action`, apply deletion approvals, and sync canonical `timeRecord` to zero duration.
- Modify normal read paths to exclude deleted periods: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts`, `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`, `apps/webapp/src/lib/calendar/work-period-service.ts`, and any touched summary/report query discovered by tests.
- Modify `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.ts` and tests for date defaults and validation.
- Modify `apps/webapp/src/components/time-tracking/time-correction-dialog.tsx` to render date inputs and submit date fields.
- Modify `apps/webapp/src/components/calendar/delete-work-period-dialog.tsx` and `apps/webapp/src/components/calendar/work-period-edit-dialog.tsx` to request deletion with a required reason and updated copy.
- Add/update tests in `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`, `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts`, `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`, `apps/webapp/src/lib/calendar/work-period-service.test.ts` if present or `apps/webapp/src/components/calendar/calendar-view.test.tsx`, and `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts`.

## Task 1: Schema And Type Foundation

**Files:**
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Create: `apps/webapp/drizzle/0045_work_period_deletion_metadata.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`

- [ ] **Step 1: Write the schema expectation test**

Add assertions to `apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts` or create `apps/webapp/src/db/schema/__tests__/time-tracking-schema.test.ts` if no time-tracking schema test exists:

```ts
import { describe, expect, it } from "vitest";
import { workPeriod } from "../time-tracking";

describe("workPeriod deletion metadata schema", () => {
	 it("exposes audit fields for approved deletion", () => {
		 expect(workPeriod.deletedAt.name).toBe("deleted_at");
		 expect(workPeriod.deletedBy.name).toBe("deleted_by");
		 expect(workPeriod.deletionReason.name).toBe("deletion_reason");
		 expect(workPeriod.deletionApprovalRequestId.name).toBe("deletion_approval_request_id");
	 });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/db/schema/__tests__/time-tracking-schema.test.ts`

Expected: FAIL because `workPeriod.deletedAt` is undefined.

- [ ] **Step 3: Add deletion columns to `workPeriod`**

In `apps/webapp/src/db/schema/time-tracking.ts`, add the import and fields:

```ts
import { approvalRequest } from "./approval";
```

Add inside the `workPeriod` table definition after `pendingChanges`:

```ts
		deletedAt: timestamp("deleted_at"),
		deletedBy: text("deleted_by").references(() => user.id),
		deletionReason: text("deletion_reason"),
		deletionApprovalRequestId: uuid("deletion_approval_request_id").references(
			() => approvalRequest.id,
		),
```

- [ ] **Step 4: Add the migration**

Create `apps/webapp/drizzle/0045_work_period_deletion_metadata.sql`:

```sql
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deleted_by" text;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deletion_approval_request_id" uuid;

DO $$ BEGIN
 ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "user"("id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deletion_approval_request_id_fk" FOREIGN KEY ("deletion_approval_request_id") REFERENCES "approvalRequest"("id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "workPeriod_org_deletedAt_idx" ON "work_period" ("organization_id", "deleted_at");
```

Append to `apps/webapp/drizzle/meta/_journal.json` before the closing `]`:

```json
    {
      "idx": 45,
      "version": "7",
      "when": 1780304304746,
      "tag": "0045_work_period_deletion_metadata",
      "breakpoints": true
    }
```

- [ ] **Step 5: Extend action input types**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`, replace correction interfaces with:

```ts
export interface CorrectionRequest {
	workPeriodId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason: string;
}

export interface SameDayEditRequest {
	workPeriodId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason?: string;
}

export interface TimeEntryDeletionRequest {
	workPeriodId: string;
	reason: string;
}
```

- [ ] **Step 6: Run schema/type tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/db/schema/__tests__/time-tracking-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/db/schema/time-tracking.ts apps/webapp/drizzle/0045_work_period_deletion_metadata.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts apps/webapp/src/db/schema/__tests__/time-tracking-schema.test.ts
git commit -m "feat(time): add work period deletion metadata"
```

## Task 2: Date And Time Correction Parsing

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/time-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

- [ ] **Step 1: Write failing parsing tests**

Add tests in `corrections.test.ts` that assert the action source uses explicit date fields and no longer anchors clock-out to `period.endTime` date. If this file currently uses source assertions, add:

```ts
import { describe, expect, it } from "vitest";
import { createUtcDateTime } from "./time-utils";

describe("createUtcDateTime", () => {
	it("builds a UTC instant from an employee local date and time", () => {
		const result = createUtcDateTime("2026-06-03", "18:15", "Europe/Berlin");
		expect(result?.toISOString()).toBe("2026-06-03T16:15:00.000Z");
	});

	it("allows a corrected clock-out date to be the same local date as clock-in", () => {
		const start = createUtcDateTime("2026-06-03", "09:00", "Europe/Berlin");
		const end = createUtcDateTime("2026-06-03", "17:00", "Europe/Berlin");
		expect(start?.toISOString()).toBe("2026-06-03T07:00:00.000Z");
		expect(end?.toISOString()).toBe("2026-06-03T15:00:00.000Z");
		expect(end!.getTime()).toBeGreaterThan(start!.getTime());
	});
});
```

- [ ] **Step 2: Run the parsing tests and verify failure where expected**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

Expected: FAIL if `createUtcDateTime` is not exported or corrections still reference time-only inputs.

- [ ] **Step 3: Export and use date+time parsing**

In `actions/time-utils.ts`, keep `createUtcDateTime` exported and add a small wrapper for correction endpoints:

```ts
export function createCorrectionDateTime(input: {
	date?: string;
	time?: string;
	timezone: string;
}): Date | null {
	if (!input.date || !input.time) {
		return null;
	}

	return createUtcDateTime(input.date, input.time, input.timezone);
}
```

- [ ] **Step 4: Replace `buildCorrectionTimes`**

In `actions/corrections.ts`, import `createCorrectionDateTime` and replace `buildCorrectionTimes` with:

```ts
function buildCorrectionTimes(params: {
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	timezone: string;
}): CorrectionTimesResult {
	const correctedClockInDate = createCorrectionDateTime({
		date: params.newClockInDate,
		time: params.newClockInTime,
		timezone: params.timezone,
	});

	if (!correctedClockInDate) {
		return { error: "Invalid clock in date or time" } as const;
	}

	const correctedClockOutDate =
		params.newClockOutDate && params.newClockOutTime
			? (createCorrectionDateTime({
					date: params.newClockOutDate,
					time: params.newClockOutTime,
					timezone: params.timezone,
				}) ?? undefined)
			: undefined;

	if (params.newClockOutDate && params.newClockOutTime && !correctedClockOutDate) {
		return { error: "Invalid clock out date or time" } as const;
	}

	return { correctedClockInDate, correctedClockOutDate } as const;
}
```

Update both callers to pass the new fields:

```ts
const correctionTimes = buildCorrectionTimes({
	newClockInDate: data.newClockInDate,
	newClockInTime: data.newClockInTime,
	newClockOutDate: data.newClockOutDate,
	newClockOutTime: data.newClockOutTime,
	timezone,
});
```

- [ ] **Step 5: Update tracing attributes**

In `requestTimeCorrectionEffect`, replace time-only attributes with:

```ts
attributes: {
	"correction.work_period_id": data.workPeriodId,
	"correction.clock_in_date": data.newClockInDate,
	"correction.clock_in_time": data.newClockInTime,
	"correction.clock_out_date": data.newClockOutDate || "none",
	"correction.clock_out_time": data.newClockOutTime || "none",
},
```

- [ ] **Step 6: Run correction tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/time-utils.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts
git commit -m "feat(time): accept correction endpoint dates"
```

## Task 3: Deletion Request Server Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

- [ ] **Step 1: Write failing deletion request tests**

In `corrections.test.ts`, add source-level assertions if dependency-heavy action tests are established there:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("requestTimeEntryDeletion source", () => {
	it("creates pending zero-duration correction entries and approval metadata", () => {
		const source = readFileSync(
			"apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts",
			"utf8",
		);
		expect(source).toContain("export async function requestTimeEntryDeletion");
		expect(source).toContain('action: "delete"');
		expect(source).toContain("timestamp: selectedWorkPeriod.startTime");
		expect(source).toContain("isSuperseded: true");
	});

	it("does not hard-delete work periods from the deletion request path", () => {
		const source = readFileSync(
			"apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts",
			"utf8",
		);
		expect(source).not.toContain("delete(workPeriod)");
	});
});
```

- [ ] **Step 2: Run deletion request tests and verify failure**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

Expected: FAIL because `requestTimeEntryDeletion` is missing.

- [ ] **Step 3: Extend approval workflow input**

In `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`, update the metadata type and workflow input:

```ts
type TimeCorrectionAction = "edit" | "delete";

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
		action?: TimeCorrectionAction;
		clockInCorrectionId?: string;
		clockOutCorrectionId?: string;
	};
};
```

Update `createTimeCorrectionApprovalWorkflow` input:

```ts
		correctionAction?: TimeCorrectionAction;
		correctionEntryIds?: {
			clockInCorrectionId: string;
			clockOutCorrectionId?: string;
		};
```

Update metadata construction:

```ts
const metadata: Record<string, unknown> | undefined = input.correctionEntryIds
	? {
			timeCorrection: {
				action: input.correctionAction ?? "edit",
				clockInCorrectionId: input.correctionEntryIds.clockInCorrectionId,
				clockOutCorrectionId: input.correctionEntryIds.clockOutCorrectionId,
			},
		}
	: undefined;
```

- [ ] **Step 4: Add `requestTimeEntryDeletion`**

In `actions/corrections.ts`, add the action after `requestTimeCorrectionEffect`:

```ts
export async function requestTimeEntryDeletion(
	data: TimeEntryDeletionRequest,
): Promise<ServerActionResult<{ approvalId: string }>> {
	if (!data.reason.trim()) {
		return { success: false, error: "Reason is required" };
	}

	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const selectedWorkPeriod = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.id, data.workPeriodId),
			eq(workPeriod.employeeId, currentEmployee.id),
			eq(workPeriod.organizationId, currentEmployee.organizationId),
		),
	});

	if (!selectedWorkPeriod) {
		return { success: false, error: "Work period not found" };
	}

	if (!selectedWorkPeriod.endTime || !selectedWorkPeriod.clockOutId) {
		return { success: false, error: "Cannot delete an active work period. Please clock out first." };
	}

	const pendingApproval = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.organizationId, currentEmployee.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, selectedWorkPeriod.id),
			eq(approvalRequest.status, "pending"),
		),
	});

	if (pendingApproval) {
		return {
			success: false,
			error: "A time correction approval is already pending for this work period",
			code: "pending_time_correction_approval",
		};
	}

	const managerDecision = await resolveCorrectionApprovalManager({
		db,
		requesterEmployeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
	});

	if (!managerDecision.ok) {
		return { success: false, error: managerDecision.message };
	}

	const timezone = await getUserTimezone(session.user.id);
	const deletionTimestamp = selectedWorkPeriod.startTime;
	const timezoneCapture = resolveFallbackTimezoneCapture({
		timestamp: deletionTimestamp,
		timezone,
		timezoneSource: "user_setting",
	});

	const result = await db.transaction(async (tx) => {
		const transactionalDbService = { db: tx, query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn) };
		const clockInCorrection = await createTimeEntry(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				type: "correction",
				timestamp: deletionTimestamp,
				createdBy: session.user.id,
				...timezoneCapture,
				replacesEntryId: selectedWorkPeriod.clockInId,
				notes: data.reason,
				isSuperseded: true,
			},
			tx,
		);
		const clockOutCorrection = await createTimeEntry(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				type: "correction",
				timestamp: deletionTimestamp,
				createdBy: session.user.id,
				...timezoneCapture,
				replacesEntryId: selectedWorkPeriod.clockOutId!,
				notes: data.reason,
				isSuperseded: true,
			},
			tx,
		);

		const approval = await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(transactionalDbService, {
				organizationId: currentEmployee.organizationId,
				requesterEmployeeId: currentEmployee.id,
				teamId: currentEmployee.teamId ?? null,
				workPeriodId: selectedWorkPeriod.id,
				defaultApproverId: managerDecision.managerId,
				reason: data.reason,
				overtimeRisk: "none",
				correctionAction: "delete",
				correctionEntryIds: {
					clockInCorrectionId: clockInCorrection.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			}),
		);

		return approval;
	});

	return { success: true, data: { approvalId: result.approvalRequestId } };
}
```

Add `TimeEntryDeletionRequest` to the type import from `./types`.

- [ ] **Step 5: Stop UI paths from using immediate delete**

Leave `deleteWorkPeriod` in `actions/mutations.ts` only if other internal callers still need it, but no UI component should import it after Task 6. If retaining it, add this guard at the top of the function to prevent accidental use:

```ts
return { success: false, error: "Deletion requires manager approval" };
```

- [ ] **Step 6: Run deletion request tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.ts
git commit -m "feat(time): request deletion approval"
```

## Task 4: Approval Application For Deletions

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

- [ ] **Step 1: Write failing approval tests**

In `time-correction-approvals.test.ts`, add a case near the existing approval application tests:

```ts
it("applies deletion approvals as zero-duration deleted work periods", async () => {
	const dbService = createTimeCorrectionDecisionDbService();
	const deletionTimestamp = new Date("2026-06-03T07:00:00.000Z");
	const deletionClockIn = { ...correction, id: "delete-in", timestamp: deletionTimestamp, replacesEntryId: period.clockInId, isSuperseded: true };
	const deletionClockOut = { ...clockOutCorrection, id: "delete-out", timestamp: deletionTimestamp, replacesEntryId: period.clockOutId, isSuperseded: true };

	dbService.db.query.timeEntry.findFirst
		.mockResolvedValueOnce(deletionClockIn)
		.mockResolvedValueOnce(deletionClockOut);

	await runTimeCorrectionDecisionEffect(
		approveTimeCorrectionWithCurrentApproverEffect(dbService, approver, period.id, {
			approvalOverride: {
				...approval,
				metadata: {
					timeCorrection: {
						action: "delete",
						clockInCorrectionId: deletionClockIn.id,
						clockOutCorrectionId: deletionClockOut.id,
					},
				},
			},
		}),
	);

	expect(dbService.db.update).toHaveBeenCalledWith(workPeriod);
	expect(dbService.updateSetCalls).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				clockInId: deletionClockIn.id,
				clockOutId: deletionClockOut.id,
				startTime: deletionTimestamp,
				endTime: deletionTimestamp,
				durationMinutes: 0,
				deletedAt: expect.any(Date),
				deletedBy: approver.userId,
				deletionReason: approval.reason,
				deletionApprovalRequestId: approval.id,
			}),
		]),
	);
});
```

Adapt mock property names to the existing helper names in the test file. The important assertions are zero duration, deletion metadata, and correction entry IDs.

- [ ] **Step 2: Run approval test and verify failure**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected: FAIL because deletion metadata is ignored and zero duration is rejected by `validateCorrectedPeriodRange`.

- [ ] **Step 3: Add action resolver and delete range exception**

In `time-correction-approvals.ts`, add:

```ts
function correctionActionFromApproval(approval: PendingApprovalRequest): TimeCorrectionAction {
	return correctionEntryIdsFromApproval(approval)?.action ?? "edit";
}
```

Replace the validation call in `handleApprovedTimeCorrection` with:

```ts
const correctionAction = correctionActionFromApproval(approval);
if (correctionAction === "edit") {
	yield* _(
		validateCorrectedPeriodRange(
			clockInCorrection,
			clockOutCorrection?.timestamp ?? period.endTime,
		),
	);
}
```

- [ ] **Step 4: Add deletion period calculation**

Add:

```ts
function calculateDeletedPeriod(clockIn: CorrectionEntry, clockOut: CorrectionEntry) {
	return {
		endTime: clockOut.timestamp,
		durationMinutes: 0,
		clockOutId: clockOut.id,
	};
}
```

In `handleApprovedTimeCorrection`, compute:

```ts
const correctedPeriod =
	correctionAction === "delete" && clockOutCorrection
		? calculateDeletedPeriod(clockInCorrection, clockOutCorrection)
		: calculateCorrectedPeriod(period, clockInCorrection, clockOutCorrection);
```

If `correctionAction === "delete"` and `clockOutCorrection` is missing, fail with:

```ts
return yield* _(
	Effect.fail(
		new ValidationError({
			message: "Deletion approval requires clock-in and clock-out correction entries",
			field: "timeCorrection.clockOutCorrectionId",
		}),
	),
);
```

- [ ] **Step 5: Add deletion metadata update**

Change `applyTimeCorrection` signature to accept `approval`, `currentEmployee`, and `correctionAction`, then set:

```ts
const deletionFields =
	correctionAction === "delete"
		? {
				deletedAt: new Date(),
				deletedBy: currentEmployee.userId,
				deletionReason: approval.reason ?? null,
				deletionApprovalRequestId: approval.id,
			}
		: {};

await dbService.db
	.update(workPeriod)
	.set({
		clockInId: clockInCorrection.id,
		clockOutId: correctedPeriod.clockOutId,
		startTime: clockInCorrection.timestamp,
		endTime: correctedPeriod.endTime,
		durationMinutes: correctedPeriod.durationMinutes,
		updatedAt: new Date(),
		...deletionFields,
	})
	.where(eq(workPeriod.id, entityId));
```

- [ ] **Step 6: Sync canonical record to zero duration**

Ensure `syncCanonicalWorkCorrection` is called after applying the correction with the computed `correctedPeriod`. For deletion, the existing call should receive equal `startAt` and `endAt` plus `durationMinutes: 0`:

```ts
yield* _(
	Effect.promise(() =>
		syncCanonicalWorkCorrection({
			organizationId: period.organizationId,
			canonicalRecordId: period.canonicalRecordId,
			startAt: clockInCorrection.timestamp,
			endAt: correctedPeriod.endTime,
			durationMinutes: correctedPeriod.durationMinutes,
			updatedBy: currentEmployee.userId,
		}),
	),
);
```

- [ ] **Step 7: Run approval tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/webapp/src/lib/approvals/server/time-correction-approvals.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts
git commit -m "feat(approvals): apply time deletion approvals"
```

## Task 5: Hide Deleted Periods From Normal Reads

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`
- Modify: `apps/webapp/src/lib/calendar/work-period-service.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.test.ts` if present, `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts`, and calendar service tests.

- [ ] **Step 1: Write failing filtering tests**

Add a source assertion test if the query tests mock Drizzle deeply:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("normal time queries", () => {
	it("exclude approved deleted work periods", () => {
		const queries = readFileSync(
			"apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts",
			"utf8",
		);
		const calendar = readFileSync("apps/webapp/src/lib/calendar/work-period-service.ts", "utf8");
		const timeline = readFileSync(
			"apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts",
			"utf8",
		);

		expect(queries).toContain("isNull(workPeriod.deletedAt)");
		expect(calendar).toContain("isNull(workPeriod.deletedAt)");
		expect(timeline).toContain("isNull(workPeriod.deletedAt)");
	});
});
```

- [ ] **Step 2: Run filtering tests and verify failure**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts apps/webapp/src/lib/calendar/work-period-service.test.ts`

Expected: FAIL until `deletedAt` filters are present.

- [ ] **Step 3: Filter `getWorkPeriods` and `getTimeSummary`**

In `actions/queries.ts`, add `isNull(workPeriod.deletedAt)` to normal period predicates:

```ts
where: and(
	eq(workPeriod.employeeId, employeeId),
	gte(workPeriod.startTime, startDate),
	lte(workPeriod.startTime, endDate),
	isNull(workPeriod.deletedAt),
),
```

For `getTimeSummary`, add the same filter in the `.where(and(...))` block:

```ts
isNull(workPeriod.deletedAt),
```

Do not add this filter to `getActiveWorkPeriod` unless deleted active rows become possible; deletion only applies to completed periods.

- [ ] **Step 4: Filter calendar month service**

In `work-period-service.ts`, add to `conditions`:

```ts
isNull(workPeriod.deletedAt),
```

- [ ] **Step 5: Filter workday timeline data**

In `workday-timeline-data.ts`, locate the work-period query and add:

```ts
isNull(workPeriod.deletedAt),
```

inside the organization/employee/date predicate.

- [ ] **Step 6: Run read-path tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts apps/webapp/src/lib/calendar/work-period-service.test.ts apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts apps/webapp/src/lib/calendar/work-period-service.test.ts
git commit -m "feat(time): hide deleted periods from normal views"
```

## Task 6: Correction Dialog Date Inputs

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog.tsx`
- Test: `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts`

- [ ] **Step 1: Write failing dialog utility tests**

Create or update `time-correction-dialog-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTimeCorrectionDefaultValues, isValidClockRange } from "./time-correction-dialog-utils";

describe("time correction dialog date defaults", () => {
	it("defaults endpoint dates in the employee timezone", () => {
		const values = getTimeCorrectionDefaultValues(
			{
				id: "period-1",
				startTime: new Date("2026-06-03T22:30:00.000Z"),
				endTime: new Date("2026-06-04T01:15:00.000Z"),
				clockOut: { notes: "Forgot clockout" },
			},
			"Europe/Berlin",
		);

		expect(values.clockInDate).toBe("2026-06-04");
		expect(values.clockInTime).toBe("00:30");
		expect(values.clockOutDate).toBe("2026-06-04");
		expect(values.clockOutTime).toBe("03:15");
		expect(values.reason).toBe("Forgot clockout");
	});

	it("validates date and time together", () => {
		expect(isValidClockRange("2026-06-03", "09:00", "2026-06-03", "17:00")).toBe(true);
		expect(isValidClockRange("2026-06-03", "17:00", "2026-06-03", "09:00")).toBe(false);
		expect(isValidClockRange("2026-06-03", "22:00", "2026-06-04", "01:00")).toBe(true);
	});
});
```

- [ ] **Step 2: Run utility tests and verify failure**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts`

Expected: FAIL because date fields are missing.

- [ ] **Step 3: Update form values and defaults**

In `time-correction-dialog-utils.ts`, replace the form interface and helpers:

```ts
import { DateTime } from "luxon";
import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";

export interface TimeCorrectionFormValues {
	clockInDate: string;
	clockInTime: string;
	clockOutDate: string;
	clockOutTime: string;
	reason: string;
}

function formatDateInZone(date: Date, timezone: string): string {
	return DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).toISODate() ?? "";
}

export function getTimeCorrectionDefaultValues(
	workPeriod: TimeCorrectionWorkPeriod,
	employeeTimezone: string,
): TimeCorrectionFormValues {
	return {
		clockInDate: formatDateInZone(workPeriod.startTime, employeeTimezone),
		clockInTime: formatTimeInZone(workPeriod.startTime, employeeTimezone),
		clockOutDate: workPeriod.endTime ? formatDateInZone(workPeriod.endTime, employeeTimezone) : "",
		clockOutTime: workPeriod.endTime ? formatTimeInZone(workPeriod.endTime, employeeTimezone) : "",
		reason: workPeriod.clockOut?.notes || "",
	};
}

export function isValidClockRange(
	clockInDate: string,
	clockInTime: string,
	clockOutDate: string,
	clockOutTime: string,
): boolean {
	if (!clockOutDate || !clockOutTime) {
		return true;
	}

	const start = DateTime.fromISO(`${clockInDate}T${clockInTime}`);
	const end = DateTime.fromISO(`${clockOutDate}T${clockOutTime}`);

	return start.isValid && end.isValid && end.toMillis() > start.toMillis();
}
```

- [ ] **Step 4: Render date inputs and submit date fields**

In `time-correction-dialog.tsx`, update validation:

```ts
if (
	!isValidClockRange(
		value.clockInDate,
		value.clockInTime,
		value.clockOutDate,
		value.clockOutTime,
	)
) {
```

Update server action payloads:

```ts
newClockInDate: value.clockInDate,
newClockInTime: value.clockInTime,
newClockOutDate: value.clockOutDate || undefined,
newClockOutTime: value.clockOutTime || undefined,
```

Add date fields before each `TimeInput`:

```tsx
<form.Field name="clockInDate">
	{(field) => (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>{t("timeTracking.correction.clockInDate", "Clock In Date")}</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<input
					type="date"
					name="clockInDate"
					className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					required
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	)}
</form.Field>
```

Repeat with `clockOutDate`, label `Clock Out Date`, and `required={Boolean(workPeriod.endTime)}`.

- [ ] **Step 5: Run dialog tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/components/time-tracking/time-correction-dialog-utils.ts apps/webapp/src/components/time-tracking/time-correction-dialog.tsx apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts
git commit -m "feat(time): add correction date fields"
```

## Task 7: Delete Dialog UI

**Files:**
- Modify: `apps/webapp/src/components/calendar/delete-work-period-dialog.tsx`
- Modify: `apps/webapp/src/components/calendar/work-period-edit-dialog.tsx`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Update the delete dialog tests or `calendar-view.test.tsx` mocks to assert the new copy. If no direct dialog test exists, create `apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteWorkPeriodDialog } from "./delete-work-period-dialog";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({ requestTimeEntryDeletion: vi.fn() }));

const event = {
	id: "period-1",
	type: "work_period",
	date: new Date("2026-06-03T07:00:00.000Z"),
	endDate: new Date("2026-06-03T15:00:00.000Z"),
	title: "Work",
	description: "Work period",
	color: "#10b981",
	metadata: { durationMinutes: 480 },
} as const;

describe("DeleteWorkPeriodDialog", () => {
	it("uses manager approval deletion copy", () => {
		render(<DeleteWorkPeriodDialog event={event} open onOpenChange={vi.fn()} />);
		expect(screen.getByText("Request deletion?")).toBeTruthy();
		expect(screen.getByText("Delete entry")).toBeTruthy();
		expect(screen.getByLabelText("Reason for deletion")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run UI test and verify failure**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx`

Expected: FAIL because the dialog still says `Convert to Break` and has no reason field.

- [ ] **Step 3: Update delete dialog action and state**

In `delete-work-period-dialog.tsx`, import `requestTimeEntryDeletion` and add reason state:

```ts
import { requestTimeEntryDeletion } from "@/app/[locale]/(app)/time-tracking/actions";
import { Textarea } from "@/components/ui/textarea";

const [reason, setReason] = useState("");
```

Update `handleDelete`:

```ts
if (!reason.trim()) {
	toast.error(t("calendar.delete.reasonRequired", "Reason is required"));
	return;
}

setIsDeleting(true);
const result = await requestTimeEntryDeletion({ workPeriodId: event.id, reason: reason.trim() }).catch(
	() => null,
);
```

Update success toast:

```ts
toast.success(t("calendar.delete.requestSubmitted", "Deletion request submitted for manager approval"));
```

- [ ] **Step 4: Update dialog copy and reason field**

Replace title/description/button text:

```tsx
<AlertDialogTitle>{t("calendar.delete.title", "Request deletion?")}</AlertDialogTitle>
```

```tsx
{t(
	"calendar.delete.description",
	"This will hide the time entry after manager approval. The audit history and time-entry chain will be preserved.",
)}
```

Add before the audit note:

```tsx
<div className="space-y-2">
	<label htmlFor="delete-reason" className="text-sm font-medium">
		{t("calendar.delete.reasonLabel", "Reason for deletion")}
	</label>
	<Textarea
		id="delete-reason"
		value={reason}
		onChange={(event) => setReason(event.target.value)}
		aria-label={t("calendar.delete.reasonLabel", "Reason for deletion")}
		required
	/>
</div>
```

Update confirm button fallback:

```tsx
{t("calendar.delete.confirm", "Delete entry")}
```

- [ ] **Step 5: Update work-period action button copy**

In `work-period-edit-dialog.tsx`, replace:

```tsx
{t("calendar.edit.convertToBreak", "Delete entry")}
```

- [ ] **Step 6: Run UI tests**

Run: `pnpm --filter @z8/webapp test apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/components/calendar/delete-work-period-dialog.tsx apps/webapp/src/components/calendar/work-period-edit-dialog.tsx apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat(calendar): request time deletion approval"
```

## Task 8: Final Verification

**Files:**
- No new files unless verification exposes a targeted fix.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader time-tracking tests**

Run:

```bash
pnpm --filter @z8/webapp test apps/webapp/src/app/[locale]/(app)/time-tracking
```

Expected: PASS.

- [ ] **Step 3: Run type/lint check available in repo**

Run:

```bash
pnpm --filter @z8/webapp typecheck
```

Expected: PASS. If the repo has no `typecheck` script, run `pnpm --filter @z8/webapp lint` and record the script availability in the final summary.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended files from this plan plus pre-existing unrelated worktree changes remain. Do not revert unrelated changes.

- [ ] **Step 5: Commit verification fixes if any**

If Step 1, 2, or 3 required fixes, commit the targeted fix. Stage only the files changed by the fix, such as:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.ts
git commit -m "fix(time): stabilize deletion correction flow"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: schema metadata is covered by Task 1; date+time correction parsing by Task 2; deletion request creation by Task 3; approval application and canonical sync by Task 4; hidden normal views by Task 5; correction UI by Task 6; delete dialog UI by Task 7; verification by Task 8.
- Red-flag scan: the plan contains complete requirements and concrete file staging commands.
- Type consistency: `CorrectionRequest`, `SameDayEditRequest`, `TimeEntryDeletionRequest`, `TimeCorrectionAction`, and `timeCorrection.action` are introduced before use and reused consistently.

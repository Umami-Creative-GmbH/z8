# Time Correction Panel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the time correction panel compact and aligned while adding work location and work category changes to the same atomic correction workflow.

**Architecture:** Extend the strict time-correction contract with full proposed work metadata, then carry that metadata through direct edits, durable submission identity, approval persistence, finalization, cancellation, and approval display. Reuse the existing location and category selectors in a top-aligned responsive form; no database migration is required because both legacy and canonical work metadata columns already exist.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Form, Tailwind CSS, Drizzle ORM/PostgreSQL, Effect, Vitest, Testing Library, Temporal boundary helpers.

**Design:** `docs/superpowers/specs/2026-08-19-time-correction-panel-layout-design.md`

**Repository constraint:** Do not create commits unless the user explicitly requests them.

---

## File Map

- `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.ts`: strict persisted payload and idempotency identity.
- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`: client/server correction request types.
- `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`: authorization, category validation, direct edits, and correction submission.
- `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`: persisted approval metadata, replay, and terminal application.
- `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.ts`: canonical source loading and terminal adapter evidence.
- `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.ts`: legacy observation and replay evidence.
- `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`: cancellation with optional correction rows.
- `apps/webapp/src/lib/approvals/time-request-kind.ts`: strict legacy marker recognition.
- `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`: canonical-to-legacy metadata parity.
- `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`: review data and category-name resolution.
- `apps/webapp/src/lib/approvals/inbox/read-service.ts`: unified inbox detail rows.
- `apps/webapp/src/lib/approvals/server/queries.ts`: legacy approval list query.
- `apps/webapp/src/lib/approvals/server/types.ts`: legacy approval DTO.
- `apps/webapp/src/components/approvals/time-correction-approvals-table.tsx`: legacy approval presentation.
- `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.ts`: form defaults and routing helpers.
- `apps/webapp/src/components/time-tracking/time-correction-dialog.tsx`: compact panel and selectors.
- `apps/webapp/src/components/time-tracking/time-entries-table.tsx`: employee ID plumbing.
- `apps/webapp/src/components/time-tracking/time-entries-table-columns.tsx`: complete period metadata type.

### Task 1: Extend The Strict Correction Contract

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.test.ts`
- Modify: `apps/webapp/src/lib/approvals/time-request-kind.ts`
- Modify: `apps/webapp/src/lib/approvals/time-request-kind.test.ts`

- [ ] **Step 1: Add failing workflow payload tests**

Add cases proving that an edit payload accepts explicit proposed metadata with no endpoint IDs, rejects unknown locations and malformed category IDs, and still requires both endpoint IDs for deletion:

```ts
expect(
	normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: {
			action: "edit",
			workLocationType: "home",
			workCategoryId: null,
		},
	}),
).toEqual({
	timeCorrection: {
		action: "edit",
		workLocationType: "home",
		workCategoryId: null,
	},
});

expect(() =>
	normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: {
			action: "edit",
			workLocationType: "invalid",
			workCategoryId: null,
		},
	}),
).toThrow(TimeCorrectionWorkflowPayloadError);
```

- [ ] **Step 2: Add failing submission identity tests**

Use one base identity and prove changing only location or category changes the key. Prove metadata-only edit identity is valid and a delete without endpoint evidence remains invalid.

```ts
const base = {
	organizationId: "org-1",
	workPeriodId: "41000000-0000-4000-8000-000000000001",
	action: "edit" as const,
	workLocationType: "office" as const,
	workCategoryId: null,
};

expect(deriveTimeCorrectionSubmissionKey(base)).not.toBe(
	deriveTimeCorrectionSubmissionKey({ ...base, workLocationType: "home" }),
);
```

- [ ] **Step 3: Run contract tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/time-request-kind.test.ts
```

Expected: failures because work metadata is not an allowed payload or identity field.

- [ ] **Step 4: Extend the contract types and normalization**

Use the existing location domain type and explicit nullable category semantics:

```ts
import {
	isWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";

export interface TimeCorrectionWorkflowPayload {
	readonly timeCorrection: {
		readonly action: TimeCorrectionAction;
		readonly clockInCorrectionId?: string;
		readonly clockOutCorrectionId?: string;
		readonly workLocationType: WorkLocationType;
		readonly workCategoryId: string | null;
	};
}

export interface TimeCorrectionSubmissionIdentityInput {
	readonly organizationId: string;
	readonly workPeriodId: string;
	readonly action: TimeCorrectionAction;
	readonly workLocationType: WorkLocationType;
	readonly workCategoryId: string | null;
	readonly clockIn?: TimeCorrectionIdentityEndpoint;
	readonly clockOut?: TimeCorrectionIdentityEndpoint;
}
```

Require `workLocationType` and `workCategoryId` in `snapshotStrictObject()`. Normalize a non-null category with `normalizedUuid()`. Permit zero endpoints only for `action === "edit"`; the submission layer will prove that metadata actually changed. Append stable `work_location`, location value, `work_category`, and category-or-empty segments to the SHA-256 input.

- [ ] **Step 5: Extend strict marker recognition**

Update `timeCorrectionMarker()` in `time-request-kind.ts` to accept exactly the extended key set, validate location with `isWorkLocationType()`, and require `workCategoryId` to be either `null` or a UUID. Preserve zero-endpoint edit classification and two-endpoint delete requirements.

- [ ] **Step 6: Run contract tests and verify GREEN**

Run the command from Step 3. Expected: both files pass.

### Task 2: Add Request Types, Validation, And Direct Atomic Metadata Edits

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

- [ ] **Step 1: Add failing action behavior tests**

Add focused cases for:

- invalid `workLocationType` returns a location validation error;
- category from another organization, inactive category, or category unavailable to the employee is rejected;
- a same-day metadata-only edit updates `work_period` and `time_record_work` in one transaction;
- a transaction failure leaves both unchanged;
- a completely unchanged request returns `At least one correction value must change`.

Use explicit request metadata in all fixtures:

```ts
const correctionMetadata = {
	workLocationType: "home" as const,
	workCategoryId: "51000000-0000-4000-8000-000000000001",
};
```

- [ ] **Step 2: Run action tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts'
```

Expected: request types and direct metadata writes are absent.

- [ ] **Step 3: Extend request types**

```ts
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

interface CorrectionWorkMetadata {
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}

export interface CorrectionRequest extends CorrectionWorkMetadata {
	// existing timestamp, reason, workPeriodId, and submissionId fields
}

export interface SameDayEditRequest extends CorrectionWorkMetadata {
	// existing timestamp, reason, and workPeriodId fields
}
```

- [ ] **Step 4: Add transaction-aware metadata validation**

In `time-correction-submission.ts`, import `workCategory`, `timeRecord`, `timeRecordWork`, `isWorkLocationType`, and the existing employee/category assignment tables used by `validateWorkCategoryAssignment()` in `actions/clocking.ts`.

Add one organization-scoped helper that accepts the current transaction:

```ts
async function validateCorrectionWorkMetadata(input: {
	tx: typeof db;
	organizationId: string;
	employeeId: string;
	workLocationType: unknown;
	workCategoryId: unknown;
}): Promise<{ workLocationType: WorkLocationType; workCategoryId: string | null }> {
	if (!isWorkLocationType(input.workLocationType)) {
		throw new ValidationError({
			message: "Invalid work location",
			field: "workLocationType",
		});
	}
	if (input.workCategoryId !== null && typeof input.workCategoryId !== "string") {
		throw new ValidationError({
			message: "Invalid work category",
			field: "workCategoryId",
		});
	}
	// Query an active, organization-owned category and the employee's existing
	// category-set access in this transaction. Throw the same field error unless
	// exactly one accessible category is found.
	return {
		workLocationType: input.workLocationType,
		workCategoryId: input.workCategoryId,
	};
}
```

Use the exact access joins and active-state predicate from `validateWorkCategoryAssignment()` rather than calling a non-transactional query during a locked write.

- [ ] **Step 5: Make direct edits metadata-aware and atomic**

Inside the existing `db.transaction()`:

1. Validate metadata after locking the employee/work period.
2. Determine timestamp and metadata differences.
3. Create endpoint correction rows only for changed timestamps.
4. Update the organization/employee-scoped `workPeriod` metadata.
5. Find the canonical work record by `sourceTable === "work_period"` and `sourceId === selectedWorkPeriod.id`, then update its organization-scoped `timeRecordWork` row.

Use scoped writes:

```ts
await tx
	.update(workPeriod)
	.set({ workLocationType, workCategoryId })
	.where(
		and(
			eq(workPeriod.id, selectedWorkPeriod.id),
			eq(workPeriod.employeeId, currentEmployee.id),
			eq(workPeriod.organizationId, currentEmployee.organizationId),
		),
	);

await tx
	.update(timeRecordWork)
	.set({ workLocationType, workCategoryId })
	.where(
		and(
			eq(timeRecordWork.recordId, canonicalRecord.id),
			eq(timeRecordWork.organizationId, currentEmployee.organizationId),
		),
	);
```

Do not create a synthetic correction entry for a metadata-only edit. Keep pending-approval checks and policy evaluation unchanged.

- [ ] **Step 6: Carry validated metadata into approval submission**

In `submissionEffect()` and `submitCorrection()`:

- compare proposed values with the locked period;
- replace `endpoints.length === 0` validation with a combined timestamp/metadata change check;
- pass metadata into `deriveTimeCorrectionSubmissionKey()`;
- include metadata in the trusted `correction` payload passed to `executeTimeCorrectionSubmissionInTransaction()`.

- [ ] **Step 7: Run action tests and verify GREEN**

Run the command from Step 2. Expected: both files pass.

### Task 3: Persist And Replay Metadata In Approval Workflows

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`

- [ ] **Step 1: Add failing persistence and replay tests**

Cover all lifecycle modes used by the existing parameterized suite:

- legacy metadata and canonical context snapshot contain exact proposed metadata;
- display projection contains original/requested location and category IDs;
- identical replay succeeds;
- same submission token with changed location or category conflicts;
- metadata-only submission creates a pending approval without correction rows;
- auto-completed metadata-only submission applies once and replays without duplicate writes.

- [ ] **Step 2: Run approval persistence tests and verify RED**

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: metadata fields are dropped or rejected.

- [ ] **Step 3: Extend approval metadata and equality**

Extend `TimeCorrectionApprovalMetadata` and every constructor to carry:

```ts
type ProposedWorkMetadata = {
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
};
```

Update `sameCorrectionPayload()` to compare action, optional endpoint IDs, location, and nullable category exactly. Do not use truthiness for `workCategoryId`; `null` means remove the current category.

- [ ] **Step 4: Persist metadata in both authorities**

Ensure `createTimeCorrectionApprovalWorkflow()`, canonical `contextSnapshot`, canonical `displayProjection`, legacy `approval_request.metadata`, and `timeCorrectionCompatibilityPayload()` all use the same normalized payload. Add original metadata to display-only snapshots so approval views can show a before/after value without trusting current viewer state.

- [ ] **Step 5: Remove endpoint-only assumptions**

In submission, replay, auto-completion, and post-commit loaders:

- allow an empty correction-entry list for edit payloads with changed metadata;
- retain two endpoint requirements for delete;
- skip endpoint maintenance when no endpoint is proposed;
- do not invent a work-balance dirty date for metadata-only changes.

- [ ] **Step 6: Run unit and integration suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: PASS.

Then run the repository-backed suite if its container prerequisites are available:

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

Expected: approval migration verification and repository integration tests pass. If unavailable, record the exact environmental blocker rather than claiming integration coverage.

### Task 4: Apply, Reject, And Cancel Metadata Corrections Safely

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

- [ ] **Step 1: Add failing terminal-state tests**

Add cases proving:

- approval atomically updates `work_period` and its organization-scoped `time_record_work` row;
- rejection leaves both rows unchanged;
- requester cancellation leaves both rows unchanged and succeeds with zero correction rows;
- finalization rejects a stale period whose original metadata no longer matches trusted evidence;
- foreign-organization canonical work evidence cannot be loaded or updated.

- [ ] **Step 2: Run adapter/finalizer tests and verify RED**

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts \
  src/lib/approvals/server/time-correction-cancellation.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: metadata-only source capture/finalization is rejected or ignored.

- [ ] **Step 3: Extend adapter source evidence**

Add original period and canonical work metadata to `TimeCorrectionApprovalSource`. Load and lock `timeRecordWork` by both `recordId` and `organizationId`. Permit both endpoint proposals to be absent only for edit payloads with valid changed metadata.

```ts
type TimeCorrectionWorkMetadataEvidence = {
	workLocationType: WorkLocationType | null;
	workCategoryId: string | null;
};
```

Validate that legacy work-period and canonical work-record metadata agree before terminal mutation.

- [ ] **Step 4: Extend legacy observation**

Update legacy SQL projections and stable evidence construction to include original and proposed metadata. Preserve strict payload comparison during capture and replay. Do not classify a trusted zero-endpoint edit as orphaned.

- [ ] **Step 5: Apply approved metadata in the finalizer transaction**

After all stale-state and authorization checks pass, update both representations using the same proposed values:

```ts
await tx
	.update(workPeriod)
	.set({
		workLocationType: correction.workLocationType,
		workCategoryId: correction.workCategoryId,
	})
	.where(scopedLockedPeriodPredicate);

await tx
	.update(timeRecordWork)
	.set({
		workLocationType: correction.workLocationType,
		workCategoryId: correction.workCategoryId,
	})
	.where(scopedCanonicalWorkPredicate);
```

Endpoint activation/supersession remains conditional on endpoint evidence. Rejection performs neither update.

- [ ] **Step 6: Permit metadata-only cancellation**

Replace the unconditional `correctionIds.length === 0` rejection with action-aware validation. For zero-row edits, verify trusted metadata, workflow ownership, and unchanged source state, then complete cancellation without deletion. Keep delete requests and endpoint corrections on existing row-deletion paths.

- [ ] **Step 7: Run terminal-state tests and verify GREEN**

Run the command from Step 2. Expected: all four files pass.

### Task 5: Show Metadata Changes In Approval Details

**Files:**
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/detail-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/queries.ts`
- Modify: `apps/webapp/src/lib/approvals/server/queries.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/types.ts`
- Modify: `apps/webapp/src/components/approvals/time-correction-approvals-table.tsx`
- Modify: `apps/webapp/src/components/approvals/time-correction-approvals-table.test.tsx`

- [ ] **Step 1: Add failing handler and presentation tests**

Test a metadata-only request and a mixed timestamp/metadata request. Assert:

- neither is marked orphaned;
- location and category rows render only when changed;
- category IDs are resolved to names with an organization-scoped query;
- category removal displays the existing no-category label;
- unchanged metadata is omitted.

- [ ] **Step 2: Run presentation tests and verify RED**

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts \
  src/lib/approvals/server/queries.test.ts \
  src/components/approvals/time-correction-approvals-table.test.tsx
```

Expected: metadata-only requests are treated as missing corrections and no metadata rows exist.

- [ ] **Step 3: Extend review DTOs and category resolution**

Add optional changed-value pairs to unified and legacy DTOs:

```ts
type CorrectionDisplayChange = {
	original: string;
	requested: string;
};

type TimeCorrectionMetadataChanges = {
	workLocation?: CorrectionDisplayChange;
	workCategory?: CorrectionDisplayChange;
};
```

Resolve category names using `and(eq(workCategory.organizationId, organizationId), inArray(workCategory.id, ids))`. Use translated location labels at the UI boundary, not persisted translated strings.

- [ ] **Step 4: Build conditional detail rows**

In `buildTimeCorrectionDetailSections()`, append rows only when original and requested values differ. Preserve the existing original/requested time rows when endpoints exist; do not require them for metadata-only requests.

- [ ] **Step 5: Update the legacy table**

Render the same changed metadata below the time comparison. Use compact label/value rows and the existing muted/foreground hierarchy. Do not render empty placeholders for absent endpoint corrections.

- [ ] **Step 6: Run presentation tests and verify GREEN**

Run the command from Step 2. Expected: all four files pass.

### Task 6: Add Metadata Defaults And Table Plumbing

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog-utils.test.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table-columns.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table-columns.test.tsx`

- [ ] **Step 1: Add failing default and plumbing tests**

Assert that defaults preserve current metadata, historical null location falls back through `normalizeWorkLocationType()`, null category remains null, and `TimeEntriesTable` passes `employeeId` plus full period metadata to the dialog.

```ts
expect(getTimeCorrectionDefaultValues(period, "Europe/Berlin")).toMatchObject({
	workLocationType: "home",
	workCategoryId: "51000000-0000-4000-8000-000000000001",
});
```

- [ ] **Step 2: Run utility/table tests and verify RED**

```bash
pnpm --filter webapp exec vitest run \
  src/components/time-tracking/time-correction-dialog-utils.test.ts \
  src/components/time-tracking/time-entries-table.test.tsx \
  src/components/time-tracking/time-entries-table-columns.test.tsx
```

Expected: form and narrowed period types omit metadata.

- [ ] **Step 3: Extend form and period types**

```ts
export interface TimeCorrectionFormValues {
	clockInDate: string;
	clockInTime: string;
	clockOutDate: string;
	clockOutTime: string;
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
	reason: string;
}

export interface TimeCorrectionWorkPeriod {
	id: string;
	startTime: Date;
	endTime: Date | null;
	workLocationType: WorkLocationType | null;
	workCategoryId: string | null;
	clockOut?: { notes: string | null } | null;
}
```

Set defaults with `normalizeWorkLocationType(workPeriod.workLocationType)` and preserve explicit category null.

- [ ] **Step 4: Add one shared change detector**

Add `hasTimeCorrectionChanges()` that compares parsed endpoint instants and both metadata values against the selected period. Use it in the dialog before submission so metadata-only edits pass and unchanged forms show the same server-aligned validation message.

- [ ] **Step 5: Pass employee and metadata through table types**

Pass the existing `employeeId` prop from `TimeEntriesTable` to `TimeCorrectionDialog`. Extend only the narrowed `WorkPeriodData` types; do not add another data fetch because `getWorkPeriods()` already returns these columns.

- [ ] **Step 6: Run utility/table tests and verify GREEN**

Run the command from Step 2. Expected: all three files pass.

### Task 7: Build The Compact Responsive Panel

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog.test.tsx`

- [ ] **Step 1: Add failing interaction and structure tests**

Mock `WorkCategorySelector` only at its network boundary, not the form itself. Cover:

- body has top-aligned grid content;
- two semantic groups named Clock In and Clock Out each contain date and time controls;
- current location/category are selected on open;
- changing only metadata submits;
- request and direct-edit payloads include explicit location and nullable category;
- close/reopen resets selectors to period values;
- category loading/error behavior remains delegated to the existing selector;
- existing retry UUID tests continue passing.

- [ ] **Step 2: Run dialog tests and verify RED**

```bash
pnpm --filter webapp exec vitest run src/components/time-tracking/time-correction-dialog.test.tsx
```

Expected: selectors and compact groups do not exist.

- [ ] **Step 3: Add existing selectors to form state**

Import and reuse:

```ts
import { WorkLocationSelector } from "@/components/time-tracking/clock-in-out-widget-parts";
import { WorkCategorySelector } from "@/components/time-tracking/work-category-selector";
```

Pass `employeeId` to `WorkCategorySelector`. Adapt its `undefined` no-category API to explicit form null:

```tsx
<WorkCategorySelector
	employeeId={employeeId}
	value={field.state.value ?? undefined}
	onValueChange={(value) => field.handleChange(value ?? null)}
/>
```

- [ ] **Step 4: Implement the compact time-row component**

Keep it local to `time-correction-dialog.tsx` because it is specific to this form. Use a `fieldset` and `legend` for accessible grouping. Use a responsive two-column control grid and a stable label column when space permits:

```tsx
<fieldset className="grid gap-2 @[24rem]/correction:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] @[24rem]/correction:items-end">
	<legend className="text-sm font-medium @[24rem]/correction:pb-2">
		{label}
	</legend>
	<div className="grid grid-cols-2 gap-2 @[24rem]/correction:contents">
		{/* date field */}
		{/* time field */}
	</div>
</fieldset>
```

Add `@container/correction` to the form/body wrapper so responsiveness follows panel width instead of viewport width. Keep each actual input associated with an explicit `TFormLabel`; use `sr-only` labels where the shared row heading makes a repeated visual label unnecessary.

- [ ] **Step 5: Stop grid-row stretching and order fields**

Use:

```tsx
<ActionPanelBody className="@container/correction grid content-start gap-4">
```

Render in this exact order:

1. timezone note;
2. clock-in row;
3. clock-out row when complete;
4. labeled work location selector;
5. work category selector;
6. two-row reason textarea.

Do not modify shared `ActionPanelBody`; the stretching bug is caused by combining its `flex-1` behavior with this panel's grid and belongs in the caller.

- [ ] **Step 6: Submit full metadata and preserve behavior**

Add to both server calls:

```ts
workLocationType: value.workLocationType,
workCategoryId: value.workCategoryId,
```

Run `hasTimeCorrectionChanges()` before routing. Keep existing range validation, direct-vs-approval policy routing, generic errors, toasts, `submissionIdRef`, refresh behavior, fixed footer, and translated copy.

- [ ] **Step 7: Run dialog tests and verify GREEN**

Run the command from Step 2. Expected: all dialog tests pass.

- [ ] **Step 8: Verify the running panel**

Use the `next-dev-loop` skill with a running `pnpm dev`. Check the correction panel in both themes at approximately 447px and a desktop viewport. Confirm:

- no distributed vertical gaps;
- row labels and controls align;
- no horizontal overflow;
- selectors are keyboard accessible;
- footer remains visible;
- long German labels do not overlap controls.

### Task 8: Final Regression And Production Verification

**Files:**
- Verify all files modified in Tasks 1-7.

- [ ] **Step 1: Run the focused correction suite**

```bash
pnpm --filter webapp exec vitest run \
  src/components/time-tracking/time-correction-dialog.test.tsx \
  src/components/time-tracking/time-correction-dialog-utils.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts' \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts \
  src/lib/approvals/server/time-correction-cancellation.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts \
  src/lib/approvals/server/queries.test.ts \
  src/components/approvals/time-correction-approvals-table.test.tsx
```

Expected: all listed tests pass with zero failures.

- [ ] **Step 2: Run type checking**

```bash
pnpm --filter webapp typecheck
```

Expected: Next route generation and all TypeScript projects complete successfully.

- [ ] **Step 3: Run React diagnostics**

Invoke the `react-doctor` skill and run its required checks for the modified React files. Resolve only findings caused by this change; do not alter unrelated concurrent work.

- [ ] **Step 4: Run the full webapp test suite**

```bash
pnpm --filter webapp test
```

Expected: the full Vitest suite passes. Record pre-existing unrelated failures separately if encountered.

- [ ] **Step 5: Run the production build**

```bash
CI=true pnpm build
```

Expected: production build exits successfully.

- [ ] **Step 6: Inspect the final diff**

```bash
git diff --check
```

Confirm there is no generated auth-schema edit, no unscoped tenant query, no native `Date` business-logic addition, no unrelated file cleanup, and no database migration.

# Time Entry Deletion And Date Corrections Design

## Context

Z8 already supports time correction requests through `time_entry` approval workflows. Correction entries are appended to the time-entry chain, original entries are superseded, and approved corrections update the linked `work_period`. This preserves auditability because existing `time_entry` rows are not mutated.

The current correction UI and server actions only submit `HH:mm` values. The server anchors clock-in to the original work-period start date and clock-out to the original work-period end date in the employee timezone. That prevents fixing a forgotten clock-out when the erroneous entry spans into the next local day but should end on the same date as the start.

Deletion currently exists as an immediate "convert to break" action in calendar flows. The new requirement is that deletion needs manager approval, should prefer a zero-duration auditable record, and should be hidden from normal views after approval while remaining available in audit/history.

## Goals

- Let employees request deletion of completed time entries, with manager approval required.
- Preserve the time-entry hash chain and correction audit trail.
- Represent approved deletion as a zero-duration work period.
- Hide approved deleted work periods from normal time views, summaries, payroll/reporting surfaces, and calendars.
- Keep deleted work periods visible to audit/history/export paths that intentionally include audit data.
- Let correction editors select both date and time for clock-in and clock-out.
- Allow correcting an accidental cross-day period so clock-out can be on the same local date as clock-in.

## Non-Goals

- No hard deletion of `time_entry` rows.
- No immediate self-service deletion without manager approval.
- No broad redesign of approval policies or the approval inbox.
- No new approval entity type; deletion requests use `time_entry` approvals.

## Data Model

Use the existing `work_period` and `time_entry` correction model, with explicit deletion state added to `work_period` so normal queries can hide approved deletions without losing audit history.

Proposed `work_period` fields:

- `deletedAt`: nullable timestamp.
- `deletedBy`: nullable user id.
- `deletionReason`: nullable text.
- `deletionApprovalRequestId`: nullable approval id referencing the approval request that approved the deletion.

Deletion approval metadata should distinguish normal edits from deletion requests:

```ts
timeCorrection: {
  action: "edit" | "delete";
  clockInCorrectionId: string;
  clockOutCorrectionId?: string;
}
```

Approved deletion is represented by two correction entries with the same timestamp. On approval, the work period points at those correction entries, `startTime` and `endTime` are equal, `durationMinutes` is `0`, and deletion metadata is populated.

This does not break the trust chain because the implementation appends new correction entries and updates supersession/work-period pointers, which is the existing approved-correction pattern. It must not mutate the timestamp or hash fields of existing `time_entry` rows.

## Deletion Flow

The delete action becomes a manager-approved request.

1. Employee opens the delete dialog for a completed work period.
2. Dialog requires a reason.
3. Server validates authentication, organization scope, ownership, completed period, billing mutation access, and absence of an existing pending time correction approval for the same period.
4. Server resolves the employee's eligible manager.
5. Server creates pending zero-duration correction entries in a transaction.
6. Server creates a `time_entry` approval with `timeCorrection.action = "delete"` metadata.
7. The work period remains unchanged while approval is pending.
8. On approval, the approval handler applies the zero-duration correction and sets deletion metadata.
9. On rejection, the original work period remains unchanged and pending correction entries stay inactive/superseded.

The zero-duration timestamp uses the original clock-in instant. This keeps the deleted record anchored to the date where the employee originally started work and keeps dirty-balance recalculation straightforward.

## Date And Time Correction Flow

Correction forms submit local date and time for each endpoint:

- `newClockInDate`
- `newClockInTime`
- `newClockOutDate`
- `newClockOutTime`

Defaults are derived in the employee timezone:

- Clock-in defaults to the local date and time of `work_period.startTime`.
- Clock-out defaults to the local date and time of `work_period.endTime`.

Server parsing uses Luxon in the employee timezone and stores UTC instants with timezone capture fields derived from the effective timestamp. Validation remains based on canonical instants:

- Clock-in cannot be in the future.
- Clock-out cannot be in the future.
- Clock-out must be after clock-in for edit corrections.
- Holiday and range validation use the corrected UTC range.

This specifically fixes the forgotten clock-out case where the original record spans day 1 to day 2 but the corrected clock-out should be on day 1.

## UI

### Time Correction Dialog

Add date inputs next to the existing time inputs. A compact layout is sufficient:

- Clock in: date + time.
- Clock out: date + time.

Keep the employee-timezone note visible. Reason remains optional for same-policy direct edits and required when manager approval is needed.

### Delete Dialog

Rename copy away from "Convert to Break".

- Button label: `Delete entry`.
- Dialog title: `Request deletion?`.
- Description: `This will hide the time entry after manager approval. The audit history and time-entry chain will be preserved.`
- Require a reason.
- Submit through the deletion request action.
- Success toast: `Deletion request submitted for manager approval`.

## Query And Reporting Behavior

Normal product surfaces must exclude approved deleted work periods by filtering `deletedAt IS NULL`:

- Calendar views.
- Workday timeline.
- Time entries table.
- Time summaries and balances.
- Payroll and regular reporting data.
- Project hour summaries and surcharge calculations where deleted periods should not count.

Audit/history/export paths may include deleted rows when they intentionally include audit data. Existing audit exports that include raw `time_entry` rows should continue to show original and correction entries with their supersession links.

Canonical `timeRecord` synchronization sets `startAt` and `endAt` to the deletion correction timestamp and sets `durationMinutes` to `0`. No new `timeRecord` deletion schema is part of this design.

## Approval Handling

Reuse the existing `time_entry` approval type and time-correction approval processor.

For `action = "edit"`, behavior stays the same except correction entries may be built from explicit date+time fields.

For `action = "delete"`, approval handling should:

- Load the linked zero-duration correction entries from approval metadata.
- Activate both correction entries.
- Supersede original clock-in and clock-out entries.
- Update the work period to zero duration.
- Set deletion metadata.
- Mark the employee work balance dirty from the original start date.
- Sync the canonical time record to zero duration when present.
- Notify the requester through the existing approved/rejected notification path.

## Testing

Add focused tests for:

- Building correction instants from date + time in the employee timezone.
- Correcting a period that originally spans two local dates so it ends on the start date.
- Preserving intentional cross-midnight corrections when the user chooses different dates.
- Deletion request creation requiring a reason and creating pending zero-duration corrections.
- Approval metadata containing `timeCorrection.action = "delete"`.
- Deletion approval applying zero duration, deletion metadata, supersession links, and work-balance dirty marking.
- Normal queries hiding approved deleted work periods.
- Audit/export-style queries retaining access to deleted records and correction chains.
- UI defaults for date fields and delete dialog reason validation.

## Implementation Notes

- Keep all queries organization-scoped.
- Use Luxon for date/time parsing and timezone conversion.
- Do not derive business meaning from the viewer timezone.
- Do not edit `src/db/auth-schema.ts`.
- Use `@tanstack/react-form` for modified forms.
- Use `@tabler/icons-react` for icons.

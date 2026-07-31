# Permanent Payroll Blocker Dismissals

## Goal

Allow a payroll officer to permanently clear an individual false-positive
payroll blocker with one button without mutating the underlying time or approval
record.

## Semantics

A dismissal is permanent for the blocker source record and blocker type. Once
dismissed, the same `(organizationId, blockerType, sourceId)` finding never
appears in payroll again, even if the source record changes.

There is no undo workflow in this change. The dismissal row is retained as
immutable audit evidence.

## Persistence

Add an organization-scoped `payroll_blocker_dismissal` table containing:

- `id`
- `organizationId`
- `blockerType`
- `sourceId`
- `employeeId`
- `dismissedByEmployeeId`
- `dismissedAt`

The table has a unique key on `(organizationId, blockerType, sourceId)` so a
repeated request is idempotent. Organization, affected employee, and actor
columns are indexed for operational review.

`sourceId` is intentionally polymorphic: it identifies a canonical time record
for missing clock-out and pending absence blockers, or an approval request for a
pending time-correction blocker. It therefore has no single foreign key.

Rows are inserted but never updated or deleted by the payroll workflow.

## Authorization

The dismissal action accepts only `blockerType` and `sourceId`; it does not trust
a client-provided organization or employee ID.

For every request the server will:

1. Require an authenticated employee in the active organization.
2. Resolve that employee's current payroll access scope.
3. Query the source using the active `organizationId`.
4. Reconstruct and verify that the exact blocker currently exists.
5. Verify the affected employee is inside the payroll officer's allowed scope.
6. Insert the dismissal using the server-resolved organization, employee, actor,
   and timestamp.

An unknown, cross-organization, stale, or out-of-scope blocker fails closed and
does not create a dismissal.

## Blocker Filtering

After producing organization- and employee-scoped blocker candidates, payroll
loads dismissals for the active organization and candidate source IDs. It removes
only candidates with an exact type and source-ID match.

Dismissed blockers no longer contribute to:

- The blocker list.
- Total blocker count.
- Employee `hasBlockers` status.
- Payroll PDF blocker presentation.

No worked-time, absence, approval, or payroll value is changed.

## User Interface

Each actionable blocker row gains a small `Clear false positive` button. The
existing calendar or approval link remains available.

On click:

1. Disable only that row's clear button and show pending state.
2. Call the dismissal server action with blocker type and source ID.
3. On success, reload the current payroll summary from the server.
4. Let the server response recalculate blocker rows, counts, and employee status.
5. On failure, keep the row visible and show an error toast.

The button is a direct one-click action with no confirmation dialog, as
requested. Its label explicitly states that the finding is being cleared as a
false positive.

## Error Handling

- Duplicate dismissal requests succeed idempotently.
- A blocker that disappeared before dismissal returns a conflict/not-found
  result and is not acknowledged.
- Database failures leave the blocker visible.
- Refresh failures after a successful dismissal show an error and preserve the
  current client state; the blocker disappears on the next successful reload.
- Underlying source records are never changed as a fallback.

## Auditability

The immutable dismissal row records who dismissed which typed source finding,
for which organization and employee, and when. No reason field is required for
the one-click false-positive workflow.

## Testing

- Schema and migration create the organization-scoped table, indexes, and unique
  key.
- Every blocker type resolves its source and affected employee correctly.
- Cross-organization and out-of-scope IDs are rejected.
- Client-supplied organization or employee identity cannot influence writes.
- Duplicate clicks create one row and return success.
- Exact `(type, sourceId)` dismissals are filtered while same-ID/different-type
  candidates remain.
- Dismissed findings no longer affect counts or employee blocked status.
- UI disables only the selected row during dismissal.
- Successful dismissal refreshes the current filtered payroll period.
- Failure keeps the blocker visible and shows an error.
- Existing resolution links and authorization behavior remain unchanged.

## Non-Goals

- Editing, closing, approving, or rejecting source records.
- Temporary or payroll-period-specific dismissals.
- Restoring dismissed blockers.
- Bulk clear-all behavior.
- Granting payroll officers calendar or approval permissions.

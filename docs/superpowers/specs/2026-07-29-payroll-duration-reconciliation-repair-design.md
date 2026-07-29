# Payroll Duration Reconciliation Repair

## Goal

Make the automatic canonical backfill repair existing duration and approval
parity mismatches so payroll readiness can converge after detecting stale
canonical `time_record` rows.

## Problem

Production reconciliation reports seven `durationMismatchRecords` and zero for
every other readiness metric. The readiness check runs the canonical backfill,
then receives the same mismatch result and keeps payroll fail-closed.

The backfill currently inserts canonical rows with `ON CONFLICT DO NOTHING`.
That behavior can create missing rows, but it cannot repair an existing row
whose `duration_minutes` or `approval_state` differs from the legacy source.
The retry therefore cannot change the condition that triggered it.

## Repair Authority

During this cutover repair, organization-scoped legacy `work_period` and
`absence_entry` parity values remain authoritative for:

- `time_record.duration_minutes`
- `time_record.approval_state`

The repair will not overwrite canonical timestamps, employee linkage, record
kind, origin, audit creation fields, or other canonical data.

## Design

Replace the generic insert-only call for `time_record` with a dedicated
`upsertCanonicalTimeRecords` helper. The helper will:

1. Return without querying when the payload is empty.
2. Insert missing canonical records with the existing payload.
3. Use the unique `(id, organization_id)` key as the conflict target.
4. On conflict, update only `duration_minutes` and `approval_state` from the
   corresponding excluded payload row.

The composite conflict target makes tenant scope explicit. Payload construction
already filters every legacy source by `organizationId`, and the existing
transaction continues to contain canonical writes and legacy linkage updates.

The existing generic `insertIfPresent` helper remains unchanged for
`time_record_work` and `time_record_absence`, where readiness checks only require
the detail row to exist. Project allocations and approval decisions continue to
use their existing transactional replacement behavior.

## Data Flow

1. Payroll reconciliation detects duration or approval drift.
2. Readiness loads legacy rows for the active organization.
3. Backfill builds organization-scoped canonical payload rows.
4. The canonical time-record upsert inserts missing rows and updates parity
   fields on matching `(id, organizationId)` rows.
5. Detail rows, allocations, decisions, and legacy links follow their existing
   repair paths in the same transaction.
6. Readiness reconciles again and allows payroll only when every metric is zero.

## Error Handling

- Payroll remains fail-closed if reconciliation is still nonzero.
- Database failures roll back the existing transaction.
- Cross-organization rows cannot be selected as the upsert conflict target.
- No one-time production SQL or readiness bypass is introduced.
- Existing aggregate diagnostics remain available if another mismatch persists.

## Testing

- A non-empty `time_record` payload uses `onConflictDoUpdate` with the composite
  `(id, organizationId)` target.
- The conflict update set contains exactly `durationMinutes` and
  `approvalState`, sourced from the excluded row.
- Missing rows still use the same insert payload.
- An empty time-record payload performs no insert.
- Work and absence detail inserts retain `onConflictDoNothing`.
- All repair writes remain inside one transaction.
- Existing backfill payload, reconciliation, cutover readiness, and payroll
  diagnostics tests continue to pass.

## Non-Goals

- Updating canonical timestamps or audit metadata during parity repair.
- Replacing the full legacy-to-canonical migration architecture.
- Disabling payroll readiness checks.
- Logging record-level payroll data.

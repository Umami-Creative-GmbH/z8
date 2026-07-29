# Payroll Cutover Diagnostics

## Goal

Identify the exact canonical time-record reconciliation metrics that keep the
production payroll workspace unavailable after its automatic repair attempt.

## Problem

Payroll fails closed when legacy work and absence data does not reconcile with
canonical `time_record` data. The readiness check attempts an organization-
scoped backfill and then checks reconciliation again. When mismatches remain,
`CanonicalCutoverNotReadyError` currently retains only the organization ID.
The payroll action maps that error to a generic `ConflictError`, so production
logs lose the aggregate reconciliation metrics needed to identify the
persistent mismatch.

The user-facing error must remain generic because reconciliation details are
operational diagnostics, not client data.

## Design

`CanonicalCutoverNotReadyError` will retain the final
`LegacyCanonicalReconciliation` value in a readonly property. The readiness
check will pass the post-repair reconciliation result into the error when it
still contains a mismatch.

The payroll action error mapper will copy the organization ID and aggregate
counts into the existing `details` property of the mapped `ConflictError`. The
existing server-action error logging logs the complete tagged error, while
`toServerActionResult` returns only its message and tag. Production logs will
therefore expose the diagnostics without changing the browser response.

No employee IDs, time-record IDs, dates, names, or payroll values will be added
to the error. Diagnostics are limited to the organization ID already present
in the error and these aggregate counts:

- Work and absence coverage mismatches.
- Duration and approval-state mismatch counts.
- Missing canonical work and absence records.
- Missing work and absence detail rows.
- Missing project allocation rows.
- Missing absence links and organization IDs.

## Data Flow

1. Payroll requests organization-scoped canonical data.
2. Reconciliation returns aggregate mismatch counts.
3. The readiness check runs the existing automatic backfill when needed.
4. Reconciliation runs again.
5. If mismatches remain, the typed cutover error receives the final counts.
6. The payroll mapper creates the existing user-facing conflict and copies the
   aggregate diagnostics into its server-only `details` property.
7. Server logs show the aggregate mismatch counts; the browser continues to
   receive only `Payroll data is temporarily unavailable`.

## Error Handling

- Clean reconciliation behavior is unchanged.
- Successful automatic repair behavior is unchanged.
- Persistent mismatches remain fail-closed.
- Unexpected database and backfill errors retain their existing handling.
- No reconciliation details cross the server-action response boundary.

## Testing

- A persistent mismatch throws `CanonicalCutoverNotReadyError` with the final,
  post-repair reconciliation counts.
- The error does not retain the initial pre-repair counts when repair changes
  the result.
- The payroll action mapper includes the organization ID and final counts in
  the conflict's `details` property.
- `toServerActionResult` continues to omit conflict details from the browser
  response.
- The mapped conflict keeps the existing message and
  `canonical_payroll_data_not_ready` conflict type.
- Clean and successfully repaired readiness checks remain unchanged.

## Non-Goals

- Bypassing the payroll readiness gate.
- Repairing canonical data before the failing metric is known.
- Logging record-level or employee-level payroll data.
- Changing payroll authorization or organization scope.

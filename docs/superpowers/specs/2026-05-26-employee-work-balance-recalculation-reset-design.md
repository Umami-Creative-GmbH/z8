# Employee Work Balance Recalculation Reset Design

## Context

The employee settings page has an admin-only action to recalculate an employee's work balance. Today the action requests a full rebuild by marking existing `employee_work_balance` and `employee_work_balance_period` rows dirty. That leaves stale calculated balances visible until the background refresh job processes the employee.

## Goal

When an organization admin requests recalculation for one employee, calculated period work-balance rows for that employee should be removed and the employee should return to the same user-visible state as an employee whose balance has not yet been calculated.

## Scope

- Replace the employee's organization-scoped row in `employee_work_balance` with an internal full-rebuild marker that public reads treat as no calculated balance.
- Delete the employee's organization-scoped rows from `employee_work_balance_period`, including monthly and yearly aggregates.
- Preserve the existing admin authorization, active-organization employee lookup, action tracing, and cache invalidation behavior.
- Let the work-balance batch job rebuild the employee from scratch when it sees a missing aggregate row or the internal full-rebuild marker.

## Non-Goals

- Do not change the UI confirmation flow or copy.
- Do not synchronously rebuild balances during the request.
- Do not delete source time-tracking data such as work periods or work requirements.

## Data Flow

1. The employee settings UI calls the existing recalculation server action.
2. The server action validates the employee id, confirms org-admin access, and verifies the target employee belongs to the active organization.
3. The recalculation service serializes reset/refresh work for the employee and organization with an advisory transaction lock.
4. The service deletes calculated period rows and writes a hidden aggregate marker that preserves the full-rebuild signal.
5. Subsequent public balance reads return no calculated balance until the background job rebuilds it.
6. The batch job performs a full rebuild for missing aggregate rows and reset-marker rows.

## Error Handling

Reset failures should propagate through the existing server action error handling and logging. Period deletion and aggregate marker writes are idempotent and scoped by `employeeId` plus `organizationId`, so retrying the action is safe.

## Testing

- Update work-balance service tests so `requestEmployeeWorkBalanceFullRebuild` verifies scoped period deletion, hidden marker creation, public null reads for the marker, and refresh promotion to full rebuild.
- Keep server action tests focused on authorization and active-organization scoping, but update expectations only if the recalculation service name or behavior changes.
- Existing batch-selection tests should continue to prove employees without an all-time balance row are included for refresh, and job tests should prove missing aggregate rows force full rebuilds.

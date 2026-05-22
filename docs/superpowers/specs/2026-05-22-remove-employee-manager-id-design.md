# Remove Employee Manager ID Design

## Problem

The `employee.manager_id` column duplicates manager assignment state that is already modeled by `employee_managers`. The schema marks the field as deprecated, but several runtime paths still read it for approval routing and permissions. Carrying both sources makes approval behavior depend on synchronization quality and can cause requests to auto-approve or fail when the denormalized field is stale.

## Goals

- Make `employee_managers` the only direct-manager source of truth.
- Preserve existing primary-manager semantics through `employee_managers.is_primary`.
- Preserve team primary manager fallback where current approval policy resolution supports it.
- Backfill existing `employee.manager_id` values into `employee_managers` before dropping the column.
- Remove all runtime reads, writes, schema relations, and indexes for `employee.manager_id`.

## Non-Goals

- Do not redesign approval policies or introduce new approval concepts.
- Do not remove legacy `employee.team_id` compatibility state in this change.
- Do not change which absence categories require approval.

## Data Model

`employee_managers` becomes the canonical direct-manager table:

- `employee_id` identifies the managed employee.
- `manager_id` identifies the manager employee.
- `is_primary` identifies the primary direct manager.
- Employees may have multiple direct managers, but approval flows that need a single default approver should prefer the primary manager.

The `employee.manager_id` column and `employee_managerId_idx` index are removed from schema and database migrations.

## Migration

Before dropping the column, add a migration that copies non-null `employee.manager_id` values into `employee_managers` when that assignment does not already exist. If the employee has no existing primary manager assignment, the backfilled row should be primary. If a primary assignment already exists, the backfilled row should be non-primary to avoid changing current canonical state.

After the backfill, drop `employee.manager_id` and its index.

## Runtime Changes

Approval and permission paths should use shared manager resolution helpers instead of reading `employee.managerId` directly.

Paths to update include:

- Absence request routing and absence permission helpers.
- Time correction and manual time-entry approval routing.
- Travel expense claim submission approval routing.
- Compliance and analytics metadata that currently reads manager data from employee rows.
- Tests and mocks that assume employee rows include `managerId`.

Manager assignment writes should stop syncing denormalized employee state. `ManagerService.assignManager` and `removeManager` should only mutate `employee_managers`.

## Error Handling

If an approval-required flow cannot resolve a direct manager or supported fallback manager, it should return an explicit validation error rather than silently auto-approving. Approval-not-required flows should remain auto-approved.

## Testing

- Add regression tests for manager resolution from `employee_managers` when `employee.manager_id` is absent.
- Update approval tests for absences, time corrections/manual time entries, and travel expenses.
- Add migration/schema tests verifying the legacy column and index are removed.
- Run targeted approval and manager-resolution tests before completion.

## Rollout Notes

This is a breaking schema cleanup and should ship with its migration. Existing production data must be backfilled by the migration before the column is dropped.

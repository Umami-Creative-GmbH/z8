# Self-Cancel Approved Absences Design

## Goal

Allow employees to cancel their own approved absences when the absence has not started yet. If the cancelled absence was already approved, notify the employee's manager that the absence was cancelled.

## Scope

In scope:

- Employees can continue cancelling their own pending absence requests.
- Employees can cancel their own approved absences only before the absence start date.
- Cancellation remains organization-scoped and server-validated.
- Approved absence cancellation removes the absence entry and canonical absence record, then queues calendar deletion sync.
- Managers are notified when an approved absence is cancelled by the employee.
- Existing web, my-requests, and mobile cancellation entrypoints use the same cancellation rule.

Out of scope:

- Cancelling rejected absences.
- Cancelling approved absences that have already started or are in the past.
- Requiring manager approval for cancellation.
- Adding a new database status such as `cancelled`.
- Tenant-level configuration for cancellation rules.

## Confirmed Decisions

- Employees may cancel approved absences only if the absence has not started yet.
- Pending self-cancellation remains allowed.
- If an approved absence is cancelled, notify the manager that an absence was cancelled.
- Use the existing cancellation action rather than creating a separate action for approved absences.

## Approaches Considered

### A) Extend the existing cancel flow (Selected)

Update the existing cancellation permission and UI eligibility rules so the same cancel action handles pending and future approved absences.

Pros:

- Smallest behavioral change.
- Reuses existing canonical record cleanup and calendar sync behavior.
- Keeps web, my-requests, and mobile cancellation behavior consistent.

Cons:

- The permission helper must become date-aware, so tests need to cover status and date combinations.

### B) Add a separate approved-absence cancellation action

Create a dedicated server action for approved absences and keep pending request cancellation separate.

Pros:

- Makes the approved cancellation path explicit.
- Could support different audit or notification behavior later.

Cons:

- Duplicates ownership, organization, canonical cleanup, and calendar sync logic.
- Increases the risk of inconsistent cancellation behavior between entrypoints.

### C) Convert approved cancellation into a manager approval request

Let employees request cancellation and require manager approval before deleting the approved absence.

Pros:

- Stronger managerial control for compliance-heavy teams.
- Preserves a review step before changing approved absence records.

Cons:

- Does not match the requested self-service behavior.
- Adds workflow complexity and new approval states that are unnecessary for this change.

## Architecture

The existing absence cancellation path remains the single mutation entrypoint. The server action loads the active employee context, fetches the absence, verifies the absence belongs to the active organization, and applies cancellation eligibility before deleting records.

Cancellation eligibility should be centralized so UI code and tests can use the same rule shape where practical:

- Own pending absence: cancellable.
- Own approved absence: cancellable only when `startDate` is after the current date in the organization's timezone.
- Rejected absence: not cancellable.
- Another employee's absence: not cancellable for normal employees.
- Admin cancellation of pending requests keeps the existing behavior unless existing tests or callers show that it should be narrowed.

The mutation should capture whether the absence was approved before deletion. After successful deletion and calendar sync queueing, approved self-cancellations trigger manager notification.

## UI

The personal absence table should show the cancel action for pending absences and approved future absences. Approved absences that started today or earlier should not show the action.

The confirmation copy can stay close to the current wording, but should work for both cases. For example, `Cancel absence` and `Are you sure you want to cancel this absence? This action cannot be undone.`

The existing toast can remain generic: `Absence cancelled` or `Absence request cancelled` if the current translation scope is kept minimal. Server-side validation remains authoritative, so stale UI state should return a clear error if the absence is no longer cancellable.

## Data Flow

When an employee cancels an absence:

1. The client calls the existing cancel server action with the absence id.
2. The server resolves the current employee and active organization.
3. The server fetches the absence and checks `organizationId`.
4. The server verifies the actor owns the absence for self-cancellation.
5. If the absence is pending, cancellation proceeds.
6. If the absence is approved, the server checks that `startDate` is after today's date in the organization timezone.
7. The server queues calendar deletion sync.
8. The server removes the canonical absence record.
9. The server deletes the absence entry and related approval request.
10. If the cancelled absence was approved, the server notifies the employee's manager.
11. The client refreshes the relevant view.

## Manager Notification

For approved self-cancellations, notify the employee's direct manager or managers in the same organization. The notification should include the employee name, absence type, date range, and that the employee cancelled the absence.

If the employee has no manager, the cancellation should still succeed. The notification helper should log the missing-recipient case or no-op consistently with existing notification patterns instead of blocking cancellation.

## Error Handling

Expected errors:

- Employee profile not found.
- Absence not found.
- Absence not found in the active organization.
- User does not have permission to cancel the absence.
- Approved absence has already started and cannot be cancelled by the employee.
- Absence organization not found.

Notification failures should not roll back the cancellation. They should be logged because the absence state has already changed and calendar cleanup should not depend on manager notification delivery.

## Testing

Add or update tests for:

- Pending own absences remain cancellable.
- Approved own future absences are cancellable.
- Approved own absences starting today or in the past are not cancellable.
- Rejected absences are not cancellable.
- Cross-organization cancellation remains blocked before permission checks.
- Approved self-cancellation triggers manager notification.
- Pending cancellation does not trigger the approved-cancellation manager notification.
- UI shows the cancel action for pending and approved future absences only.

## Open Implementation Notes

- Use Luxon for date comparisons and the organization's timezone, following the existing date/time convention.
- Keep every query and mutation filtered by `organizationId`.
- Prefer adapting the existing notification trigger structure if one exists for manager/requester absence notifications.

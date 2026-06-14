# Employee Suspension And Reactivation Design

## Goal

Allow organization admins to suspend employees who leave the company, reactivate them later, and keep their historical time data visible to authorized admins and managers at `/calendar/:employeeId`.

Suspension must remove current app access and operational participation without deleting employee records, user records, time entries, work periods, absences, or related audit data.

## Current Context

- `employee.isActive` already exists and is used by the employee directory status filter.
- Current employee lookups generally require `employee.isActive = true`, which is correct for suspended users because they should not access the app as active employees.
- The calendar API currently requires the target employee to be active when resolving `/calendar/:employeeId`, which blocks historical review for inactive employees.
- Time entries and work periods are organization-scoped and queried by employee ID. Historical event timestamps must keep using the existing UTC/timezone rules.

## Recommended Approach

Use `employee.isActive` as the suspension flag. Add explicit org-admin suspend/reactivate actions instead of asking admins to infer the behavior from the generic edit form.

Suspending an employee will:

- Set `employee.isActive = false`.
- Disable the employee user's app access fields: `canUseWebapp`, `canUseDesktop`, and `canUseMobile`.
- Leave historical employee-linked data intact.
- Revalidate employee caches so directory and selector state updates quickly.

Reactivating an employee will:

- Set `employee.isActive = true`.
- Restore `canUseWebapp` to `true` so the employee can use the web app again.
- Leave `canUseDesktop` and `canUseMobile` unchanged; admins can explicitly grant those app-specific permissions when needed.
- Leave existing employee details, managers, teams, and historical records unchanged.

## Authorization

Only organization admins can suspend or reactivate employees. Managers can continue editing the fields already allowed by scoped employee settings, but they cannot change lifecycle state.

The actor must be verified against the active organization. The target employee must belong to the same organization. The implementation must not trust an employee ID without checking `organizationId`.

Suspended employees cannot access the app because current employee/session paths continue to require an active employee record, and app access flags are disabled.

## Calendar Behavior

`/calendar/:employeeId` must remain available for inactive target employees when the viewer is authorized to read that employee in the same organization.

The calendar API should keep requiring the viewing employee to be active, but it should no longer require the target employee to be active. This preserves access control while allowing historical review.

Calendar data queries stay organization-scoped. Single-employee calendar boundaries continue to use the selected employee's timezone. Historical time entries and work periods remain unchanged.

The calendar employee selector can continue showing active employees by default. Direct routes to suspended employees must work even if the suspended employee is not listed in the selector.

## UI

Add lifecycle controls to the employee detail page for org admins:

- Active employees show a `Suspend employee` action with clear explanatory copy.
- Inactive employees show a `Reactivate employee` action.
- The employee overview continues to show the existing Active/Inactive badge.
- Successful actions show a toast and refresh detail/list data.

The employee directory already supports Active, Inactive, Draft, and All filters. No new directory filter is required.

## Data Flow

Suspend/reactivate actions live with existing employee mutations.

The server action will:

1. Validate the employee ID.
2. Load the settings actor context for the active organization.
3. Require org-admin employee settings access.
4. Load the target employee and ensure it belongs to the actor's organization.
5. Update `employee.isActive` and `employee.updatedAt`.
6. Update the linked auth user app access fields.
7. Revalidate employee caches.

The client detail hook will expose suspend/reactivate mutations and invalidate the employee detail, employee list, and calendar employee query keys on success.

## Error Handling

- Invalid employee IDs return validation errors.
- Missing target employees return not found errors.
- Non-admin actors receive authorization errors.
- Calendar requests for employees outside the active organization still return forbidden.
- Calendar requests from inactive viewers still fail because the viewer must have an active employee context.

## Testing

Add or update tests for:

- Suspending sets `employee.isActive = false` and disables all app access flags.
- Reactivating sets `employee.isActive = true` and restores web app access only.
- Managers cannot suspend or reactivate employees.
- Calendar authorization allows inactive target employees in the same organization when the viewer is authorized.
- Calendar authorization still rejects inactive viewers and employees outside the active organization.

## Out Of Scope

- Adding a new employment status enum.
- Soft-deleting employees.
- Removing Better Auth organization membership.
- Automatically setting or clearing `endDate`.
- Changing historical time entry, work period, absence, or payroll data.

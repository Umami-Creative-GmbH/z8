# Employee Start Date Work Balance Design

## Context

HR can create employee accounts before the employee actually starts work. The existing `employee.startDate` column already stores the employee start date, and `updateEmployeeAction` already marks the employee work balance dirty when that date changes. The employee detail UI does not currently expose this field, and the work-balance calculation currently starts from the first completed work period instead of the employee start date.

## Goal

Allow authorized staff to set an employee start date in the employee detail UI and make the work-balance runner use that date as the beginning of time tracking for balance calculations.

## Approach

Reuse the existing `employee.startDate` field. Do not add a new database column.

The employee start date becomes the lower boundary for all-time work-balance calculations:

- Required minutes are counted from the employee start date when it is set.
- Actual worked minutes before the employee start date are excluded from the displayed all-time balance.
- If no employee start date is set, existing behavior continues to use the first completed work period as the relevant start date.

## UI

Add a `Start date` date input to `/settings/employees/:employeeId` in the existing edit card.

Placement:

- Put the field near other job information, close to `Position` and `Employee Number`.
- Keep the current restrained settings layout and responsive two-column form behavior.

Permissions:

- Use the existing employee detail edit permissions.
- Managers and org admins can edit the field through the current `canEditManagerFields` path.
- The field is disabled while the form is updating.

Form behavior:

- Empty value is allowed and saves as `null`.
- Date input values are normalized into a date-only value for the server action.
- The form is initialized from `employee.startDate` and includes `startDate` in submitted updates.

## Server And Data Flow

Continue using `updateEmployeeSchema.startDate` and the existing `employee.startDate` column.

When `startDate` changes, keep the existing dirty-marking behavior in `updateEmployeeAction`:

- Compare the previous and next start dates as UTC ISO dates.
- Mark work balance dirty from the earlier of the previous and next start date.
- Let the background runner perform recalculation instead of recalculating synchronously.

No migration is needed for the field itself because it already exists.

## Work-Balance Runner

Update the work-balance relevant-date logic so it reads the scoped employee's `startDate`.

For an employee with `startDate`:

- Use `startDate` as the first relevant calculation date.
- Query actual worked minutes from `startDate` onward.
- Query required minutes from `startDate` onward.
- Store `computedFromDate` as `startDate` when there is any computed balance.
- Do not materialize closed monthly balance periods before `startDate`.
- Clip any monthly or hot-window period that overlaps `startDate` so its source-data queries begin on `startDate`.

For an employee without `startDate`:

- Preserve current behavior and start from the first completed work period.

The existing organization scoping must remain on all reads and writes.

## Error Handling

Invalid dates are rejected by the existing validation path.

If the balance runner fails after a start-date change, the existing `lastError`, dirty state, and worker error handling continue to apply.

## Testing

Add or update tests for:

- Employee detail form defaults and syncing include `startDate`.
- Employee update submissions send `startDate` as a date or `null`.
- Work-balance relevant-date selection prefers `employee.startDate` when set.
- Actual and required minutes before `employee.startDate` are excluded.
- Existing behavior remains for employees without `startDate`.

## Out Of Scope

- Adding a separate `timeTrackingStartDate` field.
- Changing account invite or organization onboarding flows.
- Rebuilding balances synchronously from the employee edit action.
- Adding a new migration for the existing `startDate` column.

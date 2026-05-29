# Calendar Employee Route Manual Entry Design

## Goal

Make `/calendar` durable for both personal and staff calendars, and let users create manual time entries directly from the calendar day and week grids.

## Scope

- `/calendar` shows the current employee's own calendar.
- `/calendar/[employeeId]` shows the selected employee by database UUID.
- The employee selector survives reloads by changing the URL instead of only local state.
- Day and week views support selecting a time range by click, drag, and release.
- Releasing a valid range opens the manual time entry sheet immediately with date and times prefilled.
- Managers can create manual entries for staff they are authorized to manage.
- Manager-created staff entries skip approval and are created as approved entries.
- Month and year views are unchanged.

## Routing And Employee Selection

Add a route for `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx` that reuses the same calendar page content as `/calendar/page.tsx`.

The server page passes these values to `CalendarView`:

- `organizationId` from the authenticated employee context.
- `currentEmployeeId` from the authenticated employee context.
- `initialSelectedEmployeeId`, omitted for `/calendar` and set from the route param for `/calendar/[employeeId]`.

`CalendarView` initializes the selected employee and calendar filters from `initialSelectedEmployeeId ?? currentEmployeeId`. The employee selector becomes URL-owned:

- Selecting the current employee navigates to `/calendar`.
- Selecting another employee navigates to `/calendar/{employeeUuid}`.

The calendar events API remains the data authorization boundary. It already resolves the requested employee through organization scope and employee read permission. Unauthorized employee UUIDs should produce the existing calendar load error instead of silently falling back to another employee.

## Manual Entry Sheet Reuse

Reuse `ManualTimeEntryDialog` rather than building a second calendar-only form. Extend it with optional props for:

- `targetEmployeeId`
- `targetEmployeeName`
- `defaultDate`
- `defaultClockInTime`
- `defaultClockOutTime`
- controlled `open` and `onOpenChange`, if needed for programmatic opening from grid selection

The existing trigger button behavior should remain available for the time-tracking page. Calendar usage can hide or omit the trigger and open the action panel programmatically after range selection.

When a target employee name is available, the sheet title or description should identify the employee, for example `Add manual time entry for Jane Doe`. This prevents accidental staff edits.

The form submits the same data shape as today plus optional `employeeId`. Existing project, work-category, reason, date, and time fields remain unchanged.

## Day And Week Range Selection

Day and week views support selecting an empty time-grid range:

1. Pointer down records the selected day and start time.
2. Pointer movement can visually track the tentative selection if Schedule-X exposes enough grid geometry.
3. Pointer release records the end time.
4. The selected range is normalized so the earlier time becomes `clockInTime` and the later time becomes `clockOutTime`.
5. The manual entry sheet opens immediately with the normalized values.

This behavior only applies to `day` and `week` views. Month and year views keep their current navigation and summary interactions.

Event clicks must keep their current behavior. Selection handling should target empty grid cells and avoid hijacking clicks on existing work periods, holidays, absences, time entries, or generated break blocks.

Future selections, invalid ranges, and ranges shorter than the accepted minimum remain blocked by the existing client and server validation. The implementation can additionally avoid opening the sheet for zero-length selections.

## Manager Staff Entry Rules

The manual entry server action accepts an optional `employeeId`.

When `employeeId` is omitted or equals the current employee, current behavior remains: the entry uses the current employee, evaluates the employee's change policy, and may require approval.

When `employeeId` targets another employee, the action must:

- Verify the target employee is active and belongs to the same organization.
- Verify the current employee is authorized for that target using the same employee-manager and ability model used by calendar events.
- Use the target employee's ID, organization ID, team ID, and timezone/date context where those values affect validation.
- Set `createdBy` on generated time entries to the manager user.
- Create the work period with `approvalStatus: "approved"`.
- Skip change-policy approval checks and skip approval request creation.
- Validate holidays, project assignment, overlaps, active target work periods, and future times against the target employee.
- Mark the target employee's work balance dirty.
- Calculate surcharges for the new approved work period.

Unauthorized target employees must return a forbidden-style error. The UI should surface that through the existing toast/error path.

## Data Flow

1. The user opens `/calendar` or `/calendar/[employeeId]`.
2. `CalendarView` initializes filters for the selected employee.
3. `useCalendarData` calls `/api/calendar/events` with `employeeId`.
4. The API authorizes the requested employee and returns events.
5. In day/week view, the user selects a grid timespan.
6. `ScheduleXWrapper` reports the selected date and times to `CalendarView`.
7. `CalendarView` opens `ManualTimeEntryDialog` with the selected employee and prefilled range.
8. The dialog submits `createManualTimeEntry` with optional `employeeId`.
9. The server action creates an own or manager-on-behalf manual entry according to the rules above.
10. On success, the calendar query is invalidated/refetched and the selected employee URL remains unchanged.

## Error Handling

- Unauthorized selected employee route: the calendar events request fails and the existing calendar error area is shown.
- Unauthorized manager target on submit: the action returns an error and the sheet shows a toast.
- Active work period for target employee: the action rejects creation.
- Future selected times: existing validation rejects creation.
- Overlapping periods: existing overlap adjustment behavior applies to the target employee's periods.
- Invalid route UUID format: treat as an unauthorized or not-found employee and show the existing error state.

## Testing

Add or update tests for:

- `/calendar` initializes `CalendarView` for the current employee.
- `/calendar/[employeeId]` initializes filters with the selected UUID.
- Employee selector navigates current employee to `/calendar` and staff to `/calendar/{employeeId}`.
- Day/week range selection normalizes drag direction and opens the manual entry sheet with expected date/start/end values.
- Event clicks still open event details and do not trigger range selection.
- Own manual entry behavior remains unchanged and can still require approval.
- Manager-created staff manual entries use the target employee, are approved immediately, and do not create approval requests.
- Unauthorized target employee submissions are rejected.
- Target employee active work periods block manager-created manual entries.

## Non-Goals

- No query-param employee persistence.
- No custom calendar-only manual entry form.
- No changes to month or year calendar interactions.
- No approval workflow for manager-created staff manual entries.
- No support for human-readable employee slugs; the route segment is the employee database UUID.

## Open Decisions

None. The route segment is the employee UUID, range release opens the sheet immediately, and manager-created staff entries skip approval.

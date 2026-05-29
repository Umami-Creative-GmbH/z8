# Calendar Running Work Period Design

## Goal

When an employee is currently clocked in, the `/calendar` day and week views should show a running work block that starts at the clock-in time and ends at the current time. This makes the active shift visible alongside completed work periods without changing month or year summaries.

## Scope

- Show the running block only in Schedule-X day and week views.
- Do not show the running block in month or year views.
- Do not count the running block in daily actual minutes, work-balance summaries, or month/year work summaries until it is completed by clock-out.
- Keep all data organization-scoped and employee-authorized through the existing calendar events API.

## Architecture

Use the existing calendar data path:

1. `/api/calendar/events` resolves the authorized employee scope.
2. `getWorkPeriodsForMonth` fetches work periods for the selected organization and employee.
3. Calendar events are returned to `useCalendarData`.
4. `ScheduleXCalendarWrapper` converts work period events to Schedule-X timed blocks.

The work period fetch should include active work periods in addition to completed periods. Active periods should be represented as normal `work_period` calendar events with metadata that marks them as running.

## Event Shape

An active work period event should use:

- `type: "work_period"`
- `date: period.startTime`
- `endDate: now`
- `title`: employee name plus elapsed duration and a running indicator, for example `Jane Doe - 2h 15m (running)`
- `description`: `Running work period`
- `metadata.durationMinutes`: elapsed minutes from start time to now
- `metadata.employeeName`: employee display name
- `metadata.startTime`: formatted start time
- `metadata.endTime`: omitted
- `metadata.isRunning`: `true`
- project metadata when the active period has a project

Completed work period events keep their current shape.

## Rendering

The Schedule-X adapter already renders `work_period` events as timed blocks from `date` to `endDate`. The active event can use that same path.

`ScheduleXCalendarWrapper` should filter running events out unless `viewMode` is `day` or `week`. This keeps the API shape simple while enforcing the requested visual scope at the calendar-rendering boundary.

The block can use the existing work-period styling initially. A running-specific style can be added later if needed, but it is not required for this change.

## Data And Summary Behavior

`fetchMonthEvents` currently uses fetched work periods both for visible events and for daily actual-minute calculations. Running events must not be included in `buildDailyActualMinutes` because those summaries should reflect completed, persisted durations only.

The implementation should either:

- fetch completed and active events together but pass only completed events to `buildDailyActualMinutes`, or
- add an option to include active events only for display and keep actual-minute inputs completed-only.

The smaller implementation is preferred if it keeps the function easy to read.

## Permissions And Tenancy

No new authorization path is needed. The running event is returned only after `/api/calendar/events` resolves `scopedEmployeeId` using the existing organization context and CASL employee read check.

The work period query must continue to filter by `workPeriod.organizationId` and the authorized employee ID.

## Testing

Add or update tests for:

- active work periods are returned as `work_period` events with `endDate` near the current time and `metadata.isRunning = true`
- completed work periods still return unchanged
- daily actual minutes exclude active running periods
- Schedule-X day/week includes running events, while month view excludes them

Use deterministic time in tests where possible.

## Open Decisions

None. The user selected day/week-only rendering.

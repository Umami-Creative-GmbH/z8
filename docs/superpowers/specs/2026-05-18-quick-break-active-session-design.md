# Quick Break During Active Session Design

## Context

The webapp currently treats breaks as gaps between work periods. The personal timeline and break calculations derive break time from the space between one completed work period and the next work period. The active clock UI is split across `ClockInOutWidget`, `TimeClockPopover`, and the shared `useTimeClock` query hook.

Users who forgot to record a break while staying clocked in need a fast correction path that does not force them through a full clock-out flow or end their working day.

## Goal

Add a compact coffee-button action beside the Clock Out button while the user is clocked in. The action asks only for a break duration in minutes. Applying it records a real break gap ending at the current time and keeps the user clocked in.

Example: if the user applies `30` minutes at 14:00, the active work period is closed at 13:30 and a new active work period starts at 14:00.

## Approach

Use the existing break-as-gap model by splitting the active session into two work periods. This avoids introducing a second break storage model and keeps reporting, compliance, and the timeline consistent with existing behavior.

Rejected alternatives:

- Shift the active session start time forward. This would reduce elapsed time but would not create an auditable break gap.
- Add a standalone break record. This is larger than the requested feature and does not match the current derived-break model.
- Reuse the public clock-out and clock-in actions directly. Those actions are oriented around real-time user actions and can trigger unrelated clock-out behavior such as notes and compliance handling.

## Server Behavior

Add a server action, named conceptually `addBreakToActiveSession`, that accepts a positive integer `breakMinutes`.

The action will:

- Authenticate the current user and resolve the current employee.
- Load the employee's active work period scoped to that employee and organization.
- Reject the request if the user is not clocked in.
- Reject invalid durations, including non-integers, zero or negative values, and values greater than or equal to the active session duration.
- Compute `breakStart = now - breakMinutes` and `breakEnd = now` using the server clock.
- Reject if `breakStart` is not after the active period start time.
- Create a `clock_out` time entry at `breakStart`.
- Update the existing active work period with `clockOutId`, `endTime`, `durationMinutes`, `isActive: false`, and `approvalStatus: "approved"`.
- Create a new `clock_in` time entry at `breakEnd`.
- Insert a new active work period starting at `breakEnd`, preserving the current work location type when available.

The action returns the new active work period id and start time so the client can refresh immediately.

## UI Behavior

Show the quick-break control only while clocked in and while the post-clock-out notes form is not visible.

In the main time tracking card, render the Coffee icon button beside Clock Out. In the header popover, render the same control near the Clock Out action so both clock surfaces support the feature.

Clicking the coffee button opens a small popover with:

- A title such as `Add break`.
- One numeric input labelled `Break duration in minutes`.
- An Apply button.
- A short helper line explaining that the user stays clocked in.

On success, close the popover, show a success toast, invalidate the time-clock status query, and refresh the active-session timer from the new clock-in time. On failure, keep the popover open and show the returned error.

## Data Flow

The client will call the new mutation through `useTimeClock`, similar to existing clock-in and clock-out mutations. On success, the hook invalidates `queryKeys.timeClock.status()` and `queryKeys.employeeClockStatuses.all`.

Offline queuing is not included for this feature. Because the action creates two time entries and splits a work period, it should require an online server confirmation to avoid corrupting the local pending clock event queue.

## Validation And Errors

The minimum accepted duration is `1` minute. The maximum is strictly less than the active session length in whole minutes. The server is the source of truth for all validation.

User-facing errors should be direct:

- `You are not currently clocked in.`
- `Enter a break duration of at least 1 minute.`
- `Break duration must be shorter than your current session.`
- `Failed to add break. Please try again.`

## Testing

Add server-action tests for successful active-session split, invalid duration, not-clocked-in behavior, and break duration equal to or longer than the active session.

Add client tests for the quick-break popover: visible only while clocked in, submits a valid minute value, displays errors, and disables Apply while the mutation is pending.

## Scope

This design does not add custom break start/end fields, break notes, project selection, offline support, or a separate break table. It only records a remembered break ending at the current server time.

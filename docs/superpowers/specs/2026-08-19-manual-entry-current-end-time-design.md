# Manual Entry Current End Time Design

## Goal

Default a new manual time entry's clock-out time to the current exact minute in the employee's timezone instead of the fixed `17:00` value.

## Behavior

`getDefaultValues()` calculates the current employee-local time as `HH:mm` whenever the manual-entry panel initializes or resets on open. The existing `09:00` clock-in default remains unchanged.

An explicit `defaultClockOutTime` prop continues to take precedence. This preserves callers that intentionally open the panel with a selected end time.

The employee timezone is authoritative. The browser timezone and server timezone must not affect the default.

## Boundaries

This change affects only initial form values. It does not continuously update an open form, round the minute, alter submitted timestamps, or change timezone mismatch handling.

## Testing

Use a fixed clock to verify exact-minute formatting in the employee timezone, including a browser/employee timezone difference. Verify that an explicit default still wins and that reopening recalculates the current value.

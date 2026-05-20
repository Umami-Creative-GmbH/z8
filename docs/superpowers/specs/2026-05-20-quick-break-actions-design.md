# Quick Break Actions Design

## Context

The calendar/time tracking view already uses `QuickBreakPopover` beside the primary clock action. The clock action currently takes the available row space, causing the break button to sit outside the intended view. The app header time clock popover also already contains a quick break action inside its expanded content, but the user needs a faster icon-only break entry point beside the clock-out button.

## Design

Reuse `QuickBreakPopover` for both surfaces so break duration, validation, loading, and mutation behavior stay consistent. The popover opens with `30` minutes prefilled and allows users to adjust the duration before applying.

In the calendar/time tracking widget action row, render the clock action at two thirds of the row and the quick break action at one third when the user is clocked in. When the user is not clocked in, keep the clock-in action full width and do not render the break action.

In the app header, render an icon-only coffee break trigger immediately after the clock-out trigger only while the user is clocked in. The icon-only trigger keeps an accessible label of `Add break` and opens the same adjustable popover.

## Components

- `QuickBreakPopover`: add a small display option for icon-only triggers while keeping the existing default text behavior.
- `ClockInOutWidget`: adjust the action row sizing to `2/3` and `1/3` while clocked in.
- `TimeClockPopover`: render a standalone header quick break trigger next to the existing clock trigger when clocked in.

## Testing

Run focused tests for quick break and time clock popover behavior, plus type/lint validation if available. Existing quick break tests should continue to cover validation and duplicate-submit protection.

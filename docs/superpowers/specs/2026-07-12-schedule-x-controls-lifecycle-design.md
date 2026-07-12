# Schedule-X Controls Lifecycle Fix

## Problem

`ScheduleXCalendarWrapper` calls `calendarControls.setDate()` from a React effect that is registered before `useCalendarApp()` registers Schedule-X's initialization effect. In Schedule-X 4.6.1, the controls plugin receives its internal calendar app only when `createCalendar()` runs. On the first effect pass, the plugin's internal app is therefore undefined, and `setDate()` crashes while reading `datePickerState`.

## Design

Treat the `calendar` value returned by `useCalendarApp()` as the readiness signal for imperative controls. Configure Schedule-X with `selectedDate` so the initial calendar app starts on `currentDateKey`, then synchronize later `currentDateKey` changes only when `calendar` is non-null. The synchronization effect will depend on `calendar`, `calendarControls`, and `currentDateKey`.

Navigation handlers remain imperative because they run after the calendar is interactive. Existing Temporal `PlainDate` date keys and selected-employee calendar semantics remain unchanged.

## Alternatives Considered

- Register `useCalendarApp()` before the synchronization effect. This relies on effect ordering inside a third-party hook and is fragile across library changes.
- Catch and ignore the initialization exception. This hides invalid lifecycle usage and could conceal real control failures.

## Testing

Update the Schedule-X React test double to model the real lifecycle: return `null` initially, initialize the controls plugin in an effect, then expose the calendar app. The controls test double will throw if called before initialization. Add a regression test proving initial render, including the loading state, does not call uninitialized controls. Preserve the existing test proving a parent-provided date change reaches `setDate()` after initialization.

Run the focused calendar test file, relevant static checks, and the project React diagnostics before completion.

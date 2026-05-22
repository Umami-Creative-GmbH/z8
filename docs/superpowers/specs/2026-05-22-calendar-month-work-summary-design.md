# Calendar Month Work Summary Design

## Purpose

Extend `/calendar` month view so employees and managers can review policy-required hours at a monthly cadence. The month view should show daily actual-vs-required totals, weekly totals, and a month total summary when the selected employee has policy-derived required hours.

This builds on the existing calendar work-policy hours feature. There is still no fallback default such as `8h`; status appears only for dates with a policy requirement.

## Current Context

`CalendarView` fetches events through `useCalendarData`. The API now returns `dailyRequirements` and `dailyActualMinutes` alongside `events`, and `CalendarView` builds `DailyWorkHoursSummaries` with `buildDailyWorkHoursSummaries`.

Day and week views use Schedule-X plus `DailyRequirementStrip`. Year view uses the same summaries for status dots. Month view currently uses Schedule-X month grid through `ScheduleXWrapper`, which is not a good fit for weekly sum columns or dense work-hour summaries.

## Recommended Approach

Render a custom `MonthWorkSummaryView` when `viewMode === "month"` instead of using Schedule-X month grid. Day and week remain Schedule-X-based, and year remains the existing custom year view.

This keeps the information architecture explicit and avoids brittle DOM injection into Schedule-X internals. The custom month view can reuse the existing `events`, `workHoursData`, current month state, selected day behavior, week-start preference, locale, and existing event click flow.

## Layout

Desktop month view should render:

- A month grid with weekday columns.
- An additional right-side `Sum` column for weekly totals.
- A compact month summary card above or aligned to the right of the grid.
- Week numbers on the left when space allows, matching the reference image's information model.

Each day cell should show:

- Day number.
- Optional holiday or absence indicators using the existing calendar event colors and labels.
- For days with a policy requirement, a compact work-hours block:
  - signed delta, such as `+2:06` or `-0:45`.
  - actual and required time, such as `10:06 / 8:00`.
  - green text for `met` and `over`, red text for `under` and `missing`.

Days without a policy requirement should stay visually quiet unless they contain events. Out-of-month days should be muted or hatched and should not show work-hour status unless they are included in the displayed month range by design. The first implementation should focus status calculations on the active month.

Weekly sum cells should aggregate only days in that displayed week that belong to the active month and have policy requirements. Each weekly sum should show:

- signed weekly delta.
- weekly actual and required total.
- the same green/red status color rules as daily cells.

The month summary should aggregate the active month only and show:

- signed month delta.
- month actual and required total.
- green when the total is met or over, red when under.

## Interaction

Clicking a day cell should switch to day view for that date, matching the year-view behavior. Event indicators inside a day should be non-clickable in the first implementation; users can enter day view for full event details. The priority is the work-hours summary, not full event management inside month cells.

The view should not create fake calendar events for work summaries. Work-hour numbers are derived summaries and should remain separate from real `CalendarEvent` objects.

## Responsive Behavior

Desktop should use the full grid with the weekly `Sum` column.

On narrower screens, the month view should prioritize readability over preserving the exact desktop table shape. The first implementation should use horizontal scroll for the full grid so the desktop information model remains consistent and all daily, weekly, and monthly totals stay accessible without introducing a second mobile-only layout.

## Data Flow

No new backend endpoint is planned. Existing `/api/calendar/events` already returns the required data:

- `events` for holidays, absences, and optional visible work periods.
- `dailyRequirements` for required minutes by date.
- `dailyActualMinutes` for actual completed work minutes independent of the Work Periods display filter.

`CalendarView` should pass the existing `workHoursData` and `events` to `MonthWorkSummaryView`. The month view should derive:

- day cells from the active month, week-start preference, and locale.
- weekly summaries from `workHoursData` entries in each active-month week.
- month summary from all active-month `workHoursData` entries.
- event indicators by grouping `events` by date.

All date handling should use Luxon or existing Luxon-based helpers. Avoid native-date arithmetic for new month-grid calculations.

## Accessibility And Internationalization

All visible text and accessible labels should use Tolgee translation keys with fallbacks. Day cells should have accessible labels that include date, event context when present, and work-hour status when present. Weekly and monthly summary cells should expose actual, required, delta, and status to assistive technology.

Color must not be the only signal. The signed delta text and actual/required numbers provide the primary status signal; color is secondary.

## Testing

Add focused tests for pure summary/grid helpers where practical:

- month weeks respect the user's week-start preference.
- weekly totals aggregate only active-month required days.
- month totals aggregate active-month required days.
- no summaries render when no policy requirements exist.

Add component tests for `MonthWorkSummaryView` covering:

- daily actual/required display.
- weekly `Sum` column display.
- month summary display.
- hidden work-period events do not break actual totals because `dailyActualMinutes` feeds `workHoursData`.
- accessible labels include relevant date and work-hour context.

Run the existing calendar API, work-hours summary, and webapp build checks after implementation.

## Out Of Scope

This design does not add new policy calculation rules, absence-aware requirement reduction, payroll export logic, or editable month-cell work periods. It does not change day/week/year behavior except for routing month view to the new custom component.

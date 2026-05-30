# Calendar Async Day Summaries Design

## Goal

Day and week calendar requirement summaries should appear automatically after the calendar data loads, without requiring the user to click the refresh button. While the summary data is loading or refetching, users should see a small skeleton indicator in the same header area where the day summary badge will appear.

## Current Behavior

`ScheduleXCalendarWrapper` injects requirement summary badges into Schedule-X day/week header cells using DOM manipulation. The injection currently runs once on the next animation frame. Schedule-X can render its header cells after that frame, so the injection may run before the target cells exist. A later manual refresh changes render timing and causes the badges to appear.

## Approach

Keep the existing API response and summary calculation. Make the Schedule-X header injection resilient by retrying for a short bounded window until header cells are available. Add a summary-loading state separate from the full calendar loading state so the already-rendered calendar can show skeleton pills during background fetches.

## Components

- `apps/webapp/src/hooks/use-calendar-data.ts`: expose React Query `isFetching` in addition to `isLoading`.
- `apps/webapp/src/components/calendar/calendar-view.tsx`: pass the summary-loading state to day/week and month calendar components.
- `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: inject either skeleton pills or completed summary badges into Schedule-X header cells. Retry injection briefly when header cells are not ready.
- `apps/webapp/src/components/calendar/schedule-x-calendar.css`: style the skeleton pills consistently with the existing summary badges.
- Tests in `calendar-view.test.tsx` and `schedule-x-calendar.test.tsx` cover prop wiring and retry decisions.

## Data Flow

The calendar events endpoint remains the single data source. `useCalendarData` returns `isLoading` for the initial fetch and `isFetching` for any active fetch. `CalendarView` derives `workHoursData` from fetched events, requirements, and actual minutes as it does today. Day/week views receive `isSummaryLoading={isFetching}` and render header skeletons until fresh summaries are available.

## Error Handling

Existing calendar error rendering remains unchanged. If a fetch fails, the existing error banner appears and the retry injection stops after its bounded attempts. No stale DOM content is left behind because each injection pass first clears existing summary/skeleton nodes.

## Testing

Tests should verify that `CalendarView` passes the summary loading state to the Schedule-X wrapper and month summary view. Unit tests should verify the retry helper continues while not all expected header cells exist and stops when cells are ready.

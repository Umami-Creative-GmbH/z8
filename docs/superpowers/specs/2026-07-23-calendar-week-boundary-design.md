# Calendar Week Boundary Data Design

## Problem

The calendar week renderer can show seven local calendar dates spanning two
months, but the calendar data hook currently requests only the month containing
the visible range midpoint. Events, daily requirements, and daily actuals from
the other month are therefore absent. The same mismatch can occur across a
December/January boundary.

## Design

Week view will request data for its complete visible local-date range. The
client will send inclusive ISO calendar-date keys for the visible week. The
calendar API will validate that range, resolve it in the selected employee's
calendar timezone, and fetch every calendar month touched by the range.

The API will merge the touched-month results, deduplicate events by ID, and
return daily requirements for the requested local-date boundaries. Existing
single-month behavior for day and month views and full-year behavior for year
view will remain unchanged.

Canonical event instants and duration calculations remain UTC-based. The range
keys describe calendar display boundaries only and are interpreted using the
selected employee's timezone, never the viewing manager's timezone.

## Components and Data Flow

1. The week calendar reports its visible start and end date keys.
2. `CalendarView` retains that visible range and passes it to
   `useCalendarData` only while week view is active.
3. `useCalendarData` includes the range in both the request and React Query
   cache key.
4. The calendar events route validates the range, enumerates the touched
   calendar months, loads those months using the existing organization-scoped
   services, deduplicates overlapping event results, and calculates summaries
   for the requested range.

Navigation, employee selection, filters, refresh invalidation, and Schedule-X
rendering continue to use their existing paths.

## Validation and Errors

Range parameters must be supplied together, must be real ISO dates, and must
form a non-descending range no longer than seven days for week requests.
Malformed or oversized ranges return HTTP 400. Authorization and
organization/employee scoping remain unchanged and run before scoped data is
returned.

## Testing

- A component/hook regression test proves that a visible cross-month week is
  requested with both boundary date keys.
- An API regression test proves that both touched months are loaded and their
  events and daily actuals are merged without duplicates.
- A year-boundary regression case proves that December and January are both
  loaded.
- Existing day, month, year, authorization, and timezone tests remain green.


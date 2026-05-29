# Calendar Entry Offset Display Design

## Goal

Render `/calendar` work-period blocks using the UTC offset captured on each linked time entry. A manual entry saved as 08:00-10:00 with UTC+02:00 must appear as 08:00-10:00 on the calendar, not as the equivalent UTC wall time. The block should also show the saved timezone/offset context.

## Existing Context

Work periods store canonical UTC instants on `work_period.startTime` and `work_period.endTime`. The linked clock-in and clock-out `time_entry` rows carry `utcOffsetMinutes` and optional `timezone`. The calendar service already joins these entries and exposes `clockInUtcOffsetMinutes`, `clockInTimezone`, `clockOutUtcOffsetMinutes`, and `clockOutTimezone` in `WorkPeriodEvent.metadata`.

`calendarEventToScheduleX` currently converts work-period UTC instants into the selected calendar timezone. That makes an event saved as 08:00 UTC+02:00 display as 06:00 when rendered in UTC.

## Design

For `work_period` events, the Schedule-X adapter will build dynamic endpoints from the saved per-entry offset:

- Use `clockInUtcOffsetMinutes` for the block start.
- Use `clockOutUtcOffsetMinutes` for the block end.
- If an endpoint offset is missing, fall back to the existing calendar timezone behavior.
- Preserve UTC `Date` values on the source event for duration, ordering, details, and persistence.

The displayed block content will include the endpoint timezone context. When both endpoints share the same label, show one label. When they differ, show both labels so travel/cross-timezone periods are auditable.

## Data Flow

1. `getWorkPeriodsForMonth` reads work periods and linked time entries with organization-scoped filters.
2. It returns UTC instants plus endpoint offset/timezone metadata.
3. `calendarEventToScheduleX` converts each endpoint to a fixed-offset `Temporal.ZonedDateTime` when offset metadata exists.
4. Schedule-X receives endpoint-local wall-clock values and renders the block at the saved entry times.

## Testing

Add adapter-level tests proving:

- A work period stored as `06:00Z-08:00Z` with `utcOffsetMinutes: 120` renders as `08:00-10:00` in a UTC+02:00 offset zone.
- Mixed endpoint offsets use different offset zones for start and end.
- Missing metadata keeps the existing calendar timezone fallback.

## Scope

This change only affects calendar rendering for work-period blocks and their timezone label content. It does not alter storage, querying, duration calculation, corrections, or manual-entry parsing.

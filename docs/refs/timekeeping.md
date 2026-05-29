# Timekeeping Reference

Timekeeping is a fundamental domain model in Z8. Read this before changing time tracking, calendars, reports, payroll, approvals, imports, exports, mobile/offline sync, or migrations involving time data.

## Canonical Storage

- Store every actual event instant in UTC.
- `time_entry.timestamp` is the canonical event instant.
- `work_period.startTime` and `work_period.endTime` are canonical UTC instants derived from linked time entries.
- Durations are calculated from UTC instants. Do not calculate worked time by subtracting displayed wall-clock strings.

## Per-Entry Timezone Capture

Each `time_entry` must store the timezone context that applied at the exact event instant:

- `utcOffsetMinutes`: the UTC offset at that instant, such as `120` for UTC+02:00 or `-300` for UTC-05:00.
- `timezone`: the IANA timezone when known, such as `Europe/Berlin` or `America/New_York`.
- `timezoneSource`: where the timezone context came from, such as `browser`, `user_setting`, `manager_target_user_setting`, or `backfill`.

The offset is the audit-critical value. The IANA timezone is supporting context for validation, display, and debugging.

Never insert a `time_entry` without timezone capture fields. If adding a new clocking/import/sync path, route through the shared time entry creation helper or derive capture metadata server-side before inserting.

## Browser Timezone Handling

Browser/device timezone is useful evidence for self-service entries, but the server must validate it and derive the offset itself. Do not trust client-provided offset values.

Use browser timezone for self clock-in/out when available. If the browser timezone differs from the user's saved timezone, the UI should let the user update the saved timezone, continue once, or cancel.

Manager-created entries for another employee must not use the manager's browser timezone. Use the target employee's timezone context and mark the source as `manager_target_user_setting`.

## Travel And Cross-Timezone Periods

Clock-in and clock-out can happen in different offsets. Example: an employee clocks in in Berlin and clocks out in New York after five hours of travel.

The correct model is:

- Clock-in entry stores the Berlin event instant and Berlin offset.
- Clock-out entry stores the New York event instant and New York offset.
- The work period duration is the UTC difference between the two instants.
- UI can display each endpoint with its captured offset.

Do not normalize both endpoints to the viewer's timezone for audit meaning.

## Manual Entries

Manual entry wall-clock times must be interpreted in the timezone the UI says they are in.

If a self-service manual-entry mismatch flow lets the user continue in the browser timezone, submit that browser timezone as the effective timezone used to parse the wall-clock values and as the browser capture context. Do not parse in one timezone while labeling capture as another.

Manager-on-behalf manual entries use the target employee's timezone, not the manager's browser timezone.

## Calendar Display And Query Boundaries

Single-employee calendars should render in the selected employee's timezone, not the viewing manager's timezone.

Calendar queries must use the selected employee's local calendar boundaries converted to UTC. Do not query a month using UTC boundaries when rendering a non-UTC employee calendar, or events near month boundaries will be dropped or included on the wrong local month.

Daily actuals, daily requirements, and summary date keys must be keyed by the selected employee's calendar timezone.

## Offline And Mobile Sync

Offline events must capture browser/device timezone at the time the user performs the clock action. Do not fill missing timezone context with the current browser timezone at later sync time; the user may have moved.

Direct sync APIs must be organization-scoped, transactionally safe, and protected against duplicate active periods or orphan clock-out entries.

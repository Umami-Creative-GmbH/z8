# Time Entry Offset Capture Design

## Context

Z8 stores time entry instants in UTC and lets users configure a display timezone. This breaks down when a manager views an employee in another timezone: the calendar currently renders timed work periods in the viewer's timezone, so a New York employee's 08:00 work period can appear shifted on a German manager's calendar.

Future team calendar views also need to show employees side by side using each employee's local event context. A Berlin clock-in and a New York clock-out must preserve the actual UTC duration while still showing the offset that applied at each clock event.

## Goals

- Keep UTC timestamps as the canonical source of truth for calculations, durations, overlap checks, and storage.
- Store the UTC offset that applied at each individual `time_entry` event.
- Support travel cases where clock-in and clock-out happen in different offsets during one work period.
- Render single-employee calendars in the selected employee's timezone, not the viewing manager's timezone.
- Add self-service timezone mismatch handling for self clock-in/out and self manual entries.
- Backfill existing entries as Berlin summer time, using `+120` minutes, per the current production assumption.

## Non-Goals

- Do not build the future team calendar in this run.
- Do not change UTC duration semantics.
- Do not show browser timezone mismatch modals for manager-created entries on behalf of another employee.
- Do not replace the existing user timezone preference model.

## Data Model

`time_entry.timestamp` remains the canonical UTC instant. Add per-entry timezone capture fields to `time_entry`:

- `utcOffsetMinutes`: required integer offset at the event instant, for example `120` for UTC+02:00 and `-300` for UTC-05:00.
- `timezone`: optional IANA timezone string when known, for example `Europe/Berlin` or `America/New_York`.
- `timezoneSource`: text or enum value describing how the timezone context was chosen. Initial values should cover `browser`, `user_setting`, `manager_target_user_setting`, and `backfill`.

`work_period` does not need duplicated offset columns because it already references `clockInId` and `clockOutId`. Start and end offsets can be resolved through those related `time_entry` rows. If an employee clocks in in Berlin and clocks out in New York, `work_period.startTime` and `work_period.endTime` remain UTC instants, while the clock-in entry stores `+120` and the clock-out entry stores the New York offset for that instant.

The migration must be idempotent and journaled after the current latest Drizzle migration. Existing rows get `utcOffsetMinutes = 120`, `timezone = 'Europe/Berlin'`, and `timezoneSource = 'backfill'`.

## Data Flow

For self clock-in/out and self manual entries, the client reads the browser timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone`. When that timezone is valid and differs from the saved user timezone, the UI shows a mismatch modal before submitting the time action.

The mismatch modal offers three paths:

- Update the saved timezone and continue.
- Continue once without updating the saved timezone.
- Cancel without submitting the time action.

For manager-created manual entries, the browser timezone is ignored. The flow uses the target employee's saved timezone and marks the source as `manager_target_user_setting`.

The server does not trust a client-provided offset as authoritative. It accepts a client-provided timezone only if it is a valid IANA timezone, then derives `utcOffsetMinutes` from the accepted timezone and the exact entry timestamp. If browser timezone data is invalid or missing in a self flow, the server falls back to the saved user timezone and marks the source as `user_setting`.

Manual entries derive the UTC instant from the submitted local date/time and the effective timezone. The stored offset must be calculated for that exact local instant, not from the current offset, so DST boundaries and historical entries behave correctly.

## Calendar Behavior

Single-employee calendar views should render timed work periods in the selected employee's saved timezone. This replaces the current behavior where Schedule-X uses the viewing user's timezone. A German manager viewing a New York employee should see that employee's 08:00 work period at 08:00 on the employee calendar.

Work period event metadata should include the captured offsets for the linked clock-in and clock-out entries. Details or labels can then show offset-aware times, especially when offsets differ:

```text
08:00 UTC+02:00 - 07:00 UTC-04:00
```

The future team calendar can use the same metadata to place each employee's entries according to their own local event context while still preserving UTC instants for ordering and duration.

## Error Handling

If updating the saved timezone from the mismatch modal fails, the UI shows an error and does not submit automatically. The user can retry, continue once without updating, or cancel.

If the saved timezone update succeeds but the clock/manual entry submission fails, the saved timezone remains changed. This is acceptable because the update reflects the user's explicit choice.

If timezone detection is unavailable, the self flow continues with the saved user timezone. The server still stores an offset derived from that saved timezone and timestamp.

New `time_entry` rows must always have `utcOffsetMinutes`. Fallbacks are allowed for determining the offset source, but creating a row without an offset is not allowed after the migration.

## Testing

- Schema and migration tests verify the new time entry fields and that the migration is journaled after the latest existing migration.
- Timezone utility tests verify offset derivation for `Europe/Berlin`, `America/New_York`, DST-sensitive dates, and invalid timezone fallback.
- Clock-in/out action tests verify browser-derived timezone capture for self flows and saved-timezone fallback when browser timezone is unavailable.
- Manual entry tests verify self manual entries can use browser timezone, manager-created entries use the target employee timezone, and UTC duration remains correct when start and end offsets differ.
- Calendar tests verify selected employee timezone is passed to Schedule-X instead of the viewing manager timezone.
- UI tests verify mismatch modal behavior for update-and-continue, continue-once, and cancel.

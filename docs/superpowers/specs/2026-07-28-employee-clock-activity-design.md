# Employee Clock Activity Design

## Goal

Show when each employee last clocked in or out in the managed-employees dashboard widget and on the team page. Recent activity should be easy to scan without replacing the existing green or red clock-status dot.

## Scope

- Add activity text to every employee shown in the managed-employees dashboard widget.
- Add the same activity text to team-page cards and table rows.
- Keep the existing presence polling interval and clock-status indicator.
- Do not add activity text to other consumers of the shared employee presence hook.
- Do not change time-entry storage, clock-in or clock-out behavior, or permissions.

## Display Rules

For the latest non-superseded `clock_in` or `clock_out` event:

- Show localized relative text when the event is less than three elapsed hours old **or** occurred on the same event-local calendar day as now.
- Format relative durations using whole elapsed minutes: `since 40min`, `since 2h 15min`, or `since 8h`.
- Omit a zero-minute remainder, so 120 elapsed minutes renders as `since 2h`.
- Render an event less than one minute old as `since 0min`.
- Otherwise show localized text in the form `last activity dd.mm.`, with two-digit day and month from the event's captured offset.
- Omit the activity text when the employee has never clocked in or out.
- Omit the activity text for malformed data, including an invalid instant, an invalid offset, or an event timestamp in the future.

The three-hour comparison uses canonical UTC instants. The same-day comparison and `dd.mm.` rendering use the event's stored `utcOffsetMinutes`, not the viewer's timezone. The current instant is projected into that same fixed offset before comparing calendar dates. This preserves the event-local meaning required by Z8's timekeeping model, including recent events across the viewer's midnight.

## Recommended Approach

Extend the existing batched presence response with latest clock activity metadata. This keeps status and activity in one permission-aware, organization-scoped request and avoids a second polling query.

Each accessible employee's response value will contain:

- `status`: `clocked-in`, `clocked-out`, or `unknown` as applicable.
- `lastActivityAt`: the latest clock-in or clock-out instant serialized as a UTC ISO string, or `null`.
- `lastActivityUtcOffsetMinutes`: that event's captured offset, or `null`.

The shared client hook will continue exposing `getStatus(employeeId)` for its existing consumers and add an activity-aware accessor for the two affected screens. Existing presence-only surfaces will not need UI changes.

## Alternatives Considered

### Separate Activity Query

A second endpoint and hook could load latest activity independently. This would avoid changing the presence response shape, but it would duplicate employee authorization work, add another polling request, and permit clock status and latest activity to come from different refreshes.

### Enrich Each Screen's Employee Loader

The dashboard and team loaders could each query latest activity. This would keep the shared presence API unchanged, but duplicate querying and formatting integration while leaving activity stale relative to the polled status dot.

The enriched presence response is preferred because both target screens already consume it and it preserves one freshness boundary.

## Server Data Flow

1. The client passes a normalized employee ID list to the existing presence action.
2. The action resolves the active organization and the actor's accessible employee set using the existing employee-settings authorization helpers.
3. The action queries active work periods to derive current clock status exactly as it does today.
4. For the same accessible employee set, it queries `time_entry` rows scoped by `organizationId`, restricted to `clock_in` and `clock_out`, and restricted to `isSuperseded = false`.
5. Rows are ordered newest first by canonical `timestamp`; the first row per employee supplies `lastActivityAt` and `utcOffsetMinutes`.
6. The action returns one presence snapshot per accessible employee. Requested inaccessible employees remain absent from the response and therefore resolve to `unknown` with no activity on the client.
7. TanStack Query continues caching and polling the batch every 30 seconds on the dashboard and team page while preserving previous data during refreshes.

Corrections are excluded because the requested activity is specifically the last clock-in or clock-out. Superseded original entries are excluded so corrected history does not expose stale activity.

## UI And Components

Add a small shared `EmployeeActivityText` component backed by an exported pure formatter. The formatter accepts the UTC ISO instant, captured offset, localized templates, and an optional current instant for deterministic tests. Temporal performs elapsed-time and fixed-offset calendar calculations after parsing the serialized database-boundary value.

The component renders muted extra-small text and returns nothing when activity metadata is absent or invalid.

Placement:

- Dashboard employee cards: within the identity/details column below the existing position or email line.
- Team cards: within the identity/details column below the existing email and optional position.
- Team table: within the employee identity cell below the existing email.

The existing `UserAvatar` status dot remains unchanged. Activity text is adjacent identity metadata rather than part of `UserAvatar`, because most avatar consumers do not need it and the text requires layout space.

## Localization

Add activity templates to the appropriate shared namespace for every currently supported locale. The templates must support:

- Relative minutes.
- Relative hours without a minute remainder.
- Relative hours and minutes.
- Last activity with a preformatted `dd.mm.` value.

The English fallbacks are `since {minutes}min`, `since {hours}h`, `since {hours}h {minutes}min`, and `last activity {date}`. Locale files provide translated wording while retaining the concise numeric units appropriate for this compact metadata line.

## Error Handling

- A failed presence request retains current behavior: affected employees resolve to `unknown`, the status dot is hidden, and no activity text is shown.
- During background refetches, previous status and activity remain visible to prevent flicker.
- Missing activity metadata does not affect the clock-status dot.
- Invalid or future activity data suppresses only the activity text rather than displaying misleading elapsed time.
- Organization and manager filtering is applied before querying or returning activity, so the added metadata cannot reveal inaccessible employee history.

## Testing

Add focused tests for:

- The server action returns current status and the latest non-superseded clock-in or clock-out metadata for each accessible employee.
- The server action excludes other organizations, inaccessible employees, correction entries, and superseded entries.
- An accessible employee without clock history has a known status and null activity metadata.
- The client hook preserves `getStatus` behavior for existing consumers and exposes activity metadata without leaking omitted employee IDs.
- Relative formatting at zero minutes, under one hour, exact hours, and hours with a minute remainder.
- Same-day activity older than three hours remains relative.
- Activity under three hours across an event-local date boundary remains relative.
- Older activity renders the event-local two-digit `dd.mm.` date.
- Missing, malformed, or future metadata renders no activity text.
- The dashboard employee card, team card, and team table row render the shared activity text in their intended locations.
- Existing status-dot tests continue to pass unchanged.

## Success Criteria

- Managers see concise last-clock activity on both requested surfaces.
- Both surfaces use identical display rules and localization.
- Relative text refreshes through the existing 30-second presence polling without an additional request.
- Calendar-day meaning comes from each event's captured UTC offset.
- Tenant and manager authorization remains identical to the existing presence lookup.

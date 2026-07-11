# Manager Briefing Timezone Integration

## Goal

Make manager daily briefings use the organization's timezone as their business-day boundary, so briefing results remain correct around UTC midnight.

## Scope

- Resolve the current organization's configured timezone, falling back to UTC.
- Calculate the briefing date, open time-record query window, attendance exceptions, absences, and coverage weekday in that timezone.
- Interpret date-only shift values as UTC when querying and serializing them so the application server timezone cannot shift their calendar date.
- Add tests for a UTC instant that is already the next day in the organization timezone and preserve explicit-offset test instants.

## Exclusions

- Do not change PostgreSQL pool startup options, environment variables, type parsers, or PgBouncer configuration.
- Do not change canonical timestamp storage or time-entry timezone capture.

## Integration

Apply only the manager-briefing implementation and its tests to `dev`, without touching its existing unrelated changes. After verification, delete the obsolete briefing worktree and its rejected database changes.

## Verification

Run the manager briefing test files and typecheck the webapp. Confirm the old worktree is no longer registered after removal.

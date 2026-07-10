# Date/Time Reference

## Open This When

- You touch scheduling, reporting, payroll, approvals, or time tracking logic.
- You need timezone-safe query boundaries.
- You work on DB timestamp conversions.

## Read First

- `apps/webapp/src/lib/datetime/temporal-core.ts`
- `apps/webapp/src/lib/datetime/temporal-boundaries.ts`
- `apps/webapp/src/lib/datetime/temporal-wire.ts`
- `apps/webapp/src/lib/datetime/drizzle-adapter.ts`
- `apps/webapp/src/lib/time-tracking/timezone-utils.ts`
- `apps/webapp/src/lib/timezone/effective-timezone.ts`
- `docs/refs/timekeeping.md`

## Core Rules

1. Use Temporal for new or migrated business logic. Import `Temporal` from `temporal-polyfill`; do not rely on a global Temporal except the explicit Schedule-X integration entry points.
2. Treat UTC as canonical storage/computation.
3. Use an explicit IANA or fixed-offset timezone for display and local calendar boundaries.
4. Keep timezone source explicit (user, org, or event context).
5. Do not rely on viewer timezone for domain meaning.
6. Luxon is limited to legacy or unmigrated modules. Do not introduce it into the Temporal foundation.

## Temporal Type Selection

- Use `Temporal.Instant` for actual events and elapsed-time computation. Store and compare these canonical instants in UTC.
- Use `Temporal.PlainDate` and `Temporal.PlainTime` for calendar-only values that do not identify an instant, such as schedule dates and wall-clock times.
- Use `Temporal.ZonedDateTime` only transiently for explicit-zone display and local calendar-boundary resolution. Convert it to an `Instant` or primitive wire value at the boundary; do not persist or send the class instance across a wire boundary.

## DB Boundary Rule

Drizzle timestamps and external APIs use `Date`; convert at the boundary with `drizzle-adapter` and Temporal helpers. Do not use native `Date` for calendar math or timezone conversion, and do not send Temporal class instances across a wire boundary; serialize them to primitive strings first.

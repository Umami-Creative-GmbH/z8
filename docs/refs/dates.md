# Date/Time Reference

## Open This When

- You touch scheduling, reporting, payroll, approvals, or time tracking logic.
- You need timezone-safe query boundaries.
- You work on DB timestamp conversions.

## Read First

- `apps/webapp/src/lib/datetime/luxon-utils.ts`
- `apps/webapp/src/lib/datetime/format.ts`
- `apps/webapp/src/lib/datetime/drizzle-adapter.ts`
- `apps/webapp/src/lib/time-tracking/timezone-utils.ts`
- `apps/webapp/src/lib/timezone/effective-timezone.ts`
- `docs/refs/timekeeping.md`

## Core Rules

1. Use Luxon for business logic.
2. Treat UTC as canonical storage/computation.
3. Convert to target timezone only for display and local calendar boundaries.
4. Keep timezone source explicit (user, org, or event context).
5. Do not rely on viewer timezone for domain meaning.

## DB Boundary Rule

Drizzle timestamps are `Date`; convert at boundaries with `drizzle-adapter` helpers.

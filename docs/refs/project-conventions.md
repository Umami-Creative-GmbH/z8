# Project Conventions Reference

## Multi-Tenancy

Every feature must be organization-scoped. Always filter data by `organizationId` and enforce organization-level permissions before returning or mutating data.

Do not assume employee IDs, project IDs, categories, or other UUIDs are safe just because they exist. Verify they belong to the active organization and that the actor is authorized to use them.

## Forms

Use `@tanstack/react-form` for forms. When modifying an existing legacy `react-hook-form` form, migrate it to TanStack Form as part of the change.

## Dates

Use Luxon (`DateTime`) for date/time business logic. Do not use native `Date` for calendar math, timezone conversion, policy windows, reports, payroll exports, or compliance calculations.

For time tracking specifics, read [Timekeeping Reference](timekeeping.md).

## Auth Schema

Never edit `src/db/auth-schema.ts` directly. It is generated.

## Drizzle Migrations

Drizzle decides which migrations to run by comparing the latest row in `drizzle.__drizzle_migrations.created_at` with each entry's `when` value in `apps/webapp/drizzle/meta/_journal.json`.

New migrations must have a `when` greater than every prior migration.

If a migration was committed with an older `when` and production may have already advanced past it, do not only edit the old journal entry. Add a new idempotent recovery migration with a later `when` so production databases that skipped the old migration are fixed safely.

## RBAC

Z8 uses [CASL](https://casl.js.org/) for role-based access control. Prefer existing authorization helpers and ability checks over ad-hoc role checks.

## Icons

Use `@tabler/icons-react` exclusively. All icon components are prefixed with `Icon`, for example `IconCheck` or `IconLoader2`. Do not use `lucide-react`.

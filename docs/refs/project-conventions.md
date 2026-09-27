# Project Conventions Reference

## Multi-Tenancy

Every feature must be organization-scoped. Always filter data by `organizationId` and enforce organization-level permissions before returning or mutating data.

Do not assume employee IDs, project IDs, categories, or other UUIDs are safe just because they exist. Verify they belong to the active organization and that the actor is authorized to use them.

## Forms

Use `@tanstack/react-form` for forms. When modifying an existing legacy `react-hook-form` form, migrate it to TanStack Form as part of the change.

## Dates

Use Temporal for new or migrated date/time business logic. Keep IANA or fixed-offset zones explicit; do not use the viewer timezone for domain meaning. Native `Date` is permitted only at external and database boundaries, never for calendar math, timezone conversion, policy windows, reports, payroll exports, or compliance calculations. Luxon (`DateTime`) is limited to legacy or unmigrated modules.

For time tracking specifics, read [Timekeeping Reference](timekeeping.md).

## Auth Schema

Never edit `src/db/auth-schema.ts` directly. It is generated.

## Drizzle Migrations

Drizzle decides which migrations to run by comparing the latest row in `drizzle.__drizzle_migrations.created_at` with each entry's `when` value in `apps/webapp/drizzle/meta/_journal.json`.

New migrations must have a `when` greater than every prior migration.

If a migration was committed with an older `when` and production may have already advanced past it, do not only edit the old journal entry. Add a new idempotent recovery migration with a later `when` so production databases that skipped the old migration are fixed safely.

## PostgreSQL Integration Suites

Name every suite that needs a real database `*.integration.test.ts`. Vitest's `integration` project in `apps/webapp/vitest.config.ts` discovers them by that suffix, so no runner or CI list needs editing. `pnpm test` runs only the `unit` project.

- `pnpm --filter webapp test:integration` starts a label-owned PostgreSQL 16 container and hands it to `scripts/run-postgres-integration-suites.sh`. CI's integration job calls the same script. Extra arguments reach Vitest, so a file path runs one suite.
- The `integration` project sets `APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1`, so running it without the disposable database fails instead of skipping.
- The database gates (`repository-integration-harness.ts`, `employee-lifecycle/testing/database.test.fixture.ts`) throw when a `unit` project file calls them. A misnamed suite therefore fails `pnpm test` instead of silently skipping.

## RBAC

Z8 uses [CASL](https://casl.js.org/) for role-based access control. Prefer existing authorization helpers and ability checks over ad-hoc role checks.

## Icons

Use `@tabler/icons-react` exclusively. All icon components are prefixed with `Icon`, for example `IconCheck` or `IconLoader2`. Do not use `lucide-react`.

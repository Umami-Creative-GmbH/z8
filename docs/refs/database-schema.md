# Database Schema Reference

## Open This When

- You are adding/changing DB tables or relations.
- You are creating migrations.
- You are changing Better Auth fields that affect DB schema.

## Read First

- `apps/webapp/src/db/schema/`: primary app schema modules.
- `apps/webapp/src/db/schema.ts`: compatibility re-export.
- `apps/webapp/src/db/auth-schema.ts`: generated Better Auth tables.
- `apps/webapp/src/db/index.ts`: combined schema typing and Drizzle client.
- `apps/webapp/drizzle/`: SQL migration files and journal metadata.

## Migration Safety Rules

1. Add new migrations under `apps/webapp/drizzle/`.
2. Ensure journal `when` ordering always increases.
3. If prod might skip an older migration, add a new idempotent recovery migration instead of only rewriting old metadata.
4. Regenerate Better Auth schema before relying on new auth columns in app code.

## Commands

```bash
pnpm --dir apps/webapp run db:push
pnpm --dir apps/webapp run auth:generate
pnpm --dir apps/webapp run auth:migrate
```

`db:push` runs Drizzle's schema push and then installs the employee departure
access functions from migration `0072`. Direct `drizzle-kit push` only applies the
TypeScript schema; it does not install SQL functions. Without these functions,
setup and settings access queries fail with
`function employee_departure_denies_access(text, uuid, timestamp with time zone) does not exist`.

For a database already pushed, run the repair with the same Phase environment:

```bash
phase run -- pnpm --dir apps/webapp run db:install-departure-access
```

The repair is transactional and safe to repeat. It installs both access functions
without changing tenant rows or the migration ledger. It does not apply other
custom SQL migrations; production deployments must still use the migration runner.

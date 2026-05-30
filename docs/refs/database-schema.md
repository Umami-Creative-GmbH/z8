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
pnpm --dir apps/webapp drizzle-kit push
pnpm --dir apps/webapp run auth:generate
pnpm --dir apps/webapp run auth:migrate
```

# Better Auth Reference

## Open This When

- You are changing login/session behavior.
- You are adding/removing Better Auth fields or plugins.
- You are touching auth routing, trusted origins, or org-aware session handling.

## Read First

- `apps/webapp/src/lib/auth.ts`: server auth config, plugins, additional fields, trusted origins, secondary storage.
- `apps/webapp/src/lib/auth-client.ts`: client auth setup and inferred field typing.
- `apps/webapp/src/app/api/auth/[...all]/route.ts`: Next.js auth route bridge.
- `apps/webapp/src/lib/auth-helpers.ts`: app auth context and active-org checks.
- `apps/webapp/src/lib/effect/services/auth.service.ts`: Effect wrapper for session access.

## Safe Change Workflow

1. Update Better Auth source config in `apps/webapp/src/lib/auth.ts`.
2. Regenerate schema output.
3. Update consumers to use generated fields/types.
4. Verify org scoping still relies on `activeOrganizationId`.

Never edit `apps/webapp/src/db/auth-schema.ts` manually.

## Better Auth 1.7

- Keep `better-auth`, every `@better-auth/*` package, and the `auth` CLI on the same patch.
- The auth CLI requires Node.js 22.12 or newer.
- Read [Better Auth 1.7 Account Migration](better-auth-1-7-account-migration.md) before applying schema changes.
- Never run `auth:migrate` or `drizzle-kit push` as a schema-generation check against a shared database.

## Commands

```bash
pnpm --dir apps/webapp run auth:generate
pnpm --dir apps/webapp run auth:migrate
```

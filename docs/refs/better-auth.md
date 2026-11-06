# Better Auth Reference

## Open This When

- You are changing login/session behavior.
- You are adding/removing Better Auth fields or plugins.
- You are touching auth routing, trusted origins, or org-aware session handling.

## Read First

- `apps/webapp/src/lib/auth.ts`: server auth config, plugins, additional fields, trusted origins, secondary storage.
- `apps/webapp/src/lib/auth-client.ts`: client auth setup and inferred field typing.
- `apps/webapp/src/app/api/auth/[...all]/route.ts`: Next.js auth route bridge.
- `apps/webapp/src/lib/auth/request-session.ts`: `getRequestSession()`, the only server-side session lookup for pages, layouts, server actions and shared helpers. It awaits `connection()` first so runtime prefetches never start the session query. Only route handlers and the proxy call `auth.api.getSession` directly.
- `apps/webapp/src/lib/auth-helpers.ts`: app auth context and active-org checks.
- `apps/webapp/src/lib/effect/services/auth.service.ts`: Effect wrapper for session access.

## Safe Change Workflow

1. Change schema-shaping options (user, organization, member and invitation additional fields, SSO domain verification) in `apps/webapp/src/lib/auth/auth-schema-options.ts`; both configs read it. Other runtime behavior stays in `apps/webapp/src/lib/auth.ts`.
2. A new plugin that adds tables or fields goes into both `auth.ts` and the CLI-only `apps/webapp/src/lib/auth.cli.ts`.
3. Regenerate schema output with `auth:generate`.
4. Update consumers to use generated fields/types.
5. Verify org scoping still relies on `activeOrganizationId`.

Never edit `apps/webapp/src/db/auth-schema.ts` manually. `src/lib/auth.cli.test.ts` fails when the committed schema and the CLI config disagree.

## CLI-only config

`auth:generate` reads `apps/webapp/src/lib/auth.cli.ts`, not `auth.ts`. The runtime config imports server-only modules, Redis, mail and the database, which the Better Auth CLI cannot resolve. The CLI config repeats only what shapes the schema, uses placeholder secrets and a stub Drizzle adapter, and imports by relative path only, so the command runs the same on Windows, macOS and Linux. The runtime never imports it.

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

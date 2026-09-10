# Remove Subapp Permissions Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task.

**Goal:** Remove web, desktop, and mobile per-user access permissions.

**Architecture:** Delete permission enforcement at request boundaries and eliminate its settings, service, and persistence plumbing. Retain session authentication and organization-scoped authorization. Generate auth schema from Better Auth configuration and introduce an additive migration that drops obsolete columns.

**Tech Stack:** Next.js, Better Auth 1.7.2, Effect, Drizzle/PostgreSQL, TanStack Form, Vitest.

## Tasks

- [x] Update `apps/webapp/src/app/api/auth/desktop-login/route.test.ts` and `apps/webapp/src/app/api/organizations/switch/route.test.ts` to expect successful authorized requests despite legacy false flags. Run both using `pnpm --dir apps/webapp exec vitest run` and confirm the old permission gates fail these expectations.
- [x] Remove app permission gates from `src/proxy.ts`, auth login routes, organization switch, mobile shared authentication, and session organization status. Delete the app-access helpers/service and their exclusive tests; remove runtime registration, error variants, and obsolete audit-writing helpers.
- [x] Remove `EmployeeAppAccessFields`, employee form/validation/payload fields and mutation branches. Remove the same defaults from role templates and setup. Update existing fixtures and assertions.
- [x] Remove user additional fields from `src/lib/auth.ts`, regenerate `src/db/auth-schema.ts` with `pnpm --dir apps/webapp run auth:generate`, remove role-template columns from `src/db/schema/identity.ts`, and generate a migration with monotonically increasing journal timestamp.
- [x] Remove current documentation and translation claims about app-specific permissions, retaining historical design records.
- [x] Run the affected Vitest suites and type checks, review the diff for obsolete references and authorization regressions, and report any environment-dependent validation blockers.

## Verification results

- Observed the desktop-login and organization-switch regressions fail against the original enforcement, then pass after removal.
- 506 tests passed across 42 affected API, employee settings, role-template, auth, and approval test files.
- `CI=true pnpm --dir apps/webapp run typecheck` passed.
- Better Auth schema regenerated through the version-pinned CLI with CI validation mode and non-production test-only placeholder secrets; generated diff removes exactly three fields.
- Drizzle generated `0065_remove_subapp_permissions.sql` and snapshot. SQL drops exactly six columns; journal timestamp is later than all prior entries.
- Independent code review found no issues. React Doctor reported no findings but its maintainability analysis failed, so that check is incomplete.
- Live browser verification skipped: no running dev server. Database migration execution skipped: deployment database credentials are unavailable.

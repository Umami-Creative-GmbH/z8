# Z8 Webapp

Employee time tracking and workforce management SaaS.

## Essential Agent Rules

- Treat concurrent work as normal. Never revert, overwrite, discard, or clean up changes you did not make unless explicitly asked.
- Use **pnpm** only.
- Keep all tenant data organization-scoped. Always filter by `organizationId` and enforce org-level permissions.
- Use Luxon (`DateTime`) for date/time work, not native `Date` for business logic.
- Use `@tanstack/react-form` for forms. Migrate legacy `react-hook-form` when modifying existing forms.
- Never edit `src/db/auth-schema.ts` directly; it is generated.
- Use `@tabler/icons-react` exclusively. Icon components are prefixed with `Icon`.

## Timekeeping Rule

Z8 stores canonical instants in UTC and stores the event-local UTC offset on each `time_entry`. Do not derive business meaning from the viewer's timezone. Read [Timekeeping Reference](docs/refs/timekeeping.md) before changing time tracking, calendars, reports, payroll, approvals, imports, exports, or migrations involving time data.

## Commands

```bash
pnpm dev              # Start dev server
CI=true pnpm build    # Production build (CI=true is required to pass)
pnpm test             # Run tests (vitest)
pnpm drizzle-kit push # Push schema to database
```

## Required References

- [Agent Workflow](docs/refs/agent-workflow.md) - concurrent work, environment variables, quality checks.
- [Project Conventions](docs/refs/project-conventions.md) - multi-tenancy, forms, migrations, RBAC, icons.
- [Timekeeping Reference](docs/refs/timekeeping.md) - UTC storage, per-entry offsets, timezone display, calendar boundaries.
- [Design Context](docs/refs/design-context.md) - users, brand personality, aesthetic direction, design principles.

## Detailed Documentation

- [Better Auth Schema](docs/better-auth.md) - Custom fields, plugins, type inference.
- [Database Schema](docs/database-schema.md) - File structure, relations, adding tables.
- [Forms](docs/forms.md) - TanStack Form patterns and UI components.
- [i18n](docs/i18n.md) - Tolgee namespaces and translation workflow.
- [Date/Time](docs/dates.md) - Luxon usage patterns.
- [Billing & Stripe](docs/billing-stripe.md) - Stripe setup, webhooks, per-seat billing.

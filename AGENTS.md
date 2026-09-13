# Z8 Webapp

Employee time tracking and workforce management SaaS.

## Essential Agent Rules

- Treat concurrent work as normal. Never revert, overwrite, discard, or clean up changes you did not make unless explicitly asked.
- Use **pnpm** only.
- Before starting work on a ticket, claim it in GitHub by assigning it to the current user (`gh issue edit <number> --add-assignee @me`) and commenting that work has started. Verify the assignment so active work and ownership are visible; coordinate with any existing assignee before taking over.
- `dev` is a staging branch. Before implementing a ticket, create and switch to a dedicated feature branch (for example, `feature/241-bot-approval-attempts`) and commit the ticket's work there.
- After confirming the ticket's PR is merged into `dev`, switch back to `dev` locally and delete the completed feature branch from both `origin` and the local repository.
- Keep all tenant data organization-scoped. Always filter by `organizationId` and enforce org-level permissions.
- Use Temporal for new or migrated date/time business logic with explicit zones. Native `Date` is only for external and database boundaries; Luxon (`DateTime`) is legacy/unmigrated code only.
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

These references keep this file concise; open them when deeper implementation detail is needed.

- [Better Auth Schema](docs/refs/better-auth.md) - Custom fields, plugins, type inference.
- [Database Schema](docs/refs/database-schema.md) - File structure, relations, adding tables.
- [Forms](docs/refs/forms.md) - TanStack Form patterns and UI components.
- [i18n](docs/refs/i18n.md) - Tolgee namespaces and translation workflow.
- [Date/Time](docs/refs/dates.md) - Temporal, timezone, and date-boundary rules.
- [Billing & Stripe](docs/refs/billing-stripe.md) - Stripe setup, webhooks, per-seat billing.

## Agent skills

### Workflow selection

- Default to the Matt Pocock skill flow for ticket work; use `ask-matt` when unsure which Pocock skill applies.
- If the user explicitly requests Obra Superpowers or one of its skills (for example, `brainstorming`), follow the Superpowers flow for that task, including ticket work. Explicit user workflow selection overrides the ticket-work default.
- Keep the two flows separate: use only the selected flow's process skills unless the user explicitly switches workflows. In the Pocock flow, do not invoke any Obra Superpowers skills, including `using-superpowers`, `brainstorming`, `writing-plans`, `test-driven-development`, or `subagent-driven-development`. In the Superpowers flow, do not automatically invoke Pocock process skills.
- This workflow selection takes precedence over skill-level instructions to automatically load or combine the two flows.

### Issue tracker

Track issues and specs in GitHub Issues for `Umami-Creative-GmbH/z8`.
Before tracker operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels.
Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Use a multi-context layout rooted at `CONTEXT-MAP.md`.
Before domain exploration, read `docs/agents/domain.md`.

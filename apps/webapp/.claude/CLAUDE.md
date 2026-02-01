# Z8 Webapp

Employee time tracking and workforce management SaaS.

## Package Manager

Use **pnpm** (not npm or bun).

## Commands

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm test             # Run tests (vitest)
pnpm drizzle-kit push # Push schema to database
```

## Environment Variables

This is a **multi-tenant SaaS application**. Configuration follows these rules:

- **System-level settings** (database URLs, Redis, external service credentials): Use environment variables via Phase CLI.
- **Organization/user-specific settings** (API keys, integrations, preferences): Must use in-app settings panels stored in the database. Never use env vars for tenant-specific config.

**Important for agents**: If a task requires environment variables (e.g., database URLs, system secrets), skip that task and add a notice at the end of your response listing which tasks were skipped and why. Phase CLI variables are not available to agents.

## Quality Checks

Agents must validate their work against these skills before completing tasks:

- **/vercel-react-best-practices** - React/Next.js performance patterns
- **/web-design-guidelines** - UI accessibility and design compliance
- **/vercel-composition-patterns** - Component architecture and composition

## Key Conventions

- **Multi-tenancy**: Every feature must be organization-scoped. This is a SaaS app - always filter data by `organizationId` and enforce org-level permissions.
- **Forms**: Use `@tanstack/react-form`. Migrate legacy `react-hook-form` when modifying existing forms.
- **Dates**: Use Luxon (`DateTime`), not native `Date`.
- **Auth schema**: Never edit `src/db/auth-schema.ts` directly - it's auto-generated.

## Detailed Documentation

- [Better Auth Schema](docs/better-auth.md) - Custom fields, plugins, type inference
- [Database Schema](docs/database-schema.md) - File structure, relations, adding tables
- [Forms](docs/forms.md) - TanStack Form patterns and UI components
- [i18n](docs/i18n.md) - Tolgee namespaces and translation workflow
- [Date/Time](docs/dates.md) - Luxon usage patterns

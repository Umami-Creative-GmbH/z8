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

## Key Conventions

- **Forms**: Use `@tanstack/react-form`. Migrate legacy `react-hook-form` when modifying existing forms.
- **Dates**: Use Luxon (`DateTime`), not native `Date`.
- **Auth schema**: Never edit `src/db/auth-schema.ts` directly - it's auto-generated.

## Detailed Documentation

- [Better Auth Schema](docs/better-auth.md) - Custom fields, plugins, type inference
- [Database Schema](docs/database-schema.md) - File structure, relations, adding tables
- [Forms](docs/forms.md) - TanStack Form patterns and UI components
- [i18n](docs/i18n.md) - Tolgee namespaces and translation workflow
- [Date/Time](docs/dates.md) - Luxon usage patterns

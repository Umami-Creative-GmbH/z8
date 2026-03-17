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
- **RBAC**: Uses [CASL](https://casl.js.org/) for role-based access control.

## Detailed Documentation

- [Better Auth Schema](docs/better-auth.md) - Custom fields, plugins, type inference
- [Database Schema](docs/database-schema.md) - File structure, relations, adding tables
- [Forms](docs/forms.md) - TanStack Form patterns and UI components
- [i18n](docs/i18n.md) - Tolgee namespaces and translation workflow
- [Date/Time](docs/dates.md) - Luxon usage patterns
- [Billing & Stripe](docs/billing-stripe.md) - Stripe setup, webhooks, per-seat billing

## Design Context

### Users

Z8 is used by employees, managers, admins, and operations/compliance stakeholders inside organizations that need dependable workforce management. They use it in day-to-day operational contexts: clocking time, checking schedules, managing absences, reviewing approvals, handling payroll exports, and preparing audit-ready records. The core job to be done is to help teams record and manage work time accurately, quickly, and with enough structure to support compliance-sensitive workflows.

### Brand Personality

The brand should feel modern, efficient, and clear. Its voice should be direct, calm, and competent rather than playful or overbearing. The primary emotional goal is confidence: users should feel that the system is reliable, precise, and under control, especially in compliance-heavy or operationally sensitive moments.

### Aesthetic Direction

Future design work should favor product-first restraint over editorial experimentation. The right reference feel is closer to Stripe's crisp, technical polish than to expressive marketing-heavy aesthetics. Use a modern, friendly, tech-blue direction as the canonical palette, with clean neutrals supporting it. Preserve support for both light and dark themes, but keep the overall visual language practical, legible, and operationally trustworthy rather than ornamental.

### Design Principles

1. Prioritize operational clarity: layouts, copy, and interaction patterns should make time tracking, approvals, and reporting feel immediately understandable.
2. Design for confidence: emphasize reliability, precision, and audit-readiness through stable hierarchy, clear status signaling, and predictable behavior.
3. Keep the interface restrained: prefer calm, structured surfaces and thoughtful spacing over decorative flourishes or trend-driven visuals.
4. Use blue as the brand signal: lean on modern, friendly tech-blue accents supported by neutral backgrounds, reserving stronger colors for system states and important feedback.
5. Maintain inclusive usability: preserve strong readability, sensible contrast, and reduced-complexity interactions as a default baseline across desktop and mobile surfaces.

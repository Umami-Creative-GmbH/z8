# Agent Workflow Reference

## Concurrent Agent Work

Many agents may be running in parallel in this repository. If files have changed and this agent session did not make those changes, treat them as user or peer-agent work.

Never revert, overwrite, discard, or clean up changes you did not make unless the user explicitly asks you to do so.

## Package Manager

Use **pnpm**. Do not use npm or bun.

## Commands

```bash
pnpm dev              # Start dev server
CI=true pnpm build    # Production build (CI=true is required to pass)
pnpm test             # Run tests (vitest)
pnpm drizzle-kit push # Push schema to database
```

## Environment Variables

This is a multi-tenant SaaS application. Configuration follows these rules:

- System-level settings such as database URLs, Redis, and external service credentials use environment variables via Phase CLI.
- Organization/user-specific settings such as API keys, integrations, and preferences must use in-app settings panels stored in the database. Never use env vars for tenant-specific config.

Important for agents: If a task requires environment variables such as database URLs or system secrets, skip that task and add a notice at the end of your response listing which tasks were skipped and why. Phase CLI variables are not available to agents.

## Quality Checks

Agents must validate their work against these skills before completing tasks:

- `/vercel-react-best-practices` - React/Next.js performance patterns.
- `/web-design-guidelines` - UI accessibility and design compliance.
- `/vercel-composition-patterns` - Component architecture and composition.

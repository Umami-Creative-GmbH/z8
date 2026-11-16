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
pnpm test             # Unit tests (vitest `unit` project, no database)
pnpm test:integration # PostgreSQL suites in a disposable Docker database (run from apps/webapp)
pnpm drizzle-kit push # Push schema to database
```

## Linting and Formatting

Use oxlint and oxfmt with the root `.oxlintrc.json` and `.oxfmtrc.json`. The root
`lint`, `lint:fix`, `format`, and `format:check` scripts cover webapp and marketing
source. For focused checks, run `pnpm exec oxlint <files>` and
`pnpm exec oxfmt --check <files>` from the root. Existing source has lint and
formatting debt; report it separately from findings in changed code.

The general code-quality workflow remains manual-only, matching its prior
trigger. Oxlint rule coverage is not identical to Biome: React compiler factory
checks and CSS linting have no direct replacement in this configuration. Oxfmt
does not sort imports. Preserve meaningful suppression explanations when a rule
has no equivalent.

The Bun feasibility assessment is in [Bun adoption](bun-adoption.md). Node and
pnpm remain the supported runtime and package manager until that migration is
implemented and verified.

## Opening Files and URLs in WSL

In WSL sessions, use `wslview "<path-or-url>"` first to open reports, files, and URLs in Windows.
For local files, fall back to `explorer.exe "$(wslpath -w /absolute/path/to/file)"` if needed.

`wslview` has successfully opened a report here despite a missing WindowsApps path warning. That warning alone does not establish failure; confirm before launching a second copy.

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

# Navigation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve page navigation and time tracking readiness through four measured, independently reviewable changes.

**Architecture:** Reuse authorization and employee context within a server render, then stream time tracking regions independently. Defer ExcelJS until export and reduce repeated preference reads and translation payloads without caching live tenant data.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, Better Auth 1.7.3, Drizzle/PostgreSQL, Tolgee 7, Vitest, pnpm 12.3.4.

**Spec:** [Approved design](../specs/2026-10-02-navigation-performance-design.md), commit `df1fabaa3`, approved October 2, 2026. Published as [GitHub spec #557](https://github.com/Umami-Creative-GmbH/z8/issues/557).

## Global Constraints

- Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.
- Cache Components and Partial Prefetching are already enabled. Keep their flags and the default navigation Link behavior.
- Request-local auth reuse must not survive an organization switch, sign-out, preference mutation, or subsequent request. Keep cookie caching disabled and `connection()` before session I/O.
- Tenant queries include `organizationId`; browser props contain only display-safe data. Internal readers never become public server actions.
- Preserve UTC instants, captured event-local offsets, employee timezones, weekly boundaries, durations, and report totals. New date calculations use Temporal with an explicit zone.
- Use pnpm only; add no dependencies or database migrations. Preserve concurrent changes. Read the repository's required references before execution.
- Agents do not acquire Phase secrets. Mark credential-dependent checks as pending for the operator if an authorized fixture environment is unavailable.

## Review Focus

These additional failure cases are assigned to tests in the corresponding plans:

1. Revoked membership or changed active organization between requests: the next render/action must re-authorize (plan 1).
2. Pending or failed active-period status: clock controls must never imply that the employee is clocked out (plan 2).
3. Excel chunk/import failure: export controls recover and a subsequent attempt can succeed (plan 3).
4. Partial preferences containing invalid values or explicit false consent: defaults remain exact and false stays false (plan 4).
5. A delayed old-language catalog resolving after navigation: no mixed language, missing aliases, or refresh loop (plan 4).

## Plan boundaries and order

| Change | Plan | Ticket | Dependency | Reviewable result |
| --- | --- | --- | --- | --- |
| 1 | [Rendering reads](2026-10-02-navigation-rendering-reads.md) | [#558](https://github.com/Umami-Creative-GmbH/z8/issues/558) | None | Shared render context with fresh action authorization |
| 2 | [Time tracking streaming](2026-10-02-navigation-time-tracking-streaming.md) | [#559](https://github.com/Umami-Creative-GmbH/z8/issues/559) | Change 1 | Clock controls appear independently of secondary regions |
| 3 | [Excel loading](2026-10-02-navigation-excel-loading.md) | [#560](https://github.com/Umami-Creative-GmbH/z8/issues/560) | None | ExcelJS loads only on Excel export |
| 4 | [Settings and translations](2026-10-02-navigation-settings-translations.md) | [#561](https://github.com/Umami-Creative-GmbH/z8/issues/561) | Change 1; integrate after 2 | One preferences read and selective catalog delivery |

The four plans implement the same approved spec. Each produces independently testable software; do not combine them into one implementation PR. Within change 4, keep settings consolidation and translation delivery in separate commits, with translation integration reviewed as a whole before shipping. Merge changes 1, 2, 3, 4 into `dev` in that order unless the independent Excel change is ready earlier.

## Execution preparation and measurement

- [x] Published the approved spec as #557, checked for duplicate open navigation-performance specs, and created native sub-issues #558–#561. Verified all four parent links and the dependency edges: #559 blocked by #558; #561 blocked by #558 and #559. Planning ownership of #557 is assigned to `KaiSoellch`; implementation tickets remain unclaimed until execution starts.
- [ ] Before starting each ticket, inspect assignees, coordinate with any owner, assign `@me`, add the required start comment, and verify assignment. Prepare an isolated implementation checkout using the selected execution workflow. Create a dedicated `ai/<issue>-<change>` branch based on the required predecessor, targeting `dev` for its PR. This design branch contains documentation only.
- [ ] Record a baseline in `docs/performance/2026-10-02-navigation-baseline.md` before product edits. Use an operator-configured, authenticated production build with a disposable fixture account and two fixture organizations. Keep account, date, viewport, browser, and readiness markers fixed. Never export or mutate real employee data.
- [ ] Record at least 20 observations for each measured condition: first visits in fresh browser contexts and repeat Link navigations separately. Report median and p95, with raw anonymized samples, for route header, clock, timeline, summary, and history. Also record query counts/durations, initial loaded JS, and serialized translation/RSC bytes. Exclude invalid selectors and document automation overhead. Do not compare different readiness markers as equivalent full-page timings.
- [ ] Use existing OpenTelemetry request/database spans where available to count migrated reads. In a disposable test process, an instrumentation wrapper may collect operation names/counts at session and database seams; never log SQL parameters, cookie headers, or sessions, and never ship the wrapper. Measure a single request's migrated consumers rather than assuming a persistent layout rerenders on every navigation.

The previous production observations are exploratory, not this controlled baseline. Lack of credentials does not prevent unit-testable work, but runtime evidence remains pending and blocks a claim of measured performance improvement.

## Shared verification commands

Run targeted commands in each plan from `apps/webapp`. The Vitest unit project fails if tests reach the real database; integration suffixes run only in the integration project.

```powershell
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome ci --max-diagnostics=30 src
pnpm --filter webapp test
$env:CI = 'true'
pnpm build
```

Run the build from the repository root with `CI=true`, retaining any prior value when the shell session ends. Build can invoke license generation/network access; record environmental failures distinctly from code failures. Run `pnpm test:integration <target-file>` from `apps/webapp` with Bash/Docker support: its existing runner provisions and removes its own labeled PostgreSQL 16 container. Do not substitute production database URLs.

For changes to Cache Components/Suspense, apply `next-dev-loop`, then verify the actual production build/start with `pnpm --filter webapp start`. Run React diagnostics using the installed `react-doctor` skill at execution. Check the three repository-required Vercel quality skills if available; report unavailable skills instead of inventing their output. Tests, dependency installation, builds, and runtime changes belong to execution, not this documentation stage.

## Delivery and rollback

- [ ] For each stage, record outcomes and pending checks in `docs/performance/2026-10-02-navigation-change-N.md`, using the same baseline method against its immediate predecessor. Correctness and structural criteria are required even when measured latency differences are noisy.
- [ ] Obtain a whole-branch review, attach created PRs to this task, and follow normal deployment approval. No implementation, push, merge, or production deployment is authorized merely by the approval of the spec.
- [ ] Roll back a stage by reverting its change commits through a reviewed PR. If reverting change 1, revert changes depending on its interfaces first. No migration or permanent runtime toggle is needed.
- [ ] After a ticket PR is confirmed merged into `dev`, follow repository instructions to return its implementation checkout to `dev` and delete only that completed branch locally and on `origin`.

## Self-review

The four plans cover each spec section, use consistent context/reader/catalog interfaces, and include tests for the five review cases. Runtime cache isolation, useful prefetch/streaming, and actual payload reduction are explicit verification gates; unit mocks do not prove them. Execution method and plan approval remain to be selected by the user.

## Primary references

React documents that `cache` is scoped to Server Component requests: [React cache](https://react.dev/reference/react/cache). Next.js documents dynamic Suspense boundaries and cached catalogs under [Caching](https://nextjs.org/docs/app/getting-started/caching); verify behavior against the repository's pinned 16.3.4 installation. Tolgee's supported first-render integration is its provider's `ssr` argument: [Tolgee SSR support](https://docs.tolgee.io/js-sdk/integrations/react/ssr). These references guide the implementation; the checked-in application and approved spec determine its interfaces.

# Team-performance range evidence (#1466)

The production `getTeamPerformanceData` action derives its organization and
admin/manager scope from the current authenticated employee on every call. The
roster SQL combines organization, current active roster, optional team and current
manager assignments before retrieving employee details or range evidence. A caller
cannot broaden that scope by selecting another team.

The reader uses the same `loadAnalyticsRangeEvidence` module as work-hours and
overtime. Its mode is now `daily` (the default), `whole-week` or `team`; the overtime
caller replaces its former `wholeWeekTotals` flag with `mode: "whole-week"`.
Team mode reads raw chart periods, protected completed periods, tracking and the
established requirement/policy inputs in serial batches of at most 64 employees.
It avoids daily protected allocation, because a recorded break across midnight
can be unambiguous for the whole selected range while requiring reconciliation
when split by day. The dynamic import remains inside the service method to avoid
the existing shared-runtime import cycle.

## Preserved behavior and correctness fixes

Chart totals retain clipped, floored elapsed minutes in the report calendar.
Tracking variance uses stored protected minutes in one employee-local window,
clipped to tracking and employment starts. A four-hour period storing three hours
therefore displays four chart hours and three balance hours. A subsequent
two-minute-thirty-second period storing three minutes adds two chart minutes and
three balance minutes. These distinct values are tested through the real reader.

Tracked requirements reuse confirmed employment terms, policy days, published
hourly shifts, approved absence release, employment coverage and assigned holidays.
Draft terms/shifts and shifts beginning at the following range boundary do not
contribute. Legacy employees retain raw elapsed actuals and the current effective
policy's expected days/hours with organization-wide calculation holiday
exclusions; confirmed tracked terms do not replace that legacy calculation.
Assigned holidays and global calculation exclusions keep their separate meanings.
All evidence uses the caller's transaction-bound `DatabaseService`.

Two intentional fixes accompany the migration: manager visibility now constrains
the roster before retrieval, and chart work uses the canonical completed-work
predicate, excluding deleted and live periods. The original reader returns two
teammates when only one is assigned to the manager, and three chart hours in a
fixture containing one completed, one deleted and one live hour. The regressions
return one teammate and one completed chart hour after migration.

Fixtures also assert team labels and averages, `No Team`/`Unknown` fallbacks,
renamed employees, current roster removal, fresh action denial after role reduction,
empty visibility, tenant SQL retrieval, half-open edges, protected reconciliation,
UTC instants with travel captures, and the 23-hour spring and 25-hour autumn DST
days. Recorded work, closed months and captured evidence are not rewritten.

## Scoped measurements

Recorded October 24, 2026 on Windows, AMD Ryzen 9 9950X3D2 (32 logical processors),
Node 26.9.0, pnpm 12.14.0, Vitest 5.0.3 and disposable PostgreSQL 16.15. The fixture
contains six synthetic employees and twenty nine-hour completed periods in March.
Other agents were active on the same host. Database/CPU caches were not cleared.
These measurements are public-reader Vitest durations, not browser or deployment
readiness measurements.

For each condition, one initial read warms imports and the fixture; twenty
sequential measured reads then run through the public service. p50 is the mean of
the middle two samples; p95 is the nearest-rank nineteenth sample. The original
service is loaded from commit `88fa39d35` into a temporary sibling module, with
the same current fixture, dependencies and database. That module and its temporary
test import are removed/restored afterward. No production source is replaced.

| 2026 range | Queries before → after | Warm p50 before → after (ms) | Warm p95 before → after (ms) |
| --- | --- | --- | --- |
| March 1–31 | 156 → 15 | 98.72 → 22.77 | 114.01 → 25.54 |
| January 1–March 31 | 240 → 15 | 183.65 → 25.31 | 199.53 → 28.93 |
| January 1–December 31 | 634 → 15 | 574.78 → 36.82 | 610.19 → 38.85 |

Original tracking reads are 18 and period reads seven per condition; afterward
they are one and two. For the tested policy fixture, query count is two shared
reads plus thirteen per employee batch. A separate 65-person fixture uses 28
queries, two tracking reads and four period reads for either a week or a year.
Actual captured SQL admits at most 64 scoped employee IDs per work query. Replaying
the roster/work SQL proves unauthorized and unrelated-tenant employees are not
retrieved, not merely hidden from returned metrics.

The 65-person reader also shares a one-connection pool with a concurrent
`SELECT 1` probe. Both complete, using one connection and at most one queued read.
An observed week reader duration in that probe was about 68 ms; annual range work
was about 245 ms in the same run. This demonstrates bounded reader scheduling,
not clock-command readiness or a production latency target. The fixture has sparse
work history and is not a substitute for the integrated larger history fixture.

## Reproduction and remaining gates

Run against the repository-owned disposable PostgreSQL integration environment:

```powershell
pnpm --config.verifyDepsBeforeRun=false --dir apps/webapp exec vitest run --project integration src/lib/analytics/team-performance-range.integration.test.ts
# Optional twenty warm reader samples per range:
$env:Z8_TEAM_QUERY_EVIDENCE = '1'
pnpm --config.verifyDepsBeforeRun=false --dir apps/webapp exec vitest run --project integration src/lib/analytics/team-performance-range.integration.test.ts -t 'bounds employee evidence'
```

For the original comparison, copy the committed original analytics service to a
temporary sibling module and direct only this integration test's service import
there. Run the same selected test; its query-bound assertion must fail after
printing the original samples. Restore the test import and remove the temporary
module in a `finally` block. Do not alter shared schemas, fixtures or production
credentials. The suite cleans only its own synthetic organizations and users.

All 65 PostgreSQL cases across the three analytics range suites and the existing
tracking/protected-work suites pass, along with 28 focused unit cases, full
configured type checks and changed-file lint checks. Lint retains two existing
`any` export-type warnings. Repository React
performance and security guidance applies to fresh server authorization and
bounded reads; component composition, accessibility and visual changes are not
part of this ticket's code.

Production build, authenticated chart/filter/loading/error journeys, twenty cold
browser visits and warm navigations, representative concurrent clock/break load,
large-history readiness, bytes/vitals and deployment resource telemetry remain
integration gates for #1448. Keep #1466 open until those gates are met. These local
reader measurements do not establish those outcomes.

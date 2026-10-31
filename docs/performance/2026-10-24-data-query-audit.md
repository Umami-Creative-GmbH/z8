# Data and query performance audit — 2026-10-24

This is a static review of current source, not a production profile. Impact ranks describe likely affected workloads; no millisecond or percentage gains have been measured. No runtime credentials or tenant data were accessed. Existing navigation measurements are historical and qualified in `docs/performance/2026-10-02-navigation-baseline.md`.

## Ranked opportunities

| Rank | Change | Likely speed impact | Effort | Confidence |
| --- | --- | --- | --- | --- |
| 1 | Scope absence-pattern SQL to the active organization | High at multi-tenant scale | Small, roughly half a day including regression coverage | Confirmed query shape |
| 2 | Batch analytics reads across employees and weeks | Very high for medium/large organizations and long ranges | Large, roughly 1–2 weeks | Confirmed multiplicative fanout |
| 3 | Eliminate report home-office queries per day | High on annual reports with many home-office days | Small/medium, roughly 1–2 days | Confirmed N-per-day queries |
| 4 | Add real tenant- and scope-keyed analytics caching | High for repeated analytics loads | Medium, roughly 2–4 days plus mutation coverage | Confirmed cache helper is unused |
| 5 | Stop rescanning every work period for every daily bucket | Medium/high for long work-hours ranges | Medium, roughly 1–3 days | Confirmed O(days × periods) loop |
| 6 | Reuse loaded employee/context data and overlap independent requirement reads | Medium across analytics/report loads | Medium, roughly 2–4 days | Confirmed duplicate reads and serial chain |
| 7 | Validate absence overlap indexes after adding tenant predicates | Potentially high for large absence datasets | Small/medium, roughly 1–2 days after plan capture | Requires production-like EXPLAIN evidence |

Effort estimates are engineering estimates for an experienced maintainer, not commitments. Items overlap and should be designed together.

## 1. Filter absence analytics in SQL

`AnalyticsService.getAbsencePatterns` selects all absence rows overlapping the requested dates without an organization predicate, including related employee/user/team/category records. It discards other organizations only after the query returns.

Evidence: [query](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L894), [in-memory organization filter](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L915).

Add `eq(absenceEntry.organizationId, organizationId)` to the database predicate. Preserve the org check as defense if desired. This changes fetched work from all tenants' absences in the range to the requesting organization's absences. It is also aligned with the repository's mandatory tenant-scoping convention. This review found the returned collection filtered in application code; it does not establish that other tenants' data is returned to the browser.

Also push overtime-burn-down manager scope into the employee query instead of loading all employees with managers/users and filtering afterward: [employee load](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L1353), [scope filtering](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L1378). Keep authorization before any cached result lookup.

## 2. Batch analytics reads across employees and weeks

The overtime burn-down reader nests `Effect.forEach(scopedEmployees)` and `Effect.forEach(weekBuckets)`. Each employee/week calls `sumWorkMinutesWithinTracking`, which reloads tracking context, then reads periods when applicable. Expected-hours computation adds further reads. Both loops use unbounded concurrency.

Evidence: [employee/week loops](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L1451), [tracking helper](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L39), [context query](../../apps/webapp/src/lib/time-tracking/tracking-start.ts#L21), [period query](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L122), [pool default of ten connections](../../apps/webapp/src/db/index.ts#L42).

There are E × W invocations of the tracking helper, regardless of parallel execution. For illustration, 200 employees × 26 weeks means 5,200 tracking-context calls before the additional work-period and expected-hours reads. This is a structural count, not a measured deployment workload.

Load contexts for employees once, fetch work periods for the whole scoped range once or in bounded batches, fetch policy/absence/holiday/employment evidence in batches, then bucket with the existing allocation semantics. Bound remaining concurrency to available pool capacity. The existing one-policy-lookup-per-employee optimization at [line 1438](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L1438) is already present; do not count it as new work. Team performance and work-hours analytics still also have per-employee reads at [line 421](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L421) and [line 765](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L765).

Do not remove work-transaction guards or serve mutable clock authorization from this cache. Keep employee timezone, tracking start, completed-work inclusion and protected-minute allocation rules. Work balance already has monthly projections and a hot-window/dirty-range rebuild mechanism in [service.ts](../../apps/webapp/src/lib/work-balance/service.ts#L516); reuse that architecture only where metric semantics match. Existing balance totals are not automatically interchangeable with weekly overtime deltas.

## 3. Reuse the report's full-range periods for home-office totals

`generateEmployeeReport` loads completed work periods for the report range while `aggregateHomeOfficeDays` separately executes a work-period query for every home-office date using `Promise.all`.

Evidence: [report-wide period load](../../apps/webapp/src/lib/reports/report-generator.ts#L144), [per-date query fanout](../../apps/webapp/src/lib/reports/report-generator.ts#L490).

Pass the already loaded periods to a pure home-office aggregation function, or query all relevant dates in one range and group once. This removes H work-period queries for H home-office dates when reusing report periods. It also avoids saturating the pool with annual-range report requests. Keep the existing local-day overlap/splitting behavior and completed-work condition; grouping by UTC date would change results at timezone boundaries.

## 4. Add caching to actual analytics readers

There is an analytics caching helper with TTLs and invalidation functions, but repository search finds no production call to `createCachedQuery`; its only references are its definition and example comment. The server actions directly call AnalyticsService methods.

Evidence: [helper definition](../../apps/webapp/src/lib/analytics/cache.ts#L63), [actions directly invoking the service](../../apps/webapp/src/app/%5Blocale%5D/(app)/analytics/actions.ts#L83), [work-data invalidation](../../apps/webapp/src/lib/time-tracking/tracking-date-refresh.ts#L52), [Cache Components enabled](../../apps/webapp/next.config.ts#L89).

Implement caching using the current Next Cache Components conventions already chosen by the app rather than simply enabling the legacy `unstable_cache` helper. Authorize each request first, then cache pure authorized data reads with keys including organization, role/employee visibility scope, normalized date range, timezone and filters. Use per-organization tags and explicit invalidation from work, absence, policy, holiday, employment and permission changes. A short TTL on summary analytics can help repeated visits; live clock status and authoritative writes need fresh reads. Existing invalidation helper functions invalidate global tags, so wiring them indiscriminately could evict every organization's analytics on one tenant's change.

## 5. Allocate daily tracked minutes in one pass

`readTrackedDailyWorkMinutes` loads all periods for the range, loops through each day, and invokes an allocator that scans the entire period array. It also rebuilds Temporal instant representations for the same periods repeatedly.

Evidence: [daily loop](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L97), [whole-period scan](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L147), [analytics consumer](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L769).

Bucket each period only into local days it overlaps, or maintain a sorted sweep of active periods. This changes the common case from D × P allocation checks to P plus actual day intersections. Preserve `allocateProtectedMinutes` semantics, stored duration handling, tracking clipping and reconciliation failures. Add boundary tests for midnight/DST and rounded stored durations before changing the algorithm.

## 6. Reuse read context and reduce requirement waterfalls

`loadDailyWorkRequirementsForEmployee` first loads employee/user/org fields, then independently reloads tracking context, then reads policy/history, approved absences, employment coverage, and assigned holidays in sequence. The holiday helper itself loads the employee again.

Evidence: [requirements chain](../../apps/webapp/src/lib/calendar/work-policy-requirements.ts#L590), [holiday employee lookup](../../apps/webapp/src/lib/calendar/assigned-holidays.ts#L344). Work-hours analytics already loaded employees before invoking these routines per employee.

Introduce an internal batch/read-context interface carrying an authorized organization and employee snapshot, resolved timezone and tracking context. Public action boundaries still authorize independently. Reuse the context within one request; begin independent absence, coverage and holiday reads once effective range/scope are known. Keep history-dependent calculations after their real prerequisites. This reduces repeated row reads and serial database round trips without introducing cross-request authorization staleness.

## 7. Index by measured predicates

The absence schema has employee, start-date, status and employee/status indexes, but no composite tenant/date-overlap index among the declared indexes. After fixing SQL tenant scoping, capture `EXPLAIN (ANALYZE, BUFFERS)` on representative org sizes and date ranges. Evaluate an organization/start-date index, or a range/GiST strategy if overlap scans dominate; date overlap has two inequalities, so a B-tree is not automatically sufficient.

Evidence: [absence indexes](../../apps/webapp/src/db/schema/absence.ts#L143). Work periods already have both organization/start-time and employee/organization/start-time indexes: [existing indexes](../../apps/webapp/src/db/schema/time-tracking.ts#L279). Blanket advice to add those work-period indexes would duplicate existing work.

## Validation before implementation decisions

Record per-route p50/p95 for representative small/large organizations, query counts/time, pool wait, rows returned, cache hit/miss, response bytes and event-loop CPU. Use the existing database tracing in [db/index.ts](../../apps/webapp/src/db/index.ts#L59), add stable low-cardinality query fingerprints rather than raw personal SQL parameters, and verify transaction-client paths are observed as well. Compare cold and warm paths using identical fixtures and preserved authorization/timezone rules. This audit did not run production queries or benchmarks because the agent environment has no Phase runtime configuration.

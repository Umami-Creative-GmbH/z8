# Scoped absence index measurement

Issue [#1474](https://github.com/Umami-Creative-GmbH/z8/issues/1474), following the SQL tenant scope in [#1451](https://github.com/Umami-Creative-GmbH/z8/issues/1451).

The measurement harness is prepared. PostgreSQL execution, plan comparison and the index decision are **pending**. No production schema or reader change has been made, and no evidence currently justifies either an index or a measured no-index conclusion.

## Contract and fixture

The suite calls `AnalyticsService.getAbsencePatterns` through the existing PostgreSQL integration adapter/query logger. It captures and replays the actual tenant/manager-scoped statement, including employee, user, team and absence-category relations. It does not replace that statement with a count query. Employee ownership continues to include legacy rows with a null `absence_entry.organization_id`. The reader currently includes all approval statuses and historical inactive employees; this experiment preserves those filters and its inclusive calendar-day pattern calculations.

The disposable fixture has 8 and 200 employees in the target organizations, selective manager assignments to 2 and 10 employees, two teams and two categories per organization, plus an unrelated organization with 2,000 employees. Each person has 121 synthetic four-day absences spanning month boundaries, from January 2016 through January 2026: 267,168 rows in total. Approved, pending and rejected statuses vary; approximately one quarter of rows have a null legacy organization field. No production data or Phase service configuration is needed.

March, January–March and calendar 2025 are compared, alongside the same ranges in 2020 to avoid relying only on newest-history selectivity. Two organization sizes, two visibility scopes and six ranges produce 24 conditions. Public results have independent expected totals: per visible employee the month has two overlapping absences/four inclusive calendar days, the quarter four/twelve, and the year thirteen/forty-eight. A manager sees assigned employees only. The suite also checks returned row counts and inclusion of legacy-null rows.

## Candidate comparison

The first variant retains all existing indexes. Each later variant adds exactly one fixture index while retaining existing ones:

| Variant | Keys | Reason for comparison |
| --- | --- | --- |
| Existing | Current schema indexes | Measures the scoped query before adding write/storage cost. |
| B-tree, start first | Employee, start date, end date | Employee equality followed by the upper start-date bound. |
| B-tree, end first | Employee, end date, start date | Employee equality followed by the lower end-date bound, potentially more selective for old histories. |
| GiST bounds | Employee, start date, end date | Uses `btree_gist` operator classes to compare the unchanged equality/inequality predicates. |

A `daterange` expression index alone cannot support the unchanged two-inequality statement. The GiST bounds variant evaluates that index family without changing overlap semantics or assuming every legacy interval can be converted to a range. It requires `btree_gist` in the disposable database. No organization-leading or approved-only index is substituted: those would not match the current legacy ownership/status contract.

Every condition retains twenty actual query round trips and twenty `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` executions per variant. Query timings include actual related-row transfer; EXPLAIN round trips are labeled separately from database execution time. Evidence retains p50/p95/min/max, root buffer measurements and sanitized first/last plan trees, plus actual index size and build time. The existing configuration repeats after all candidates to expose warming, physical-state or host drift. PostgreSQL version/planner settings are recorded. CPU/database caches are not evicted; these are warm fixture measurements.

Write cost is measured with twenty 100-row insert batches and twenty 100-row end-date-update batches per variant. Each uses one acquired connection and a rolled-back transaction; the end-date update can expose lost HOT-update opportunities. Actual execution/WAL evidence and variance are retained. Missing numeric coverage is not replaced with zero. Vacuum/analyze runs between variants after rolled-back writes. This procedure affects physical fixture pages and WAL and must never run against a browser baseline fixture or shared deployment.

## Run only in the scheduled measurement window

Do not run this while controlled browser cohorts or other heavy measurements are using the same host. From the repository root, with Docker and Git Bash available:

```powershell
pnpm performance:absence-indexes --out C:/evidence/1474-index-plans.json
```

The command requires a fresh absolute output path, creates services through the repository's existing label-owned PostgreSQL runner, verifies migrations and runs only this suite. Its diagnostics stay in `<output>.operator-private.log`; review that file locally after a failure. The public artifact contains numerical allowlisted plan fields, query hashes and static relation/index names. It excludes SQL, conditions, outputs, parameters and relation payloads. The suite refuses index measurement when other organizations exist and refuses the persistent application browser fixture database. Cleanup removes only its created candidate indexes and namespaced fixture rows; the repository runner owns its container cleanup.

For correctness without the index experiment:

```powershell
pnpm --filter webapp test:integration src/lib/analytics/absence-pattern-indexes.integration.test.ts
```

This still seeds the representative history and should be scheduled outside controlled host measurements. Without the evidence output variable no index-measurement test is registered; a correctness pass is not a performance or schema-decision pass. Missing database access fails the integration seam rather than skipping it.

## Decision and operational gates

Review every condition, not just the fastest example. A candidate needs repeatable read/buffer benefit in the relevant large-organization and selective-manager cases, preserved output/scope, and an acceptable measured increase in storage and write/WAL cost. Small sub-millisecond differences or merely observing an index in a plan do not justify a production index. Report older-history and annual regressions and physical-state/host limitations. Neither the fixture populations nor warm measurements establish production cardinality, cold-cache behavior or route-readiness improvements.

If no candidate has a worthwhile tradeoff, record the measured no-index decision and keep the schema unchanged. If a candidate is justified, add its schema declaration and repository-compliant migration only afterward. Verify journal timestamp ordering, plan rollout lock/extension requirements, and provide an operational rollback that removes only the new index. Both outcomes require actual measured evidence; preparation alone leaves #1474 open.

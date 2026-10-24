# Scoped absence index measurement

Issue [#1474](https://github.com/Umami-Creative-GmbH/z8/issues/1474), following the SQL tenant scope in [#1451](https://github.com/Umami-Creative-GmbH/z8/issues/1451).

The measured decision is to add the nonunique B-tree `absenceEntry_employeeId_endDate_startDate_idx` on `(employee_id, end_date, start_date)`. It materially reduces recent large-organization reads and selective-manager work while preserving the existing reader, legacy-null organization ownership, approval statuses and calendar-day semantics. Migration `0288_absence_employee_overlap` and the schema declare this index; no reader or authorization predicate changes.

The [numeric evidence](evidence/1474-absence-indexes.json) contains every condition/phase distribution, first/last absence-access plan nodes, existing-index inventory, planner settings, index storage/build cost and write/WAL distributions. The original complete numeric artifact has SHA-256 `b0f5fc018e22abd124cf8f7053ccda9aafd01414411bc82b850546130b2d657e`; its eager-relation plans were captured by harness `74bf2a57c` at worktree commit `3c60b3af1`. The raw private diagnostic log is excluded. This is disposable PostgreSQL evidence, not a browser latency, production cardinality or release-budget claim.

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

The recorded pre-index run used PostgreSQL 16.15, Node 26.9.0 and the original schema's ten absence indexes. Future measurement runs first validate the migrated index and public results, then remove only that named new index inside the exclusive disposable database to reproduce the predecessor comparison. Cleanup restores the real migration. Normal correctness runs keep the migrated index throughout. No existing unrelated index is removed.

A `daterange` expression index alone cannot support the unchanged two-inequality statement. The GiST bounds variant evaluates that index family without changing overlap semantics or assuming every legacy interval can be converted to a range. It requires `btree_gist` in the disposable database. No organization-leading or approved-only index is substituted: those would not match the current legacy ownership/status contract.

Every condition retains twenty actual query round trips and twenty `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` executions per variant. Query timings include actual related-row transfer; EXPLAIN round trips are labeled separately from database execution time. Evidence retains p50/p95/min/max, root buffer measurements and sanitized first/last plan trees, plus actual index size and build time. The existing configuration repeats after all candidates to expose warming, physical-state or host drift. PostgreSQL version/planner settings are recorded. CPU/database caches are not evicted; these are warm fixture measurements.

Write cost is measured with twenty 100-row insert batches and twenty 100-row end-date-update batches per variant. Each uses one acquired connection and a rolled-back transaction; the end-date update can expose lost HOT-update opportunities. Actual execution/WAL evidence and variance are retained. Missing numeric coverage is not replaced with zero. Vacuum/analyze runs between variants after rolled-back writes. This procedure affects physical fixture pages and WAL and must never run against a browser baseline fixture or shared deployment.

## Run only in the scheduled measurement window

Do not run this while controlled browser cohorts or other heavy measurements are using the same host. From the repository root, with Docker and Git Bash available:

```powershell
pnpm performance:absence-indexes --out C:/evidence/1474-index-plans.json
```

The command requires a fresh absolute output path, creates services through the repository's existing label-owned PostgreSQL runner, verifies migrations and runs only this suite. Its diagnostics stay in `<output>.operator-private.log`; review that file locally after a failure. The public artifact contains numerical allowlisted plan fields, query hashes and static relation/index names. It excludes SQL, predicate expressions, outputs, parameters and relation payloads. The suite refuses index measurement when other organizations exist and refuses the persistent application browser fixture database. Cleanup removes only its created candidate indexes and namespaced fixture rows, and restores the named migrated index if the experiment temporarily removed it; the repository runner owns its container cleanup.

For correctness without the index experiment:

```powershell
pnpm --filter webapp test:integration src/lib/analytics/absence-pattern-indexes.integration.test.ts
```

This still seeds the representative history and should be scheduled outside controlled host measurements. Without the evidence output variable no index-measurement test is registered; a correctness pass is not a performance or schema-decision pass. Missing database access fails the integration seam rather than skipping it.

## Measured decision

Each cell below is database execution **p50/p95 milliseconds**, twenty EXPLAIN executions. Actual eager-query round-trip distributions (twenty separate calls per cell), min/max and buffers are retained in the evidence. These numbers are rounded for reading; the artifact retains original precision.

| Condition | Existing | Start/end | End/start | GiST | Ending existing |
| --- | ---: | ---: | ---: | ---: | ---: |
| small/admin/month | 0.235/0.286 | 0.191/0.231 | 0.193/0.261 | 0.226/0.240 | 0.222/0.242 |
| small/manager/month | 0.112/0.136 | 0.104/0.129 | 0.106/0.122 | 0.111/0.128 | 0.103/0.128 |
| small/admin/quarter | 0.337/0.373 | 0.301/0.362 | 0.293/0.331 | 0.336/0.381 | 0.327/0.371 |
| small/manager/quarter | 0.140/0.173 | 0.128/0.148 | 0.125/0.133 | 0.137/0.140 | 0.135/0.165 |
| small/admin/year | 0.871/1.258 | 0.808/0.871 | 0.792/0.875 | 0.852/0.904 | 0.863/0.953 |
| small/manager/year | 0.258/0.315 | 0.250/0.293 | 0.254/0.313 | 0.264/0.310 | 0.255/0.296 |
| small/admin/older-month | 0.225/0.243 | 0.182/0.198 | 0.184/0.197 | 0.228/0.284 | 0.236/0.267 |
| small/manager/older-month | 0.112/0.130 | 0.101/0.116 | 0.101/0.126 | 0.110/0.115 | 0.108/0.144 |
| small/admin/older-quarter | 0.342/0.366 | 0.323/0.460 | 0.295/0.324 | 0.332/0.381 | 0.324/0.408 |
| small/manager/older-quarter | 0.137/0.156 | 0.133/0.166 | 0.130/0.172 | 0.141/0.186 | 0.131/0.167 |
| small/admin/older-year | 0.837/0.860 | 0.792/0.837 | 0.802/1.441 | 0.826/0.892 | 0.862/0.956 |
| small/manager/older-year | 0.267/0.291 | 0.252/0.285 | 0.252/0.308 | 0.264/0.306 | 0.253/0.294 |
| large/admin/month | 16.593/17.861 | 3.499/3.762 | 3.277/3.654 | 4.277/4.373 | 15.495/17.233 |
| large/manager/month | 0.501/0.594 | 0.252/0.293 | 0.241/0.283 | 0.285/0.331 | 0.526/0.602 |
| large/admin/quarter | 19.117/20.454 | 6.562/6.982 | 6.392/6.849 | 10.602/10.730 | 17.458/20.792 |
| large/manager/quarter | 0.667/0.705 | 0.391/0.427 | 0.391/0.427 | 0.433/0.485 | 0.641/0.682 |
| large/admin/year | 28.669/33.099 | 19.925/22.629 | 19.896/20.940 | 26.344/27.295 | 27.113/28.370 |
| large/manager/year | 1.341/1.455 | 1.048/1.153 | 1.022/1.077 | 1.087/1.162 | 1.328/1.416 |
| large/admin/older-month | 17.475/20.439 | 18.163/19.238 | 17.013/18.680 | 16.553/18.284 | 16.956/17.786 |
| large/manager/older-month | 0.508/0.580 | 0.250/0.345 | 0.262/0.321 | 0.296/0.375 | 0.521/0.568 |
| large/admin/older-quarter | 21.892/63.034 | 22.046/28.838 | 22.643/23.815 | 19.672/22.470 | 21.370/22.633 |
| large/manager/older-quarter | 0.676/1.307 | 0.414/0.445 | 0.388/0.458 | 0.439/0.849 | 0.679/0.749 |
| large/admin/older-year | 38.269/54.026 | 36.680/38.740 | 35.644/38.523 | 34.960/36.261 | 38.016/40.881 |
| large/manager/older-year | 1.351/1.522 | 1.071/1.160 | 1.050/1.145 | 1.105/1.148 | 1.380/1.526 |

Recent large-admin queries switch from scanning all tenants' histories to employee-keyed index probes (200 loops, returning 2/4/13 absences each). End-first p50 improves against **both** opening and ending baselines by 79–80% for month, 63–67% for quarter and 27–31% for year. Root shared-hit buffers fall from 9,541–9,710 to 4,221 for month, 12,741–12,910 to 7,821 for quarter and 27,141–27,310 to 24,021 for year. Actual eager-query p95 also improves: 22.20/19.23 → 7.11 ms for month, 24.28/22.37 → 14.44 ms for quarter and 45.92/40.39 → 34.14 ms for year (opening/ending → candidate).

Selective large-manager root shared-hit buffers fall from 1,412 to 223 for recent month and 2,292 to 1,213 for year, and improve similarly on older histories. Small-organization differences are sub-millisecond and do not independently justify the index. Full-admin older month/quarter retain the existing start-date plan, and older year retains a sequential plan; no substantial gain is claimed there. The older-quarter candidate p50 is 22.64 ms versus 21.89/21.37 ms baselines (3–6% slower), with overlapping sample ranges. Small-admin older-year candidate p95 is 1.441 ms versus 0.860/0.956 ms; this tail regression is retained, not averaged away.

End-first is a modest preference over start-first: similar strong recent gains, fewer buffers and slightly lower execution in the relevant large cases, with equal storage. Do not interpret the tiny difference between those candidates as a statistically proven general advantage. GiST requires an extension, uses 2.68 times the B-tree storage and has weaker recent large-admin performance; it is rejected. A second composite index is not added.

### Storage, writes and drift

All write cells below are **p50/p95** for a 100-row transaction; execution is milliseconds and WAL is actual bytes. Each has twenty rolled-back samples. No commit/replication latency is measured.

| Variant | Added bytes / build ms | Insert execution | Insert WAL | End-date update execution | Update WAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing | 0 / n/a | 1.984/2.177 | 95,846/104,080 | 1.823/2.070 | 105,997/106,473 |
| Start/end B-tree | 10,878,976 / 98.81 | 2.155/2.364 | 106,622/122,181 | 2.037/2.427 | 114,937/119,323 |
| End/start B-tree | 10,878,976 / 113.84 | 1.970/2.186 | 99,850/112,864 | 2.004/2.255 | 114,575/118,908 |
| GiST | 29,138,944 / 745.66 | 2.331/2.576 | 115,662/124,440 | 2.264/2.626 | 121,029.5/139,918 |
| Ending existing | 0 / n/a | 2.056/2.250 | 90,857.5/98,815 | 2.027/2.494 | 106,018/107,968 |

The selected index adds 10.38 MiB for 267,168 rows. Its insert WAL p50 is 4.2% above opening and 9.9% above ending baseline; update WAL is 8.1% above both. Update execution p50 is 10.0% above opening but 1.1% below ending baseline, so a causal CPU-cost percentage is not established. Additional WAL/storage is accepted for the large recent-read and manager benefits; the experiment does not establish production write volume or a universal HOT-update penalty.

The ending baseline exposes real drift: recent large-admin execution p50 is 5–9% lower than opening, whereas the selected index improves 27–80% against both. Older-quarter baseline p95 drops from 63.03 to 22.63 ms without a new index; that outlier reduction is not attributed to any candidate. Phases were ordered rather than randomized, physical pages change after rolled-back writes and vacuum, and only one warm local host/database run was measured. Min/max and both endpoints remain in the evidence. No cold-cache, production topology, browser readiness or release acceptance follows from these results.

## Rollout and rollback

Migration `0288` has journal `when=1809619200000`, greater than every preceding entry. The unreleased index migration was renumbered when concurrent employee-deactivation work reached `dev`; that work's migrations `0284`–`0287` remain unchanged. The SQL and index name are unchanged. It uses ordinary `CREATE INDEX IF NOT EXISTS` because the repository's Drizzle migration runner executes a transaction. This takes a table lock that blocks writes during construction; the 114 ms fixture build does not predict production lock duration. On a busy deployment, prebuild the same index outside a transaction before normal migrations, using an operator connection and a bounded lock wait:

```sql
SET lock_timeout = '5s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS "absenceEntry_employeeId_endDate_startDate_idx"
  ON public.absence_entry USING btree (employee_id, end_date, start_date);
```

Do not wrap the concurrent command in `BEGIN`, do not run it through Drizzle, and do not mark the migration ledger manually. Inspect `pg_index` for `indisvalid=true`, `indisready=true`, `indisunique=false`, `indpred IS NULL`, B-tree access and the exact ordered keys `(employee_id,end_date,start_date)` before normal deployment. A same-name invalid/wrong-definition index is not repaired by `IF NOT EXISTS`: stop and resolve it first. A failed concurrent build can leave an invalid index; after verifying its identity and coordinating other builders, drop only that index concurrently and retry. Normal migrations then skip the correctly prebuilt index and record the journal through the standard migration runner. Keep existing indexes and all reader predicates.

For rollback, remove only the new index outside a transaction:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public."absenceEntry_employeeId_endDate_startDate_idx";
```

Reader correctness and tenant scoping remain intact without it; performance returns to the predecessor plans. Roll back the schema declaration in a follow-up migration/commit if permanently abandoning the index. Do not delete or rewrite applied journal entries. Production prebuild, catalog verification, rollout duration and rollback execution remain operator gates; none was performed against a real deployment.

## Validation

Before base integration, the repository's actual disposable PostgreSQL runner passed migration incident recovery, retry and the fresh full migration chain. The catalog assertion failed before the index was implemented, then passed with valid/ready/nonunique/unfiltered exact ordered keys after retrying the same SQL now named `0288` inside a transaction. Both absence suites passed (five tests), covering all 24 representative public-reader conditions and the existing authenticated manager-assignment reduction/employee-denial journey. The latter fixture seeds approved membership required by the current public analytics admission; permissions are not mocked away. The merged migration chain still requires fresh-database validation.

Existing private fixtures that applied the index under its pre-integration journal timestamp must not run the merged pending-migration chain: their ledger could skip the peer's earlier migration. Recreate final-head test and performance clones from the original dump through `0283`, then apply the complete merged chain. Never migrate the original before database. Historical measured hashes and plans remain unchanged.

Focused TypeScript checking of the changed schema and both integration suites, route type generation, the CLI safety test, Biome checks and journal ordering checks pass. The broad app TypeScript check remains blocked by the worktree's missing generated `licenses.json` and an inherited heterogeneous-loader type error in `deferred-dashboard-widget.tsx`; these are outside the index change. No app build or browser release-budget acceptance is claimed. Full integrated checks remain the controller's gate.

A separate postmigration operator replay also passes all 24 conditions/five phases, including predecessor-index exclusion and cleanup restoration. Its results do not replace the original decision artifact or remove the stated host/drift limitations.

# Scoped work-hours range evidence

Issue [#1464](https://github.com/Umami-Creative-GmbH/z8/issues/1464), part of [#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The production work-hours action still authenticates each request and derives the active organization and employee role from current server data. It now passes an explicit administrator or manager scope to the reader. The roster SQL applies the organization, optional employee filter and current manager assignments before retrieving employee presentation or calculation inputs. A manager asking for an unassigned employee gets no employee data.

The view resolves the roster once, then `analytics/range-evidence.ts` loads tracking, raw chart work, protected completed work and daily requirements in serial batches of at most 64 employees. The batch requirement reader supplies the existing requirement algorithm with confirmed terms, policy schedules, published shifts, approved absences, employment coverage and assigned holidays. The legacy expected-hours calculation also reuses one organization-scoped holiday-exclusion read instead of querying each weekday. All database reads use the caller's `DatabaseService` client, including transactions.

The internal range interface takes already authorized minimal employee rows, the organization and boundary instants. It returns tracking contexts, protected daily minutes, daily requirements and raw distribution periods. Overtime and team-performance migrations can consume this evidence without introducing a second policy or holiday interpretation. No shared cache, schema, index, balance projection, captured-evidence rewrite or write-path change is introduced.

## Structural budgets and preserved meanings

The PostgreSQL regressions were observed failing before their corresponding implementation slices: one tracking batch for the six-person fixture, at most two work-period queries in that batch, one roster read, at most 26 total queries for month or full-year conditions, and at most 64 scoped employee IDs admitted by a work query. Increasing the requested range adds no per-day, per-week or per-employee tracking query.

The implementation retains the distinction between chart minutes clipped to the report calendar and protected stored minutes allocated to employee-local tracking days. For example, the explicit 2.5-minute travel/rounding fixture contributes two chart minutes and three protected stored minutes; the employee's local midnight remains independent of the report's UTC calendar. Live and deleted work, tracking clipping, reconciliation failures, confirmed employment terms, hourly shift ownership, daily absence release and holiday rules retain their existing readers and calculations.

The ordinary fixture has six employees and four completed eight-hour periods on March 2, 2026. Its March result is 32 work hours and 1,024 undertime hours, with 48 required hours on the populated chart date. A confirmed 40-to-20-hour weekly change, half-day sickness and assigned holiday yields 116 required hours in its separate fixture. The hourly case counts only the published in-range shift. Transaction preview changes to tracking, confirmed terms and absence evidence are visible through the same reader and disappear after rollback.

## Measured local conditions

Measurements were recorded on October 24, 2026, using Windows, an AMD Ryzen 9 9950X3D2 with 32 logical processors, Node 26.9.0, pnpm 12.14.0, Vitest 5.0.3 and disposable PostgreSQL 16.15 through the repository's integration adapter. Synthetic fixtures contain no production people or Phase secrets. Other agents were active on the host; CPU/database caches were not cleared. These are warm public-reader measurements, not controlled browser visits or isolated PostgreSQL execution time.

The before reader dependency slice is integration commit `67d1f15db`, which already contains the daily allocation improvement from #1463. The same fixture, public reader invocation and installed dependencies are used afterward. Twenty sequential warm samples are taken per condition after the first read. p50 is the mean of the middle two sorted samples; p95 is nearest rank. Timings include reader orchestration, transfer and calculation, with module startup excluded by the warmup.

| Range | Before queries | After queries | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: | --- | --- |
| March 1–31, 2026 | 132 | 15 | 70.35 / 82.64 ms | 20.07 / 25.06 ms |
| January 1–March 31, 2026 | 216 | 15 | 140.62 / 149.94 ms | 25.07 / 30.61 ms |
| January 1–December 31, 2026 | 610 | 15 | 497.04 / 518.33 ms | 46.56 / 53.91 ms |

The larger fixture crosses the batch boundary with 74 employees: 28 queries, one roster read, two tracking reads and four work-period reads. No work query admits more than 64 employees. A separate run binds that reader to a one-connection pool while an interactive `SELECT 1` probe shares it; it completes with one connection and at most one queued read. The observed larger-reader elapsed time was about 94 ms in that run. This is a database-capacity probe, not a clock-command or browser-readiness measurement. Serial I/O keeps one analytics request from creating an employee-sized connection queue; actual deployment pool/worker capacity and concurrent route budgets remain release checks.

## Reproduce and validation

```sh
Z8_WORK_HOURS_QUERY_EVIDENCE=1 pnpm --filter webapp test:integration src/lib/analytics/work-hours-range.integration.test.ts
Z8_WORK_HOURS_LATENCY_EVIDENCE=1 pnpm --filter webapp test:integration src/lib/analytics/work-hours-range.integration.test.ts -t 'loads tracking once'
```

The disposable runner performs the repository's migration verification and owns its database cleanup. SQL/parameters stay in the test process; evidence output contains counts and numerical timing only. The suite also replays captured production queries to verify manager and unrelated-tenant row retrieval. Missing disposable database access fails the suite rather than skipping it.

Final focused validation passes 75 PostgreSQL cases across six suites, 63 unit cases across nine suites and the complete configured webapp type check. The two new reader modules and the new integration test pass Biome. Changed production files retain existing legacy formatting/import and `any`/non-null assertion diagnostics; no new lint warning is introduced. Two cold source scanners exceeded the default five-second unit timeout during the first concurrent run; the same assertions pass with one worker and a 30-second scan allowance. The obsolete source-spelling assertion for moved SQL is replaced by a real PostgreSQL half-open boundary regression.

There are no React component or presentation changes. React/Next performance review retains fresh action authorization, server-only calculation inputs and bounded database I/O; component composition and visual/accessibility changes are not applicable to this slice.

## Unfulfilled acceptance gates

This reader evidence does not provide production-mode browser filtering/chart/error verification, cold navigation readiness, initial JavaScript/RSC bytes, browser-native LCP/INP, deployment cache/pool topology or concurrent clock readiness. The integrated CI-mode build and authenticated benchmark remain the parent implementation's release gates. Keep #1464 open until those checks pass; these local measurements make no production latency claim.

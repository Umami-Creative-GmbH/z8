# Daily tracked-work allocation (#1463)

The production `readTrackedDailyWorkMinutes` reader now visits each completed work period's intersected employee-local days. It initializes the requested dates and their windows once, then uses the existing protected-minute allocator for each intersection. It retains the public reader contract and the completed-work SQL predicates.

For `D` output days, `P` retrieved periods and `I` period/day intersections, allocation work is now `O(D + P + I)` instead of `O(D × P)`. The output and window index use `O(D)` space; periods were already loaded as one range. No schema, balance projection, write guard, captured evidence or closed-month rule changes.

## Fixture and budget

The regression uses the existing disposable PostgreSQL integration adapter and lifecycle fixture. It seeds 3,653 UTC days from 2020-01-01 through 2029-12-31 with one completed 480-minute period per day, each with canonical record agreement. It calls the actual production daily reader and expects every day to contain exactly 480 minutes.

Before changing the reader, the test declared a two-second process-CPU budget for this workload. The original reader failed that assertion while returning the correct totals. The new reader passes it. The original day/period scan considered 13,344,409 pairs in this fixture; there are only 3,653 actual intersections. The test asserts the public result and CPU budget, without counting private helper calls.

Recorded on Windows x64, Node v26.9.0, PostgreSQL 16 in a disposable local Docker container, AMD Ryzen 9 9950X3D2, 32 logical CPUs. The pre-change source was the tracked-work reader at `d2186a19d` (unchanged from `39a08d0bb`). Elapsed measurements bracket the public async reader, including its database reads; process CPU uses `process.cpuUsage` over the same interval. Fixture seeding and module import are outside that interval.

| Measurement | Elapsed | Process CPU | Result |
| --- | ---: | ---: | --- |
| Original reader, red run | 10,961 ms | 10,970 ms | Correct totals; fails declared budget |
| Bucketed reader, first expanded regression run | 279 ms | 172 ms | Correct totals; passes budget |
| Bucketed reader, run after existing caller suite | 81 ms | 110 ms | Correct totals; passes budget |

These are scoped development-fixture smoke observations, not production latency or browser readiness. They are individual samples, not p50/p95 distributions. Host concurrency, JIT, database/page caches and allocation/GC can affect them; the second implementation observation follows other callers in the same Vitest worker. A two-second guard leaves substantial margin over both implementation observations, but hardware still matters. No route-readiness percentage or production gain is inferred from this table.

## Correctness evidence

The public-reader PostgreSQL cases include:

- Stored three-minute credit over a 3m20s interval crossing a Berlin year boundary: two minutes on December 31, one on January 1. Different Berlin/New York endpoint captures remain intact. An employee tracking start of January 1 retains only the latter minute.
- Berlin's spring day: 1,380 minutes; autumn day: 1,500 minutes. A positive interval ending at local midnight adds no work to the following day.
- One period across three local days and the spring DST gap: 60, 1,380 and 120 minutes.
- Zero-length stored work retains its containing-day treatment. The existing SQL half-open range predicate still excludes a zero-length interval exactly at the overall range start; this optimization does not redefine that boundary.
- Reversed historical endpoints still raise the existing reconciliation error, including when both endpoints lie within the range. Such malformed history uses the sanctioned historical fixture writer, since canonical records correctly reject it.
- A boundary-crossing period with an unlocated historical break still fails reconciliation instead of inventing a daily allocation.
- Live/deleted work stays excluded, another employee's periods do not contribute, and empty local days remain present with zero minutes.

The employee timezone remains explicit. Captured endpoint offsets are not replaced with a viewer timezone, and no interior timezone transition is invented. Display weeks, Monday compliance weeks, report calendars and daily work remain separate meanings.

## Reproduction and checks

From `apps/webapp`, with Docker available:

```bash
pnpm test:integration src/lib/work-balance/tracked-work.integration.test.ts src/lib/work-balance/tracking-start.integration.test.ts --reporter verbose --disableConsoleIntercept
pnpm exec vitest run --project unit src/lib/payroll-allocation/protected-minutes.test.ts src/lib/work-balance/period-aggregation.test.ts src/lib/work-balance/service.test.ts
pnpm typecheck
pnpm exec biome check src/lib/work-balance/tracked-work.ts src/lib/work-balance/tracked-work.integration.test.ts
```

Result: 23 PostgreSQL cases (nine new daily-reader cases and 14 existing tracking/balance/report/analytics caller cases), 61 unit cases, the full webapp type check and focused Biome checks pass. React performance/composition and Web Interface Guidelines were checked for applicability: this slice changes no React component, browser interaction or UI markup.

The parent #1448 integration owns the CI-mode production build and authenticated production-mode browser benchmark. Their controlled cold/warm/concurrent readiness, query/resource metrics and deployed behavior remain acceptance gates; these reader checks do not substitute for them.

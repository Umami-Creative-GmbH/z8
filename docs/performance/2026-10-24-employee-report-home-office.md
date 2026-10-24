# Employee-report home-office work reuse

Ticket: [#1452](https://github.com/Umami-Creative-GmbH/z8/issues/1452), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The employee report now uses its existing full-range completed-work read for
home-office totals. Category and approved-absence reads remain scoped to the
employee and organization. The standalone home-office reader loads completed work
once for the range. No records, offsets, employment terms or schema are changed.

## Reader query evidence

The existing `report-generator.integration.test.ts` calls
`generateEmployeeReport` against the repository's disposable PostgreSQL 16
adapter. Its query logger observes the production work-period query family;
schedule-based expected hours retain the suite's existing stub. Fixtures use one
organization, employee and two-hour completed period, with an approved home-office
absence extended from one to 31 calendar dates in March 2026, UTC.

The regression budget was written and observed failing before implementation:
one report completed-work query for either date count. A separate tracking-window
read can still occur for activated tracking; this change does not alter it.

| Home-office dates | Before work-period reads | After work-period reads | Before reader elapsed | After reader elapsed |
| --- | --- | --- | --- | --- |
| 1 | 2 | 1 | 14.58 ms | 16.90 ms |
| 31 | 32 | 1 | 25.05 ms | 16.68 ms |

These elapsed values are single smoke observations from separate test runs on the
same Windows/Node 26.9.0 host and disposable local PostgreSQL runner. They include
the entire reader and are neither p50/p95 measurements nor evidence of a
production latency improvement. The durable result is the query-growth contract.
Rows returned, query durations, pool wait, browser readiness, concurrent load and
production-mode journey timings were not captured by this suite. The controlled
benchmark and its twenty-sample comparison conditions remain gates under #1450.

## Preserved meanings and checks

- Completed non-deleted work counts; live and deleted work contributes no work,
  home-office hours or earnings.
- Calendar reports retain elapsed minutes clipped to each report-local day.
  Legacy calls without a calendar range retain stored-duration home-office
  totals, using the report's explicit UTC range. Work hours and hourly earnings
  retain their existing stored-duration allocation; this optimization does not
  reconcile these separate calculation rules.
- Expected cases cover Berlin midnight and confirmed wage changes, the 23-hour
  spring DST day, a period crossing a local month boundary, travel with different
  opening/closing offsets, stored rounded durations and work before tracking
  begins. Existing custom-field integration cases retain role visibility and
  historical values.

Run from the repository root:

```sh
pnpm --filter webapp test:integration src/lib/reports/report-generator.integration.test.ts src/lib/reports/report-custom-fields.integration.test.ts --reporter=verbose --silent=false
pnpm --filter webapp exec vitest run --project unit src/lib/reports/report-generator.test.ts src/lib/reports/hourly-earnings.test.ts src/lib/reports/report-date-range.test.ts
```

The final PostgreSQL suites passed 14 cases, the focused unit suites passed 21
cases, and `pnpm --filter webapp typecheck` passed (with `SKIP_ENV_VALIDATION=1`
and existing generated license metadata). This change contains no UI or React
component edits. The integrated CI-mode build is a separate release check;
these checks do not substitute for the unfulfilled production-mode performance
gates.

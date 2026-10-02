# Navigation baseline, October 2, 2026

The controlled performance baseline is pending. Repository policy makes Phase configuration unavailable to agents; no authenticated disposable production-mode fixture environment was provided. No secrets were acquired. The implementation can be checked with unit tests and disposable PostgreSQL fixtures, but measured navigation gains and real request-cache isolation remain unverified.

The approved design records exploratory read-only production observations against build `743f288`: three repeat navigations per route using the existing authenticated browser and narrow viewport. Median readiness was dashboard 348 ms, time tracking timeline 2929 ms, team 968 ms, reports 454 ms, and calendar 465 ms. Different readiness markers and browser automation overhead make these observations unsuitable as comparative latency targets or regression evidence.

Before shipping, the operator should collect at least 20 first visits and 20 repeat Link navigations per compared condition with fixed fixture account, organization, date, viewport and readiness markers. Record raw anonymized samples, median and p95 for header, clock, timeline, summary and history; migrated query counts/durations; initially loaded JavaScript; and serialized translation/RSC bytes. Compare each stage with its immediate predecessor. Use disposable accounts for mutations, organization switches and exports.

## Execution baseline

- Base for product changes: `0325fc3af08da20c1d7572b9ae029b6ce0f048ff`.
- Cache Components and Partial Prefetching were already enabled.
- Dependencies installed from the frozen lockfile with pnpm; no dependency changes.
- Initial selected unit baseline: 5 files, 10 passing tests; inherited Vitest/Vite configuration warning.
- This selected baseline does not establish that the full repository unit suite passes. Task 1's full run had 136 failures, 12,622 passes and 33 skips; the failures have not been reproduced against the predecessor and cannot be called pre-existing.
- The Next development-loop preflight lacks `agent-browser`; its runtime gate remains pending.
- The three required Vercel quality skills are unavailable in the installed skill catalog.

The stage evidence files distinguish structural checks from browser and production-mode acceptance gates. Production remains limited to the user's authorized read-only inspection.

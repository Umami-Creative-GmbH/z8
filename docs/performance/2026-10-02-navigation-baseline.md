# Navigation baseline, October 2, 2026

The controlled performance baseline is pending. Repository policy makes Phase configuration unavailable to agents; no authenticated disposable production-mode fixture environment was provided. No secrets were acquired. The implementation can be checked with unit tests and disposable PostgreSQL fixtures, but measured navigation gains and real request-cache isolation remain unverified.

The approved design records exploratory read-only production observations against build `743f288`: three repeat navigations per route using the existing authenticated browser and narrow viewport. Median readiness was dashboard 348 ms, time tracking timeline 2929 ms, team 968 ms, reports 454 ms, and calendar 465 ms. Different readiness markers and browser automation overhead make these observations unsuitable as comparative latency targets or regression evidence.

Before shipping, the operator should collect at least 20 first visits and 20 repeat Link navigations per compared condition with fixed fixture account, organization, date, viewport and readiness markers. Record raw anonymized samples, median and p95 for header, clock, timeline, summary and history; migrated query counts/durations; initially loaded JavaScript; and serialized translation/RSC bytes. Compare each stage with its immediate predecessor. Use disposable accounts for mutations, organization switches and exports.

## Execution baseline

- Base for product changes: `0325fc3af08da20c1d7572b9ae029b6ce0f048ff`.
- Cache Components and Partial Prefetching were already enabled.
- Dependencies installed from the frozen lockfile with pnpm; no dependency changes.
- Initial selected unit baseline: 5 files, 10 passing tests; inherited Vitest/Vite configuration warning.
- The original full unit run on clean `0325fc3af08da20c1d7572b9ae029b6ce0f048ff`, before independent Excel edits, recorded **12,606 passed, 135 failed, 33 skipped**. Artifacts: `.superpowers/sdd/2026-10-02-navigation-performance/pre-change-unit-results.json` and `pre-change-unit-run.log`.
- The streaming head `12e1e9ff3` had the same 135 failing names and 80 additional passing tests, established by `pre-change-versus-streaming.json` in that directory. Matching names establish observed overlap, not identical causes or a green suite. These unit counts do not establish a navigation latency gain or replace the pending controlled authenticated baseline.
- The Next development-loop preflight lacks `agent-browser`; its runtime gate remains pending.
- The three required Vercel quality skills are unavailable in the installed skill catalog.

The stage evidence files distinguish structural checks from browser and production-mode acceptance gates. Production remains limited to the user's authorized read-only inspection.

## Final review repair evidence

Repair predecessor: `f091b95097926ec670c590e85e7268b11a67eef1`. The time-tracking render resolver now uses the existing expiry-aware account-ban policy, correcting rejection of an expired temporary ban while preserving active/permanent denial and organization/SSO checks. A TDD regression also exercises the actual page composition to establish that the expired case avoids session-expired handling.

The warmed hydration fixture was replaced with a dedicated Vitest-isolated file. Expected markup uses an independent Tolgee SDK/provider context; complete records never enter the browser registry. The cold client receives shell and Reports slices, starts without the Reports title, renders German primary/alias/shared labels on its first hydration render with zero recoverable errors, keeps an unrelated catalog absent, and requests no client catalog acquisition. Existing independent node SSR checks across all ten locales and lifecycle/locale tests remain. This local jsdom result does not complete actual Next/browser acceptance.

| Final repair check | Observed result |
| --- | --- |
| Covering unit checks | 31 files / 343 passed, including auth/context/regions and provider/SSR/hydration/locale/loader/store coverage |
| Typecheck | All configured TypeScript projects pass |
| Direct app `CI=true pnpm build` | Pass; 1,438 pages generated; existing build-only auth fallback remains |
| Changed-file Biome | Four source/test files, no issues |
| React Doctor against repair predecessor | Four staged files, no issues; numerical score API unavailable |
| One full final unit run | 12,844 passed, 134 failed, 33 skipped; 29 failed files, 1,121 passed, four skipped |
| Original baseline comparison | 134 shared failing names, one original-only analyzer timeout, zero head-only names; no newly failing case to rerun |

The full suite remains red. Matching failure names establish observed overlap, not identical causes. The existing broad Biome result remains red at 3,705 errors / 814 warnings / one info; its +1 error versus the earlier 3,704 count remains unattributed. This repair did not repeat or fix the broad gate. Prior Doctor mixed-export/static-iteration warnings and the retained identity-memo history remain qualified nonblocking diagnostics; a clean four-file repair scan does not erase them. Detailed commands and inventories are retained in `.superpowers/sdd/2026-10-02-navigation-performance/final-fix-report.md`, `final-fix-unit-results.json` and `final-fix-unit-comparison.json`.

Pending operator gates remain actual request-cache/query counts and concurrent request/user/organization isolation; preference mutation freshness; authenticated clock streaming under delayed/failed secondary reads and clock/date/back-forward behavior; useful partial prefetch, hydration/layout shifts and translation navigation/language/shared-dialog/chunk-retry behavior; fixture Excel download/network retry; actual RSC/catalog/chunk transfer bytes; and controlled 20-sample first/repeat median/p95 comparisons. Phase fixture configuration, `agent-browser` and the three required Vercel skills remain unavailable. No secrets, substitute runtime credentials or production mutation were used. Unit counts and local catalog assertions establish no measured navigation gain.

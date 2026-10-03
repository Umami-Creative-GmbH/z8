# Deployed navigation verification, October 3, 2026

The available read-only production checks passed. All five routes resolved their selected readiness markers in 20 repeat visits each. Time tracking clock controls were observed at a median of 881.5 ms and p95 of 1650 ms. This is after-deployment evidence, not a controlled before/after speedup or a completed acceptance gate for #557.

## Deployment and method

Production `https://ui.z8-time.app` reported build `5b70e27` both before and after verification. GitHub resolves this to release commit `5b70e27ccfd7d85f98a8f3ae880b481cef01f64b`, merge PR #553, with `dev` parent `8e8c5aa660977cffe36cdafd581eac16dfe3d1ed`. Its source tree and the local `dev` tree both equal `57ea042d5ff4c97ad758ede6f85dba8789a8d9e2`, including the merged performance and verification-portability changes.

The existing authenticated production browser was used read-only, with one account/organization, German route locale, October 3 selected, and a 613 by 1244 viewport. Browser and application caches were retained. No employee details, credentials, session data or time-entry values are saved in the artifacts. No clock action, entry submission, preference write, organization switch, report generation or employee export was performed.

The corrected cohort contains 100 Link visits, cycling Team, Reports, Calendar, Dashboard and Time tracking 20 times. Timing starts after opening the mobile sidebar, immediately before clicking the visible Link. Full accessibility snapshots are polled until the destination header and selected region markers are observed, with a 20-second observation deadline. Measurements include automation calls, sidebar dismissal and snapshot overhead; they are not browser-native paint timings. Readiness indicates the stated marker, not every part of a page.

An earlier protocol accidentally parsed differential accessibility snapshots as complete state. All its 100 repeat samples, one direct sample, timings and two Dashboard observation deadlines were discarded. Those deadlines were measurement errors, not confirmed application failures. The replacement run uses `disableDiffing: true` throughout and had zero exceeded readiness deadlines.

Raw corrected samples and marker definitions are in [2026-10-03-deployed-navigation.json](2026-10-03-deployed-navigation.json). Median averages the two central samples; p95 uses nearest rank, the nineteenth sorted value for n=20.

## Corrected repeat observations

All values are milliseconds; every row has 20 samples and no censored values.

| Destination / marker | Header median | Header p95 | Region median | Region p95 | Region max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard / Manager Heute | 353 | 394 | 509 | 1299 | 1575 |
| Time tracking / enabled clock controls | 352.5 | 366 | 881.5 | 1650 | 2244 |
| Time tracking / timeline heading | 352.5 | 366 | 932.5 | 1650 | 2244 |
| Time tracking / weekly summary label | 352.5 | 366 | 932.5 | 1650 | 2244 |
| Time tracking / history title | 352.5 | 366 | 932.5 | 1650 | 2244 |
| Team / Ihr Team heading | 350.5 | 375 | 1102.5 | 3145 | 5113 |
| Reports / empty report state | 342.5 | 354 | 765 | 2212 | 2492 |
| Calendar / selected Day control | 329.5 | 347 | 496.5 | 1930 | 4695 |

Some time tracking visits exposed clock controls before timeline/history; others completed together or showed timeline first. This observes independent regions resolving in production but does not replace deterministic held/failed-secondary-read testing. The slowest Team and Calendar samples warrant tracing if reproducible; these automation-assisted observations alone identify no database bottleneck or regression.

Twenty direct time tracking document loads/reloads also completed: median 2125 ms, p95 4289 ms, maximum 7140 ms. The navigation helper waits before the first useful observation, so header and all four region times coincided. These values measure helper completion in a warm browser; they neither measure cold first visits nor establish exact streaming order.

The old production baseline has only three exploratory repeat samples per route and different readiness markers. Calendar now measures controls rather than an event. Account data/date and automation methods are not controlled across the old and new cohorts. A percentage speedup or regression claim would be unsupported.

## Functional observations

- Dashboard, time tracking, Team, Reports and Calendar loaded without visible alerts during the corrected cohort. No console warning/error entries were captured by the browser tool at the final check.
- Previous-day and Today links changed the timeline caption between October 2 and October 3. Browser back/forward restored those dates. Clock controls remained available; no clock mutation was attempted.
- The lazy manual-entry dialog opened with German title, date, clock-in/out, reason, cancel and create labels, then was cancelled without submission. `Open time picker` remained English. Time tracking title/table labels also include English fallbacks; two relevant German catalog keys are absent in both current source and the old release, which does not establish a complete old UI baseline or a new translation regression. No raw translation-key leakage was observed in the inspected surfaces.
- Calendar Day controls and the public German Unity Day holiday event rendered. No calendar events were changed. Reports showed its normal empty state; no report or export was generated.
- Time tracking was checked at desktop 1280 by 900 and mobile 390 by 844. Document width equalled viewport width at both sizes, clock controls remained enabled, and timeline/history remained present on mobile. The original 613 by 1244 viewport was restored. This is a structural check, not a CLS measurement or exhaustive visual audit.

## Remaining acceptance work

#557 remains open. The implementation issues stay closed; this run confirms a limited deployed subset of their parent acceptance criteria.

| Gate | Status / missing evidence |
| --- | --- |
| Deployed route readiness, date/back-forward, sampled German lazy dialog, narrow/desktop structure | Observed as described above |
| Actual RSC session/membership/employee/settings query counts and durations | Requires rendering/database spans in an operator-configured fixture environment |
| Concurrent request/user/organization isolation, revoked access and organization switching | Requires disposable accounts and two organizations; not exercised against live tenant data |
| Preference-write and clock-mutation freshness | Requires disposable fixture account; read-only date navigation is not mutation evidence |
| Clock streaming under deliberately delayed/failed secondary data and unknown active-period/auth state | Requires controlled production-mode fixture rig; natural region ordering is insufficient |
| Useful partial prefetch, hydration/CLS, full route/language/dialog coverage and delayed catalog/chunk retry | Not established by marker observations; browser timing/network hooks and controlled faults required |
| Excel fixture worksheet/filename download and chunk import/generation failure/retry | Requires disposable report fixture; no live employee export used |
| Actual initial JS, serialized catalog/RSC transfer bytes | Browser surface exposes no Performance API/resource bytes; asset names alone are insufficient |
| Controlled predecessor/head comparisons, 20 fresh-context first visits and 20 repeat visits per condition | Old controlled baseline absent; current warm after-only cohort cannot satisfy this |

No Phase configuration or substitute secrets were acquired. The repository's three required Vercel quality skills remain unavailable, as documented in the implementation evidence. Existing test/build evidence is retained in the earlier reports; no application code changed and this documentation-only run does not reassert those historical checks as freshly executed.

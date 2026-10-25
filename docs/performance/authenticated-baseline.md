# Authenticated performance baseline

The runner and disposable local services support spec #1448 / ticket #1450. A successful setup or unit test is not a completed performance baseline. The ticket stays open until the production browser journeys, recorded budgets and correlated backend evidence pass together.

The active [clean-evidence condition](1450-clean-original-observation.md) supersedes historical failed-before eligibility below. Both original and optimized runs must be successful and error free; retained failures are diagnostics only. Original observations use 90 seconds and optimized observations 30 seconds, with shared pool 10/acquisition timeout 60 seconds. New exact bindings and complete actual runs remain required.

Run from the repository root with pnpm. Choose an absolute **private directory outside the repository** for generated service credentials, synthetic account credentials, browser cookies and the runtime log. Publish only the reviewed comparison plan and numerical `baseline.json` artifact. Do not publish `*-private.json`, `services.json` or `runtime.log`.

```powershell
pnpm performance:fixture prepare C:/private/z8-performance
pnpm performance:fixture initialize-projections C:/private/z8-performance --as-of 2026-10-24T12:00:00Z
pnpm performance:collector --port 0 --control C:/private/z8-performance/collector-control.json --out C:/evidence/backend-metrics.json
# Keep the collector running. In another terminal:
pnpm performance:fixture start C:/private/z8-performance --collector C:/private/z8-performance/collector-control.json --build
# Keep the start command running. In another terminal:
pnpm performance:fixture plan C:/private/z8-performance C:/evidence/plan.json --source-build <application-source-commit> --binary-build <deployed-build-hash>
```

`prepare` owns PostgreSQL 16, Valkey and RustFS Docker containers, binds only loopback ports, verifies the existing integration migration recovery/fresh chain, and seeds through the existing integration database gate. The existing canonical-work fixture helper supplies matching work records. No production data, Phase secrets or normal development service configuration is copied. The build/server receive generated local configuration and ordinary OS/tool settings. Private S3 uses the local fixture storage too; billing, product analytics, external tracing, email, cron and secret-store credentials are disabled. These choices are part of the comparison conditions, not evidence about deployed billing or cache behavior.

The synthetic fixture has two organizations (8 and 200 employees), two teams per organization, employee/manager/organization-admin/restricted-custom-role actors, manager assignments to one team, confirmed employment terms and a weekday policy. Each employee has 261 completed 8-hour periods in 2025, including Berlin's actual DST offsets. The small organization has 2,088 completed periods and 416 home-office dates; the large organization has 52,200 and 10,400. Seeding verifies employee, home-office and canonical-record agreement counts in PostgreSQL. Month, quarter and year ranges use March 2025, January–March 2025 and calendar 2025. The platform setup administrator is separate from the benchmark actors.

Fixture version 2 explicitly activates tracking from January 1, 2025 and verifies all 208 employees through the production tracking-context reader. Version 1 omitted activation and therefore did not exercise the new required-time calculations; do not compare those different workload configurations as a performance improvement. Existing local fixture directories can run `pnpm performance:fixture upgrade <private-directory>` before any controlled samples. This upgrades only the guarded synthetic fixture and writes runtime defaults; it does not restart a live server.

Before collecting samples, initialize missing work-balance projections through `initialize-projections --as-of <explicit-instant>`. The command verifies the existing disposable database gate, exact application/database connection agreement, synthetic organization identities and both 8/200 rosters. It calls the existing `refreshEmployeeWorkBalanceFromPeriods({ forceFullRebuild: true, now })` API serially only for missing employee projections, using the stated instant. Existing projections are preserved; the command never deletes projections, reseeds history or substitutes invented balances. Repeated runs preserve the original initialization metadata when no projections are missing. Private progress/log files contain setup diagnostics; the public plan records initialization conditions. Already initialized fixtures can verify preservation without a rebuild. Keep these conditions fixed throughout the comparison.

The fixture is deliberately fixed; record fixture version/build and actual container image IDs in the plan. Mutable image tags are not an image identity. Repeat a comparison on the same machine, browser/runtime versions, viewport, locale, zone, pool size, fixture population and concurrency. The initial pool maximum is 10. `CIRCLE_NODE_TOTAL=3` selects two build workers in the installed Next.js version; the host-default 31-worker build exceeded available resources, while the bounded CI build passed. This is an explicit reproducibility condition, not an application performance optimization. Runtime configuration is validated, empty optional variables are omitted, and the Redis command timeout is explicitly 2,000 ms. The previous skipped-validation startup left the timeout undefined and failed authentication.

Authentication uses real Better Auth sign-in and organization activation. HTTP 429 honors bounded `Retry-After` delays. Cookie Secure, HttpOnly, SameSite and Path attributes survive into Chrome; production `__Secure-` cookies must not be rewritten with `secure:false`. `pnpm performance:fixture authenticate <private-directory>` refreshes all eight synthetic actors without launching a second server. `check-runtime` validates the isolated configuration without restarting it. Newly prepared/upgraded fixtures generate their own VAPID keys, avoiding the missing-key response; no push subscriptions or external recipients are seeded.

## Freeze and verify the comparison plan

`plan` writes a draft with concrete fixture journeys and unset budgets. Supply the application source commit with `--source-build` and the actual built binary's hash with `--binary-build`; current tooling HEAD is recorded separately. These can differ when only benchmark tooling was committed after the application source was fixed. The runner verifies the binary against the fixture's existing `/api/app-version` interface and keeps a missing/mismatched identity as an unfulfilled gate before sampling. The selectors observe useful content and the known-enabled clock. Verify each configured Link, including mobile sidebar prerequisites, before setting `fixture.journeysVerified`. Employee settings, reports and analytics use authorized manager/admin actors. Expected-denial journeys belong in separate evidence.

Reports and analytics use the real shared date picker: Last Year selects 2025, then Custom Range and its calendar select the month or quarter. March 1 must be selected twice before March 31 to collapse the previous annual start correctly. The runner verifies exact custom labels and actual results: 168/512/2,088 hours per employee and 32/96/416 home-office hours. Analytics verifies the complete employee table, not its heading or an empty table after a failed query. Original manager analytics exposes all organization rows; the corrected assigned-team scope must not be described as a like-for-like speed improvement.

The Dashboard mutation hides Quick Stats through Customize, waits for accepted persistence, reloads and verifies its unchecked value. Its reset restores the original saved fourteen-widget layout, reloads and verifies it; mutation concurrency is one. Reset requests use a different trace and do not enter the measured resources/backend totals. Read-only reports and analytics have no invented mutation. Reports manual refresh clicks Generate Report again and observes its response/results; other refreshes arm response observation before clicking and await idle feedback, so a fast busy transition cannot be missed.

Header actions use the visible controls. At 390px, Refresh and Customize live behind More actions; at 1280px, the desktop controls are visible. The fixture driver opens the mobile overflow when necessary, selects the visible accessible action and waits for refresh idle. Hidden desktop duplicates are never used as mobile targets.

Navigation also selects a visible match among duplicate anchors. The settings sidebar and main Employee card can share the same href while one is hidden; a visible main Link is used directly without opening an unrelated sidebar. Search-to-detail navigation waits for the visible employee Link. Calendar/select popups finish closing before the next control is used. Failure artifacts retain safe action names and step numbers in addition to the journey stage; they never retain selectors or private search values.

Each isolated fixture context denies **notifications only**, before navigation, using the installed Puppeteer context-scoped permission API. Generated plans/artifacts record `notifications-denied-for-fixture-origin`; samples verify the actual permission. Geolocation and other defaults remain unchanged, and the regular browser profile is untouched. Without this explicit setup Chrome's default notification permission allows the delayed Stay Updated onboarding panel to cover navigation and refresh controls; those intercepted-click diagnostics are setup failures, not route latency measurements. No UI is hidden by force, no app preference is written and no push subscription is created. Use this same permission policy for predecessor and head; dedicated permission/clock-consent functional tests keep their own scenarios.

Browser history does not restore generated report snapshots. Report and analytics return journeys record returned-form readiness separately, then explicitly reselect the historical range and regenerate useful results. This preparation is included in usable-content latency and identified in the artifact. Earlier failed automatic-restoration observations remain diagnostic failures. Use `--verify-journeys` with optional `--condition`/`--route` filters for one attempt per mode; these artifacts cannot finalize as controlled benchmarks or establish budgets.

The `baseline` phase permits unset budgets so the first twenty fresh/warm attempts can establish evidence. Archive that exact baseline plan and artifact; finalization checks its unchanged hash. Then freeze numerical p95 ceilings for usable content (`usableContentP95Ms`), clock readiness (`clockReadyP95Ms`), initial JavaScript transfer (`javascriptP95Bytes`) and queries (`queryCountP95`) before evaluating the optimized build. The separate `release` plan differs only in build identity, phase and frozen budgets; do not rewrite the archived baseline plan or change workload conditions. Release collection/finalization requires numerical budgets; unknown phase names cannot bypass that rule. Baseline evidence with unset budgets does not claim a passing release. Historical October navigation observations are not this baseline.

```powershell
pnpm performance:baseline --plan C:/evidence/plan.json --validate-plan
pnpm performance:baseline --plan C:/evidence/plan.json --auth C:/private/z8-performance/auth-private.json --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe" --out C:/evidence/before
```

Every compared condition/selected-range/authorized-route records at least twenty fresh first documents and twenty warm Link visits. The generated plan also records five return and manual-refresh attempts, plus five Dashboard mutation attempts. `routes[].modes`, `samplesByMode` and `routes[].ranges` make this explicit; all five modes must be covered globally. The draft uses one `default` range for Dashboard, clock and employee views, and month/quarter/year for reports and analytics.

Optional `routes[].conditions` lists the exact public condition labels compared for a route. Omission retains the cross product of its allowed roles/ranges. Unknown labels, empty selections, an unused declared condition or a required route with no eligible condition are rejected. Collection and finalization apply the same condition/role/range filter, with twenty first and twenty Link attempts for every selected cohort. This records a representative matrix explicitly without implying unmeasured combinations were tested.

- First document: a fresh isolated browser context with synthetic authentication.
- Repeat Link: prime the target, open the away route, then click the actual target Link.
- Return visit: prime the target, visit the away route and return using browser history.
- Manual refresh: prime the target and observe its explicit refresh lifecycle.
- Mutation refresh: prime the target, perform the configured accepted mutation and observe its changed output.

Fresh browser storage does not imply a cold server cache. Run separately recorded concurrency levels, including a representative concurrent condition, using identical plans for predecessor/head. Concurrent contexts isolate identities; they intentionally share server/database capacity. The runner records DOM readiness with monotonic elapsed time. It is not browser paint timing. Browser-native document LCP is separate. Largest observed Event Timing duration is `interactionMaxMs`; it is **not** claimed to be a complete page-lifetime INP measurement. Missing INP stays null.

Network counts, request durations and completed compressed transfers come from Chromium's events through usable-content/clock readiness, excluding priming and mutation restoration. Pending requests are recorded by safe resource kind, including separate pending Script/RSC counts. Open XHR or EventSource work does not extend readiness. Pending script transfers prevent release acceptance of the JavaScript budget; observed bytes are never labeled complete totals for unfinished streams. External RSC responses are identified by MIME type. First-document inline Flight scripts are separate `inlineRscDecodedBytes`: decoded UTF-8 script bytes including their wrapper, not compressed transfer bytes. Do not add these different byte units. HTTP-cache/service-worker reuse is separate. Cached zero transfer does not imply zero uncompressed code. Request durations overlap and cannot be added to route latency. Raw URLs, headers, cookies, bodies, DOM text and personal query parameters are not saved.

## Backend and acceptance evidence

New controlled captures use `runtime.collectorProtocol: "z8-fixture-otlp-collector-v2"`. Start a fresh collector with `--require-registration --observer-control <new-private-native-control-file>` and pass its private `--collector <collector-control-file>` to the runner. The fixture starter accepts this v2 control file and configures `Z8_PERFORMANCE_OBSERVER_CONTROL_FILE`; the optional native control server starts only at runtime with the existing loopback fixture opt-in. Separate build-phase and package-lifecycle tests verify it creates no control file during production builds.

The shared client registers measured, prerequisite and cleanup trace IDs before browser IO. After closing the browser context it waits for registered server/native work and 500 ms quiet, bounded at ten seconds, then force-flushes the exporter and reconciles numerical evidence. The independent oracle counts native PostgreSQL wire `query` and prepared `execute` calls without reading SQL or arguments and without wrapping OTel's `Client.query`. Wire calls, native SDK query ends and delivered deduplicated query spans must agree. Pending work, dropped exports, orphan native spans during active visits, late spans or rejected batches leave coverage incomplete. No work is reassigned by its time window.

The strict collector admits at most 10,000 trace IDs and 64 active IDs, refuses excess registrations explicitly, and clears deduplication IDs when each visit closes. Unregistered spans never allocate trace records; native ones increment numerical uncertainty for active visits. Later unrelated failures do not erase already closed, reconciled evidence, while late work on a closed identity invalidates that identity. A million unregistered native spans leave the regression collector at four retained metric records and zero retained span IDs. The interrupted v1 capture remains diagnostic evidence and cannot establish v2 acceptance.

The primary runner also records `nativeRunCoverage` across the complete capture, including measured, prerequisite and cleanup identities. Global wire calls, native SDK starts/ends and all received registered query counts must agree, with no pending native work or active registrations. This catches work between visits and a late export lost entirely after its visit closed. Individual historical records remain available for diagnosis; an incomplete global result prevents v2 finalization even when some individual visits are complete.

Before fresh full captures, use `pnpm exec node scripts/performance/native-global-probe.mjs --run --plan <v2-plan> --auth <private-auth> --collector <private-control> --chrome <chrome> --out <new-directory> --condition <public-label> --route dashboard` separately for small and large organizations. This runs finite actual production browser journeys and compares global wire/SDK deltas against all registered visit/prerequisite/cleanup spans. Its numerical report includes incoming-parent match buckets for diagnosis; it does not establish timing or resource acceptance. Run the guarded `apps/webapp/scripts/check-performance-native-coverage.ts` with the existing disposable integration database variables to check concurrent simple and prepared SQL paths independently.

Every measured request to the fixture origin carries a generated W3C `traceparent`; the public artifact retains only its random trace ID. Reuse the app's request tracing and the integration database/query-logger seam for query-family evidence. Include transaction-bound client reads; observing only `pool.query` misses those paths. Preserve the original trace association when exporting to the normalized backend input below. Never export SQL parameters, session tokens or credentials.

Priming and away-route prerequisites use a separate `prerequisiteTraceId` from the start. The runner switches to the measured trace only when the timed visit begins, so successful samples exclude prerequisite backend work. If an original condition cannot finish priming, its failed attempt records `censored: true`, `resourceScope: prerequisite-failure`, actual attempt elapsed time and the prerequisite trace as `backendTraceId`. Browser readiness and unobserved resource counts remain null, never zero. Finalization correlates the actual failed prerequisite work; missing backend evidence still blocks evidence completion. Such a censored predecessor can be recorded when complete evidence exists, while release acceptance remains failed and no usable-content percentile is invented.

```json
[
  {
    "traceId": "the-measured-32-character-trace-id",
    "queryCount": 12,
    "queryDurationMs": 40,
    "rowsRetrieved": 80,
    "poolWaitMs": 0,
    "cacheHits": 1,
    "cacheMisses": 1,
    "eventLoopDelayMs": 2
  }
]
```

These are illustrative schema values, not measured evidence. The local collector accepts the installed OTLP/JSON exporter, retains only numerical allowlisted evidence and discards raw spans. Flush it with `GET /metrics` before finalizing so delayed batches reach its output file. Allow the configured export interval after browser collection. Its control file records the loopback endpoint. Missing coverage remains null; rejected batches invalidate coverage.

The optional fixture observer uses the existing request/pg instrumentation. `queryCount` counts native pg driver query spans once, including transaction-bound client work; nested manual `db.query` wrappers are excluded. `rowsRetrieved` sums numeric returned-row counts, with no row contents. `poolWaitMs` is explicitly the sum of native pool acquisition durations, including new connection setup, rather than pure queue wait. Query errors and acquisition errors are retained as numerical diagnostics.

Cache counts cover only actual `get` outcomes on the installed Next 16.4.0 native default use-cache handler. An in-place observer preserves the handler object, built-in identity, streams, tags and original 50 MiB limit; it creates no cache backend. Private/fetch/React/Redis caches are outside this definition. An uninitialized first request marks coverage unknown and later requests retry observation. No cache keys, tags or payloads are retained. An installed-version mismatch remains unknown.

`eventLoopDelayMs` is maximum scheduling lateness of 10 ms probes completing during correlated server spans, including concurrent host work. It is not CPU time or an isolated per-request causal attribution. Windows exceeding the bounded 30,000-probe history are incomplete; windows with no observed probe stay null. The generated fixture flag and validated loopback endpoint enable this observer only at runtime; ordinary production behavior is unchanged when disabled. Record identical observer version, interval, queue/batch limits and native-cache conditions before and after. Do not compare observer-enabled with observer-disabled measurements.

`pnpm performance:fixture check-observer <private-directory> --collector <control-file>` exercises the real SDK, approved PostgreSQL seam and native cache handler. It verifies transaction queries, numeric rows, acquisition spans, first-window cache coverage, stream replay/tag invalidation and scheduling probes. This protocol check is not an application timing sample.

```powershell
pnpm performance:baseline --plan C:/evidence/plan.json --finalize C:/evidence/before/baseline.json --backend C:/evidence/before/backend-metrics.json
```

Finalization requires every planned attempt cohort, complete correlated metrics, recorded budgets, reset success and verified journeys. It retains failures and p50/p95/min/max rather than dropping slow samples. If any attempt fails, that cohort's usable-content summary is null; successful-only timings are separately labeled. Failure stage, safe failure kind and elapsed-until-failure remain available. A complete `phase: baseline` predecessor may finalize as `baseline-recorded` despite failed journeys or exceeded ceilings; `releaseAcceptance` still records failure. A release must pass those gates. In particular, the original large annual analytics pool-timeout failure must remain evidence, with no fabricated usable latency. Browser collection alone exits nonzero pending finalization. Actual twenty-first/twenty-warm cohorts and budget freeze remain required before #1450 completion. Actual production topology/CDN remain unknown; local multi-instance/proxy evidence is assessed separately in #1472, #1473 and #1475.

```powershell
# Stop the fixture start command first; remove only label-verified owned containers.
pnpm performance:fixture cleanup C:/private/z8-performance
pnpm performance:test
# With the real disposable server running:
$env:Z8_PERFORMANCE_RUNTIME_DIRECTORY = "C:/private/z8-performance"
$env:Z8_TEST_CHROME_PATH = "C:/Program Files/Google/Chrome/Application/chrome.exe"
pnpm performance:test:runtime
```

Cleanup keeps private manifests on disk for deliberate local removal. It never removes unrelated containers or reads existing production configuration.

## October 24 implementation evidence

The provisioner completed against its own labeled services: migration recovery/fresh migration, synthetic SQL agreement and all 208 active tracking readers passed. The bounded CI production build passed for application source `39a08d0bb`, binary `cee40ccad`. Real Chromium checks passed for all eight actors' production cookies, Dashboard and enabled clock, and the reversible saved-layout mutation. Parent browser checks verified report ranges and small analytics totals; large month/quarter analytics passed while annual analytics failed with actual pool timeouts. CLI/collector regressions retain failed predecessor evidence, enforce cohorts/reset recipes and reject missing metrics; a real SDK/OTLP/PostgreSQL/cache probe passed. These are correctness/protocol checks. Controlled timing cohorts, final correlated coverage and budgets remain pending. No application latency, byte or query improvement is claimed by setup evidence.

# Authenticated performance baseline

The runner and disposable local services support spec #1448 / ticket #1450. A successful setup or unit test is not a completed performance baseline. The ticket stays open until the production browser journeys, recorded budgets and correlated backend evidence pass together.

Run from the repository root with pnpm. Choose an absolute **private directory outside the repository** for generated service credentials, synthetic account credentials, browser cookies and the runtime log. Publish only the reviewed comparison plan and numerical `baseline.json` artifact. Do not publish `*-private.json`, `services.json` or `runtime.log`.

```powershell
pnpm performance:fixture prepare C:/private/z8-performance
pnpm performance:fixture start C:/private/z8-performance --build
# Keep the start command running. In another terminal:
pnpm performance:fixture plan C:/private/z8-performance C:/evidence/plan.json --source-build <application-source-commit> --binary-build <deployed-build-hash>
```

`prepare` owns PostgreSQL 16, Valkey and RustFS Docker containers, binds only loopback ports, verifies the existing integration migration recovery/fresh chain, and seeds through the existing integration database gate. The existing canonical-work fixture helper supplies matching work records. No production data, Phase secrets or normal development service configuration is copied. The build/server receive generated local configuration and ordinary OS/tool settings. Private S3 uses the local fixture storage too; billing, product analytics, external tracing, email, cron and secret-store credentials are disabled. These choices are part of the comparison conditions, not evidence about deployed billing or cache behavior.

The synthetic fixture has two organizations (8 and 200 employees), two teams per organization, employee/manager/organization-admin/restricted-custom-role actors, manager assignments to one team, confirmed employment terms and a weekday policy. Each employee has 261 completed 8-hour periods in 2025, including Berlin's actual DST offsets. The small organization has 2,088 completed periods and 416 home-office dates; the large organization has 52,200 and 10,400. Seeding verifies employee, home-office and canonical-record agreement counts in PostgreSQL. Month, quarter and year ranges use March 2025, January–March 2025 and calendar 2025. The platform setup administrator is separate from the benchmark actors.

Fixture version 2 explicitly activates tracking from January 1, 2025 and verifies all 208 employees through the production tracking-context reader. Version 1 omitted activation and therefore did not exercise the new required-time calculations; do not compare those different workload configurations as a performance improvement. Existing local fixture directories can run `pnpm performance:fixture upgrade <private-directory>` before any controlled samples. This upgrades only the guarded synthetic fixture and writes runtime defaults; it does not restart a live server.

The fixture is deliberately fixed; record fixture version/build and actual container image IDs in the plan. Mutable image tags are not an image identity. Repeat a comparison on the same machine, browser/runtime versions, viewport, locale, zone, pool size, fixture population and concurrency. The initial pool maximum is 10. `CIRCLE_NODE_TOTAL=3` selects two build workers in the installed Next.js version; the host-default 31-worker build exceeded available resources, while the bounded CI build passed. This is an explicit reproducibility condition, not an application performance optimization. Runtime configuration is validated, empty optional variables are omitted, and the Redis command timeout is explicitly 2,000 ms. The previous skipped-validation startup left the timeout undefined and failed authentication.

Authentication uses real Better Auth sign-in and organization activation. HTTP 429 honors bounded `Retry-After` delays. Cookie Secure, HttpOnly, SameSite and Path attributes survive into Chrome; production `__Secure-` cookies must not be rewritten with `secure:false`. `pnpm performance:fixture authenticate <private-directory>` refreshes all eight synthetic actors without launching a second server. `check-runtime` validates the isolated configuration without restarting it. Newly prepared/upgraded fixtures generate their own VAPID keys, avoiding the missing-key response; no push subscriptions or external recipients are seeded.

## Freeze and verify the comparison plan

`plan` writes a draft, with explicit placeholders and unset budgets. Supply the application source commit with `--source-build` and the actual built binary's hash with `--binary-build`; current tooling HEAD is recorded separately. These can differ when only benchmark tooling was committed after the application source was fixed. The runner verifies the binary against the fixture's existing `/api/app-version` interface and keeps a missing/mismatched identity as an unfulfilled gate before sampling. Fill the usable-content and known-enabled-clock selectors for each route. Observe useful data or a legitimate empty state, not just a heading or skeleton. Verify the configured Link actually navigates in the app, including sidebar prerequisites. Employee settings require an authorized manager/admin actor. Use separate routes/conditions when role-specific markers differ.

Select the stated historical range through the real UI or supported route query parameters. A range label in a JSON file does not select a date range in the app. The runner currently substitutes `{locale}`, `{employee}`, `{start}` and `{end}` in route paths. For routes without a URL range interface, supply an instrumented fixture journey that controls the real range before considering its measurements accepted; this remains an unfinished gate.

Configure a reversible, accepted fixture mutation for every compared route and a selector that observes its **changed accepted value**. An already-visible success toast or unchanged marker is insufficient. Mutation steps support selector clicks and typing. Preserve the same initial state by recreating fixtures or supplying reset steps between comparisons; do not compare a growing mutation history with a fresh fixture. Manual refresh observes the existing refresh button's busy transition. Delayed/failed refreshes remain failures; they do not become zero-duration successes.

Record numerical p95 ceilings for usable content (`usableContentP95Ms`), clock readiness (`clockReadyP95Ms`), initial JavaScript transfer (`javascriptP95Bytes`) and queries (`queryCountP95`) before evaluating an optimized build. Retain the first measurements as the controlled baseline, then freeze the budgets before changing the workload. The runner hashes the exact plan bytes; finalization refuses a changed plan. Historical October navigation observations are not this baseline.

```powershell
pnpm performance:baseline --plan C:/evidence/plan.json --validate-plan
pnpm performance:baseline --plan C:/evidence/plan.json --auth C:/private/z8-performance/auth-private.json --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe" --out C:/evidence/before
```

Every condition/selected-range/authorized-route records at least twenty samples of each of the following visit modes. `routes[].ranges` selects names from the plan's `ranges` list. The generated draft uses one `default` range for Dashboard, clock and employee views, and month/quarter/year for reports and analytics. It does not multiply unrelated views by report ranges. The generated settings/report/analytics conditions initially include manager/admin actors; verify actual access before expanding them. Expected-denial journeys should be recorded separately from usable-content latency.

- First document: a fresh isolated browser context with synthetic authentication.
- Repeat Link: prime the target, open the away route, then click the actual target Link.
- Return visit: prime the target, visit the away route and return using browser history.
- Manual refresh: prime the target and observe its explicit refresh lifecycle.
- Mutation refresh: prime the target, perform the configured accepted mutation and observe its changed output.

Fresh browser storage does not imply a cold server cache. Run separately recorded concurrency levels, including a representative concurrent condition, using identical plans for predecessor/head. Concurrent contexts isolate identities; they intentionally share server/database capacity. The runner records DOM readiness with monotonic elapsed time. It is not browser paint timing. Browser-native document LCP is separate. Largest observed Event Timing duration is `interactionMaxMs`; it is **not** claimed to be a complete page-lifetime INP measurement. Missing INP stays null.

Network counts, request durations and compressed transfer sizes come from Chromium's network events, stop at usable-content/clock readiness, and exclude initial priming requests. External RSC responses are identified by MIME type. First-document inline Flight scripts are counted separately as `inlineRscDecodedBytes`: decoded UTF-8 script bytes including their wrapper, not compressed transfer bytes. Do not add these different byte units. Only the numerical count leaves the page. HTTP-cache/service-worker reuse is recorded separately. A zero transfer for a cached resource does not mean its uncompressed code size is zero. Request durations may overlap and must not be added to route latency. Raw request URLs, headers, cookies, bodies, DOM text and personal query parameters are not saved.

## Backend and acceptance evidence

Every measured request to the fixture origin carries a generated W3C `traceparent`; the public artifact retains only its random trace ID. Reuse the app's request tracing and the integration database/query-logger seam for query-family evidence. Include transaction-bound client reads; observing only `pool.query` misses those paths. Preserve the original trace association when exporting to the normalized backend input below. Never export SQL parameters, session tokens or credentials.

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

These are illustrative schema values, not measured evidence. This change does not yet supply an automatic trace-to-backend-metrics exporter. Missing query, rows, pool-wait, cache and event-loop measurements remain explicit null/missing gates; do not fill them with zero or infer them from browser request counts. The production query-span seam and PostgreSQL integration query logger are existing evidence sources, not proof that every required metric is already instrumented.

```powershell
pnpm performance:baseline --plan C:/evidence/plan.json --finalize C:/evidence/before/baseline.json --backend C:/evidence/before/backend-metrics.json
```

Finalization requires every planned cohort, sufficient successful samples, complete correlated numerical metrics, budgets and verified range/mutation/readiness journeys. It retains failures and p50/p95/min/max (variance range) instead of dropping slow samples. Browser collection alone exits nonzero and leaves acceptance unfulfilled. Do not mark #1450 complete just because the runner, fixture setup or build passes. Actual deployed topology, multi-instance invalidation and ingress/CDN streaming are further gates in #1472, #1473 and #1475.

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

The provisioner completed against its own labeled services: the existing migration-recovery verifier passed, the fresh schema migrated, and synthetic seeding/SQL agreement checks passed for the counts above. Five command-level regression checks cover absent fixture configuration, insufficient sample counts, missing backend evidence, incomplete cohorts and unknown route ranges. The bounded CI production build passed for original application source `39a08d0bb`, binary/tooling head `cee40ccad`. A real Chromium regression passed for all eight actors using production sign-in cookies, authenticated Dashboard navigation and enabled clock controls. Fixture v2's 208 active tracking contexts passed through the real reader. These are runtime/correctness checks; controlled timing cohorts and complete backend evidence remain pending. No latency, byte or query improvement is claimed by this setup evidence.

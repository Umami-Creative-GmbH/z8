# Controlled release budgets and settled resources (#1450 / #1475)

This operator policy is fixed before controlled integrated-head timings. It does not claim that phase budgets were set before application implementation. The coordinating implementer has already seen functional candidate observations. Derive actual numerical ceilings only from the finalized original C1 and original companion artifacts; never supply candidate measurements to `derive`.

The interrupted original C1 plan, runner identity and raw samples remain unchanged diagnostic evidence. They cannot register budgets. A corrected v2 telemetry pass needs a new immutable plan/hash and complete native proof; its browser journeys and business workload remain the same. The release plan copies the original workload exactly: condition identities/scopes, fixture population, ranges, recipes, notification policy, origin, pool/cache configuration, concurrency, twenty fresh-context first documents, twenty repeat Links, and the five functional samples where declared. Only phase, the three source/binary/tooling identities and numerical budget fields change. A new output directory is required; files are never silently overwritten.

## Fixed policy, version 1

| Evidence                                        | Ceiling                                                                | Scope                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Successful complete usable/clock/native LCP p95 | `ceil(max(beforeP95 × 1.25, beforeP95 + 250 ms, 500 ms))`              | Individual condition/route/range/mode cohort; LCP only first documents                            |
| Failed/censored before usable/clock cohort      | Original `plan.timeoutMs` absolute ceiling                             | No finite before cohort p95; retain failure/censor counts; release must have zero failed journeys |
| Complete byte p95                               | `ceil(max(beforeP95 × 1.10, beforeP95 + 16,384 bytes, 16,384 bytes))`  | Individual matched cohort and byte unit                                                           |
| Backend resource p95                            | `ceil(max(beforeConditionMax × 1.25, beforeConditionMax + allowance))` | Conservative condition-wide ceiling over all original samples                                     |

Backend allowances are 10 queries, 100 returned rows, 100 ms summed query duration, 25 ms summed native pool acquisition duration, 10 ms event-loop delay and five native cache misses. Cache hits/misses are still reported separately. The allowance is a noise floor, not an improvement claim. Whole-request backend telemetry and browser resources observed through readiness cover different windows: frontloading a reader can increase traced queries in a particular cohort. These resource ceilings therefore do not demand a query reduction in every cohort. Retain the stronger existing contracts separately: the 15-query batched readers, no employee/week or home-office/day fan-out, and bounded request-context counts.

Missing metrics never become zero. A before cohort with a failed journey has no finite cohort usable-content percentile, including when its other 19 visits succeeded. A required clock marker without readiness is rejected. Unknown native LCP remains unknown. `interactionMaxMs` is the largest observed Event Timing duration, not full page-lifetime INP. First-document inline Flight is decoded UTF-8 script bytes; CDP JavaScript/Document/external RSC are completed transfer bytes. Those units are not added.

## Registered native telemetry, v2

The corrected before and head plans must declare `runtime.collectorProtocol: z8-fixture-otlp-collector-v2`. The companion requires `--collector` with the private v2 collector control file. It uses the shared `collector-client.mjs`: `beginCollectorVisit({ control, traceIds })` registers the measured/prerequisite/background IDs at both the fixture observer and collector before creating a browser context. After context closure, `endCollectorVisit(visit)` owns the common observer force-flush and collector proof exchange. No collector endpoint/control path is written into numerical artifacts. Registration/client source bytes join the companion protocol fingerprint.

Only registered identities may allocate collector trace records. An unknown native span while a visit is active, malformed/rejected data, lost query/acquisition/cache evidence, open native operations, late closed-trace evidence or an admission failure is an unfulfilled gate. There is no boolean-only legacy fallback. Both primary and companion budget validation require `coverage.registration === true`, `closed === true`, `unattributedNativeSpans === 0`, `rejectedBatches === 0`, `incomplete === false`, `nativeProof === true`, `lateSpans === 0`, plus complete observer/PG/rows/cache/event-loop coverage and exact correlated numbers. A native counter/oracle control must first prove actual original-app attribution; merely filtering unrelated Effect trace IDs is not proof that native queries were preserved.

Interrupted C1 timings retain diagnostic value, with their original failures and transfer censoring. Collector capacity exhaustion or unknown native coverage prevents finalized release evidence even if browser timings exist. Do not repair the old ledger by inserting zeros, deleting failures, relabeling it complete or substituting a successful-only percentile. The fixed numerical factors in this policy remain unchanged; actual derivation waits for the complete corrected before pass and matched companion.

## Two resource windows

C1 records completed transfers through usable/clock readiness. A finite number in that ledger is an observed-window lower bound, not full initial cost. Pending Script/RSC requests censor the corresponding byte cohort. An incomplete resource window censors total/inline comparisons. The comparison report retains the original pending counts, failed requests, incomplete windows, failure details and null percentiles. It cannot fulfill full-resource acceptance without a complete matched companion.

`settled-resources.mjs` runs a separate authenticated pass after the corrected primary pass. It follows the original first-document and repeat-Link recipes with **twenty new browser contexts for each required cohort/mode** and preserves ordinary runtime cache warming. It does not rerun functional mutations; the original five functional visits remain timing/behavior checks. Repeating Last Year then Custom Range includes prior annual work. `prepare(false)` can leave priming reads in flight. Neither pass measures an isolated month computation or guarantees a warm data cache.

The companion records a readiness snapshot, then waits for **1,000 ms with no mandatory finite network activity**, with a **10,000 ms post-readiness cap** and 50 ms observation polls. It drains Document, Script, route RSC and other finite requests, including requests starting after readiness. Unknown finite Fetch/XHR work remains mandatory. Response MIME identifies RSC when request headers do not. Redirect hop lengths are retained; unknown lengths, HTTP/network errors, pending mandatory requests and caps remain censored. The cap does not extend primary C1 timing.

Requests explicitly marked `Next-Router-Prefetch: 1`, `Purpose: prefetch` or `Sec-Purpose: prefetch` are counted separately from mandatory route work. Their bytes/pending/errors remain in the artifact; intentional partial prefetch cannot hold settling forever. WebSocket/EventSource traffic is separately counted, including CDP WebSocket lifecycle events. Other finite background polling is not silently excluded and can exhaust the cap. Mandatory inherited priming requests are counted and drained separately; their completed bytes are reported but not charged to the measured navigation. Completed priming requests are excluded when the measured navigation begins.

Mandatory request traces retain the measured trace ID; explicitly marked prefetch and identifiable long-lived requests use a separate recorded background trace ID and priming uses a prerequisite trace ID. The backend finalizer requires exact native observer/PG/rows/cache/event-loop coverage and zero rejected batches for each mandatory trace. Raw prefetch/priming/background counts remain available; they are not claimed as zero cost. The companion measures a bounded finite-resource window, not all future page-lifetime work. No global cache clearing, byte-blocking interception, changed route workload or full-browser `networkidle` claim is used.

## Collection and registration order

Keep the original-business-code fixture, database and corrected observer/collector until both original passes finish. Do not collect any companion while a primary pass is active. Use the real same browser, machine, versions, fixture and observer configuration. Commands below are templates; substitute existing private/evidence paths and real final build identities.

```powershell
# After C1 completes, flush its existing collector /metrics, then use the frozen finalizer.
pnpm performance:baseline --plan C:/evidence/before-plan-v2.json --finalize C:/evidence/before.json --backend C:/evidence/before-native.json

# On the ORIGINAL app, collect the additional resource pass with the unmodified before plan.
pnpm performance:settled capture --plan C:/evidence/before-plan-v2.json --auth C:/private/auth-private.json --chrome C:/browser/chrome.exe --collector C:/private/collector-control.json --out C:/evidence/before-settled.json
# Flush the existing collector /metrics after mandatory requests/export complete. Preserve the exact snapshot.
pnpm performance:settled finalize --plan C:/evidence/before-plan-v2.json --artifact C:/evidence/before-settled.json --backend C:/evidence/before-settled-native.json

# Only finalized original evidence can choose numerical ceilings. No head input is accepted.
pnpm performance:budgets derive --before-plan C:/evidence/before-plan-v2.json --before C:/evidence/before.json --backend C:/evidence/before-native.json --before-settled C:/evidence/before-settled.json --before-settled-backend C:/evidence/before-settled-native.json --release-build <actual-binary-hash> --release-source <application-source-hash> --release-tooling <tooling-hash> --out C:/evidence/registered-release
```

Review and preserve `registered-release/release-plan.json` and `release-budgets.json`, their SHA256 values, this policy commit and registration time **before the first controlled head timing or head companion**. The CLI checks input hashes, current budget operator hash and policy/cohort regeneration. It cannot independently prove chronology from legacy artifacts that lack capture timestamps; the operator's preceding recorded registration is required. Existing functional candidate observations do not qualify as controlled release results or prospective phase evidence.

A finalized baseline with complete raw failure ledger and native correlation can be `baseline-recorded` despite known failed journeys/pending transfers. That means its evidence is complete, not its release acceptance or full-byte cost. Derivation rejects unknown/mismatched backend metrics, incomplete cohorts and non-finalized artifacts. Complete companion evidence additionally requires every mandatory settled resource, byte field and error status to be known; incomplete before companions cannot produce a passing full-byte budget.

Then collect and finalize the primary head ledger using the new **exact release plan**, and the companion on that same build:

```powershell
pnpm performance:settled capture --plan C:/evidence/registered-release/release-plan.json --auth C:/private/auth-private.json --chrome C:/browser/chrome.exe --collector C:/private/collector-control.json --out C:/evidence/head-settled.json
# Flush collector /metrics, preserving its full native evidence snapshot.
pnpm performance:settled finalize --plan C:/evidence/registered-release/release-plan.json --artifact C:/evidence/head-settled.json --backend C:/evidence/head-settled-native.json
pnpm performance:budgets compare --before-plan C:/evidence/before-plan-v2.json --before C:/evidence/before.json --backend C:/evidence/before-native.json --before-settled C:/evidence/before-settled.json --before-settled-backend C:/evidence/before-settled-native.json --plan C:/evidence/registered-release/release-plan.json --budgets C:/evidence/registered-release/release-budgets.json --head C:/evidence/head.json --head-backend C:/evidence/head-native.json --head-settled C:/evidence/head-settled.json --head-settled-backend C:/evidence/head-settled-native.json --out C:/evidence/release-comparison.json
```

Companion artifacts require matching source/plan identities, operator/helper/observer/frozen-runner hashes, policy, browser, hardware, native correlation and exact cohort/iteration counts. Comparison recomputes budgets from the registered original inputs, rejects changed workloads/thresholds and reports p50/p95/min/max. Successful companion byte contracts resolve only the separate settled-resource gates. Primary partial byte fields retain `passed: null` with their censor/scope explanation; functional modes remain timing/structural checks. Primary failed journeys and request errors still fail comparison. A primary script-incomplete gate is retained as evidence and is never relabeled passed.

`derive` and `compare` also support primary-only analysis by omitting all companion options; this cannot fulfill `resourceAcceptance`. A companion cannot be added after budget registration. Exit 0 means that operation's numerical gates succeeded, exit 1 means recorded unfulfilled gates or a capture awaiting finalization, and exit 2 means rejected inputs/runtime availability. Whole-release acceptance remains explicitly unfulfilled in this numerical operator: structural contracts, mixed load with clock commands, identity/permission isolation, expected totals, cache invalidation, deployment/ingress and required quality checks still need their own #1475 evidence.

Generated auth, cookies, runtime logs and service credentials remain private. These operators save fixture labels, random trace IDs, numerical evidence and hashes, never URLs, response bodies, SQL parameters or credentials. Review numerical artifacts before publication.

## Offline validation

```powershell
pnpm performance:test:budgets
```

The tests use synthetic numeric fixtures and observer events; they open no browser, app, database or service. Runtime acceptance remains pending until the original C1 finalizer, original companion, budget registration, controlled head captures and final comparison actually run.

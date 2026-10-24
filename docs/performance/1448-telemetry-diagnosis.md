# Corrected fixture telemetry diagnosis (#1450)

The registered collector and shared browser transport now account for actual native SQL across page and ServiceWorker requests. Full measurement acceptance remains **unfulfilled** pending complete controlled cohorts and budget derivation. The [earlier numeric evidence](evidence/1450-telemetry-functional-diagnostics.json) retains one failed Link transfer; the clean single-Link follow-up below does not replace that historical result. These are functional diagnostics, not a controlled timing baseline.

## Collector and native attribution

The original collector allocated trace records before recognizing relevant span types. A short protocol regression exhausted its 100,000-record capacity with unrelated spans. Registration now bounds retained identities, rejects admission explicitly, and associates missing, late, malformed or unattributed native evidence with the affected visits. Stress coverage includes one million unknown native spans without retained unknown trace records. Unknown work never becomes an invented zero.

Independent PostgreSQL wire invocation counts reconcile against native SDK starts/ends and received per-visit queries. The counter wraps connection query/execute boundaries without changing the instrumented client method's identity. A real guarded concurrent simple/prepared-query oracle counted eight wire calls and eight native ends, with separate three/five caller identities. Whole-run reconciliation also catches work dropped after an individual visit closes.

Page interception missed ServiceWorker traffic. Paired original Dashboard diagnostics changed from wire/SDK counts of 8,044 versus only 3,687 registered queries to 8,266 across all three counts for small admin; large admin similarly reconciled all 7,699 queries. These are separate functional runs, not comparable accepted latency samples.

## Browser initialization and wire bytes

Both sides must use the same `fixture-browser.mjs` launcher, fresh owned profile, installed browser version and recorded arguments. The profile disables browser prediction, search suggestions and the default search provider. The launcher additionally disables `AutofillServerCommunication`, a [documented Chrome testing control](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md). Actual original form pages caused five browser Autofill API CONNECT attempts despite the parent background-networking flags; this control reduced them to zero while preserving the 193 application requests in the paired diagnostic.

Registration precedes browser context creation. The shared initialization seam permits only a fresh empty `about:blank` context, before cookies, permissions or application navigation. It requires two seconds of quiet within ten seconds, zero application requests/body bytes and no pending work. Its startup counters remain in the artifact. A remaining browser startup CONNECT is refused and retained separately. Every subsequent refusal or upstream error still fails acceptance; there is no hostname exception or expanded origin allowlist.

The worker/form/gzip oracle used two concurrent contexts. Each observed 534 JavaScript and 651 document response-body bytes, exactly matching the independent server's 1,185-byte total. The compressed fixture was 210 bytes and decoded to 57,344 bytes. Both wire windows completed. An intentional application HTTPS fetch after initialization was refused and made each window incomplete. The proxy counts encoded HTTP response bodies before decoding, excluding headers, and preserves encoding/chunks. Page CDP byte fields remain separate diagnostics.

## Original annual failure

The unchanged original business source is `39a08d0bb`; the observer-only binary is `d5550e35c`. Annual first-document and Link visits still time out at the original expected table check. The expected 200 employees and 2088.0 hours remain unchanged, and usable-content p95 remains null for those failed cohorts.

A zero-row DOM snapshot did not establish an empty API result. Actual UI-generated action requests for public bounds 2025-01-01 through 2025-12-31 returned HTTP 200 with `success: false` and fixed class `DatabaseError`. Both a Puppeteer RSC reader and an in-page cloned-response reader agreed. No action ID was forged or replayed; raw responses, employee fields, request bodies and private error messages were not retained.

The underlying cause is pool acquisition timeout before SQL execution. Bounded private-log inspection in RAM found the fixed acquisition-timeout cause, with no statement-timeout or missing-schema match. Current native evidence independently recorded 69 failed acquisitions in the first measured visit, 93 in Link prerequisites and 94 in the measured Link. Executed queries had zero query errors. The original pool remains at ten connections and its original ten-second connection timeout.

The exact companion path reconciled 18,389 independent wire calls, native starts, native ends and received queries, with zero pending native queries or active traces. First-document finite traffic drained completely in about 1.052 seconds after the UI failure. Link retained one measured JavaScript transfer error and reached the ten-second resource cap. That incomplete byte evidence blocks resource acceptance even though native accounting is complete.

## Remaining gates

Preserve the interrupted C1 ledger and all failed diagnostics. The new full C2 draft preserves every non-runtime C1 field, including workload and recipes, but is not frozen. Verify the prospective original-only failed-behavior policy and complete controlled resource cohorts without waiving transfer errors, then freeze shared source fingerprints and the new plan before fresh full captures. Integrated-head functional checks and all required head comparisons must still pass. No full C2 capture, release-budget derivation or issue completion is claimed here.

Validation: `pnpm --config.verifyDepsBeforeRun=false performance:test` passed 30 tests. The explicit installed-Chrome worker/form/gzip runtime oracle passed outside the sandbox. A multi-window wire regression first charged 12 inherited bytes incorrectly, then passed after pending prerequisite records were marked inherited at each measurement boundary. Abort/refusal tests retain errors and prevent client cancellations from crashing the fixture process.

## Native paint and current Link follow-up

The primary CLI previously read its native observer only on functional success. A failed annual sample therefore had uncaptured LCP, not proven absent paint. The correction preserves the original successful-observation point and additionally reads existing native entries before closing a failed measured context. It does not wait for paint, invent a value, read an unattempted prerequisite, turn an interaction maximum into full INP, or relabel failed usable-content timing.

A real CLI regression uses an owned painted HTTP document whose functional readiness selector times out. It failed with null LCP before the correction and passed afterward. Missing native entries remain null. The actual original annual first-document diagnostic retained native LCP **588 ms from one entry**, an observed interaction maximum of 48 ms and clock readiness of approximately 752 ms. Its table check still failed, usable-content p95 stayed null, and all 4,970 native wire/SDK/collector query counts reconciled. This is one raw paint observation; controlled native-paint budgets still require every actual observation in the full cohort.

One subsequent exact exported annual Link diagnostic completed its failure resource drain in approximately 1.051 seconds with zero mandatory pending requests, errors, refusals after initialization, upstream errors or downstream cancellations. All new connection/response/reused-socket/method/reset reason counters were zero. Its 13,502 native wire calls, SDK starts/ends and received queries matched with no active or pending work. The failed UI and all eligibility markers remain recorded. The earlier isolated JavaScript error was not reproduced; its historical cause remains unknown and its original incomplete artifact remains unchanged.

The separate [paint and Link evidence](evidence/1450-native-paint-and-link-diagnostics.json) supplements the fixed earlier cause proof without changing its bytes. Thirty-six fast tests pass, and the explicit installed-Chrome failed-UI paint regression passes. No full C2 capture, complete twenty-observation paint cohort, budget derivation or freeze is claimed by this follow-up.

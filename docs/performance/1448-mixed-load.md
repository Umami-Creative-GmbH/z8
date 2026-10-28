# Single-app mixed workload operator (#1475)

**Prepared; runtime acceptance pending.** No mixed workload, fixture mutation or
browser was run while original C1 capture was active. The ten V2 protocol/CLI
checks, JavaScript syntax checks and focused Biome check pass. Those checks do
not prove actual browser control, analytics totals or native telemetry.

The prospective mixed operator now accepts the API's seven-character build hash
as a prefix of its recorded source pin, matching normal capture semantics. Next's
build configuration truncates an explicitly provided deployment hash to seven
characters; the version API returns that configured value. Recorded mixed source
pins still require 9–40 lowercase hexadecimal characters. Mismatches, malformed
hashes and a live identity longer than its recorded pin are rejected. The four
isolated source/CLI tests pass without fixture access. All three frozen C5
fingerprint maps and production inputs remain unchanged. This correction requires
a new mixed-tool snapshot before use; no earlier run is retroactively validated.

## Prospective mixed-clock budgets

`mixed-clock-budgets.mjs` is file-only preparation. No mixed numerical budget is
registered until a complete actual original run exists. A failed annual
preparation or fewer than twenty complete in/out pairs produces no finite budget.
The operator validates all forty commands, all 56 unique native identities,
balanced/drained SERVER proofs, all five resource categories, four complete
transports and the actual three-reader/four-user overlap before deriving anything.
It recomputes nearest-rank p50/p95 from every clock record. Each action's ceiling
is `ceil(max(beforeP95 * 1.25, beforeP95 + 250, 500))`, the existing policy7 latency
rule. Only clock-ready p95 has a threshold. Analytics volume/response time/decoded
UTF-8 bytes, command preparation/response timing and backend groups counted once
are descriptive; more completed analytics requests alone is not a regression.

The user-approved observation condition requires explicit `--phase baseline` (90 seconds) or `--phase release` (30 seconds), with pool 10 and acquisition timeout 60 seconds for both. Each independent context records `phase`, `observationTimeoutMs`, and the common `poolAcquisitionTimeoutMs`/observation policy. Clock ceilings remain bounded by 30 seconds; numerical factors and native/transport caps stay unchanged.

Before use, snapshot the ten measuring files named by the module into one
`{ "schema": 1, "files": { "filename.mjs": "SHA256", ... } }` manifest.
The command verifies those exact local bytes and retains its own module hash.
The same snapshot executes both runs. Record a separate actual context for each
run with `schema: 1`, `mixedArtifactSha256`, `fullBuild`, `protocolSha256`, UTC
`startedAt`/`finishedAt`, and `conditions`. The head context also records
`firstControlledHeadStartedAt`, the earliest controlled head primary, companion
or mixed start. Registration must precede that timestamp. Existing disclosed
functional observations do not become controlled timing samples.

The identical public `conditions` projection contains `topology: "single app"`,
the four actor labels in the order below, `poolMax: 10`, `clockPairs: 20`,
`annualYear: 2025`, `analyticsMaxRequestsPerCallerPerCommand: 100`,
`telemetryDrain: "once-after-condition"`, `viewport: {width:1280,height:900}`,
`timezone: "Europe/Berlin"`, `locale: "en"`, `origin: "http://localhost:58792"`
and `cacheWarming: "annual-public-preparation-complete"`. Record actual
`browser` and `node` versions; `hardware` with `platform`, `arch`, `cpuModel`,
`logicalCpus`, `memoryBytes`; and `fixture` with `version`, `populations: [8,200]`,
`rangeStart`, `rangeEnd`. Browser version must match each captured transport's
launch record. Root records hardware/Node/fixture facts for each actual run;
copying the original context is not proof of head parity. Tokens, real actor IDs,
emails, request headers and protected results do not belong in this projection.

```powershell
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/mixed-clock-budgets.mjs derive --before ORIGINAL_MIXED.json --protocol MIXED_PROTOCOL.json --before-context ORIGINAL_CONTEXT.json --expected-before-build FULL_ORIGINAL_COMMIT --expected-head-build FULL_HEAD_COMMIT --out NEW_MIXED_BUDGET.json

# Retain/register this output's exact SHA and UTC timestamp before any controlled head timing.
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/mixed-clock-budgets.mjs compare --budgets NEW_MIXED_BUDGET.json --budget-sha256 REGISTERED_BUDGET_SHA --before ORIGINAL_MIXED.json --head HEAD_MIXED.json --protocol MIXED_PROTOCOL.json --head-context HEAD_CONTEXT.json --out NEW_MIXED_COMPARISON.json
```

Both full build pins are explicit and different; each run's seven-character API
value may match only its corresponding full pin. Comparison binds the original
artifact, independent head context, registered budget SHA, exact protocol and
conditions. Unknown/duplicate CLI options and existing output paths are refused.
Regressions stay in the comparison and return failure. Eight focused synthetic
tests cover admission, tampering, complete cohorts, unchanged inputs and the real
file-command path. They do not supply runtime observations or a registered budget.

## Fixed condition

The operator uses the existing disposable fixture, fixed pool 10, desktop
1280×900 and Europe/Berlin. It uses four existing, distinct employees and verifies
each actual Better Auth session's email/active organization before work:

| Actor | Work |
| --- | --- |
| large-admin | Work-hours, actual Last Year selection for annual 2025 |
| small-admin | Team performance, actual annual 2025 selection |
| small-manager | Overtime burn-down, actual annual 2025 selection |
| large-manager | Twenty real header clock-in/out pairs |

This mix uses both organization sizes without adding an employee to the fixed
200-row cohort. Expected annual totals are 417,600 hours / 200 employees for the
large work-hours reader, 16,704 hours / eight employees for the small team reader,
and zero overtime for the manager's overtime scope. The operator checks those
literal outputs on preparation and every replay. It does not use balance totals
as a substitute for analytics results.

Actual UI-generated annual Server Action IDs, router headers, bodies and cookies
remain in RAM. Preparation waits for each annual public result to complete and
can warm server caches. These are separate mixed-load observations, with no cold
cache or first-paint sample claim and no change to frozen C1 priming.

Before each header submission, three independent analytics callers begin bounded
sequential requests: one in flight per caller, at most 100 requests each per
command. They stop scheduling when the command's usable header state settles;
in-flight reads drain before the next command. Reaching a caller's finite request
bound before settlement fails the protocol. Actual tracked HTTP overlap at each
clock dispatch and maximum user-request concurrency are recorded; anything other
than three analytics reads in flight at actual clock dispatch
or failure to observe concurrency four fails the protocol. Background framework
requests are not counted as extra workload users.

The header is driven through visible controls. The fixture's existing online
legacy protocol must be available before any writes; an append-adopted fixture is
rejected. No command body, target or idempotency identity is invented. Each prepared
write can be clicked once. A failed/unknown outcome stops the condition, performs
a fresh authoritative UI read, and only closes live work owned by this run through
the real UI. Ambiguous cleanup remains a visible unfulfilled gate. Preexisting
active work is refused before any write. No driving/position warning is bypassed.

## Evidence

The V2 operator registers 56 random identities before any app IO: four preparation/background contexts, forty clock commands and twelve analytics groups (three readers for each five-pair window). This stays below the 64-active registration and 10,000-retained identity limits. Analytics response observations reference their group; aggregate backend groups are stored once, never duplicated or presented as per-request measurements. Numerical records include annual
response bytes/timing, clock response time, post-submit usable header readiness,
popover preparation time, actual overlap, HTTP outcomes and censored failures.
Native PostgreSQL query/row/acquisition, Cache Components hit/miss and event-loop
metrics are closed and force-flushed once after all commands, finite wire settlement and browser shutdown. There is no 500 ms native drain or metrics poll between analytics reads or clock commands. The reader loop advances as soon as each real response completes. The registered collector retains these finite groups through closure.
Missing coverage is null and fails completeness. CPU/RSS is explicitly unavailable
unless separately recorded by the parent operator; no zero is substituted.

Clock-in and clock-out each have a 20-attempt cohort. Completed-only p50/p95 is
labelled separately; a complete-cohort p95 is absent if any required attempt failed
or is missing. Every run writes a new private `mixed-load-<runId>.json`, including
failed preflight/capture conditions. Protected payloads, identities, SQL parameters
and credentials are never written. The CLI's success flag establishes protocol/
correctness/coverage only; `performanceBudgetsEvaluated: false` requires the parent
to compare original/head against its prospectively recorded release budgets.

## Parent-owned finite runs after C1

Use the same committed operator and fixture conditions for original and final
single-app artifacts. The parent owns existing app/collector sessions and fixture
authentication. The compiled artifact's BUILD_ID is read, and the live public
app-version source pin must match the supplied commit. No service is started here.

```text
pnpm --config.verifyDepsBeforeRun=false performance:mixed plan <private-fixture-directory>
pnpm --config.verifyDepsBeforeRun=false performance:mixed run <private-fixture-directory> <compiled-app-directory> <source-commit> --allow-fixture-writes --collector <collector-control.json>
```

Omitting `--collector` uses that fixture's `observer-v2/collector-control.json`.
Run original only after BOTH its frozen primary and settled companion captures finish, or use an explicitly authorized exact separate clone. Current-year clock writes change canonical fixture data; they must not precede those captures.
Current-year clock writes can invalidate annual derived caches; keep that real
effect in the observations. These are 20 clock pairs under mixed work, not 20
first-document and 20 Link samples. Native multi-instance, delayed ingress and
production/CDN gates retain their separate evidence and limitations.

## Shared actual header seam

`scripts/performance/public-header-clock.mjs` exports
`openPublicHeaderClock(page, { origin, expectedActor, timeoutMs: 30000 })` for the
existing authenticated Page. The caller retains replica/trace interception.
It verifies the real identity, online legacy capabilities and initial known
clocked-out state, then returns:

- `prepare("in" | "out")`: opens the actual header/popover and returns `submit()`.
  Start competing work after preparation, then submit once. The result contains
  numerical timing/status/unknown-outcome fields, never a protected response body.
- `resolveState()`: reloads, verifies identity and returns known `"in"`/`"out"`.
  A failed dispatched command must be resolved before another preparation.
- `state()` and `dispose()`: read the known rendered state and remove the status
  observer. The caller owns the Page, browser lifetime and explicit own-work cleanup.

The helper never retries a write or changes replica selection. #1472 can reuse it
for its separate real clock-under-analytics control, rather than duplicate a path
or fabricate timing from synthetic endpoints. Actual compiled execution of both
operators remains pending.

## V2 acceptance and preparation evidence

The separate file-only mixed-clock budget operator now uses policy metadata9,
with the unchanged nearest-rank clock-ready ceiling
`ceil(max(beforeP95 * 1.25, beforeP95 + 250ms, 500ms))`. Both independent run
contexts must declare the canonical five-field `conditions.nextStreamCompletionPatch`
from the [common validator](../../scripts/performance/next-stream-completion-patch.mjs).
Missing fields, aliases, different hashes and equal unknown objects fail before
derivation/comparison. The registration binds that validator's exact source hash
separately from the ten measuring modules and the budget operator's own hash;
HEAD must retain the same complete conditions and prospective source transition.
No actual mixed observation or budget registration is claimed by this preparation.
Analytics volume/query/cache observations remain descriptive, with no new gate.

Each fresh context uses the shared isolated-profile browser launcher and owned
HTTP proxy. Empty about:blank settles for the shared two-second initialization
before cookies, permissions or application IO. There is no request-interception
fallback. ServiceWorker and browser traffic pass through the same strict proxy;
later refusals, upstream failures, missing initialization, finite body loss,
unknown redirects, observation overflow or page exceptions fail completeness.
Prefetch and long-lived wire groups remain explicitly counted under the shared
policy.

The native epoch starts before the version check or browser launch and ends only
after every context closes. Actual independent driver calls, SDK started/ended
queries and collector-received queries must match exactly. Acquisition and native
cache totals also reconcile, every registered identity must have closed complete
proof, and missing/duplicate identities, unknown or late spans, rejected batches,
header/span mismatches and missing numerical fields fail. Before/after
numerical counters and registration closure are retained. Unknown values remain
null. Registration capacity cannot silently drop a request's identity.

The observer's own register/close/counter HTTP listener runs in the instrumented
Node process. Raw `incoming.otherHeaderOtherSpan` is therefore diagnostic, not
an unattributed native operation. A real control-only register/close/counters
run produced three such HTTP events with zero driver queries, SDK queries,
acquisitions, cache operations or unknown native spans. No fixed count is
subtracted. The mixed operator now also requires the shared
`reconcileCollectorRun` result. All exact native totals, trace closure, unknown
native, late spans and header/span mismatch checks remain mandatory. A regression
test first reproduced the overly strict rejection; 14 combined operator checks
now pass, including unknown query and fully closed extra cache work refusals.

Ten focused tests pass, including actual finite HTTP requests, real v2 collector
and native-control processes, one exporter flush after hot reads, independent
late driver-call loss, exact identity coverage and strict transport failures.
A deterministic microtask test guards against adding a timer throttle between
successful reads. These are operator protocol tests, not compiled application
or performance acceptance. No original/head app, browser, database or live mixed
write was exercised for this preparation checkpoint.
## Pending ordinary guard journal ownership

Ordinary stop-guard tokens retain an independently charged, immutable copy of
four complete return journals: header lifecycle, principal epoch, document
journal and worker targets. Two pending tokens in the same observer share that
copy only after exact whole projected JSON equality, including field presence
and order. Each token keeps its own charged control; changed journal versions
retain separate copies. The last token releases the shared copy. Full current
captures, source/semantic checks and Native prefix begin/end evidence remain
unchanged. No waits, sequencing or deadline changes are introduced.

The shared 32 MiB modeled operation pool, 10,000 typed-record limit, whole binary
4 MiB candidate representation and expanded logical 8 MiB limits remain strict.
These are modeled serialized-view/control reservations, not physical heap claims.
The pre-existing parent pools and all independent body, Native-context,
full-prefix, error and resource gates remain unchanged.

Fresh synthetic 700-request growth diagnostics completed 49 and 137 guards. The
additional 200-guard diagnostic **failed** after 175 completed guards, at guard
176: its parent reservation required `6496 + 3515 = 10011` typed records. That
capacity point remains failed. Its entire probe source and failure log are
preserved separately; its new diagnostic PASS-expectation row was removed from
the active test table, without changing the observer or quota. This diagnostic
is not a frozen benchmark acceptance gate or an assertion that all legal
workloads fit.

The actual Original run at source `4dc33af59` (capture
`3859790d4d6177f859673d416a77f6cf`, SHA-256
`34fa6a225850b69c8d25bde1db88848009ea725880cdc12c1bfac5d21b18e394`)
remains failed at 13 of 20 pairs. No timings or budgets come from these synthetic
diagnostics or failed runs. The complete actual 20-pair, 40-command workload must
still pass every strict gate independently on Original and HEAD before
qualification; previous failures are never retroactively qualified.
# Candidate representation failure acquisition

The failure-only serialization report can retain a fixed statement stage, inner
measurement stage and the first actual reservation refusal. It records nullable
integer owner/parent/request counts before cleanup; a pre-owner rejection keeps
counts unknown. It retains no input, lease, error, message, identifier or body.
Nested synchronous scopes restore their predecessor before publishing the existing
once-only report. Parent callbacks suspend the active representation scope while
preserving a separate exact reservation context for actual parent refusal counts;
direct nested encodes cannot become outer evidence. Successful reports and
portable bytes are unchanged.

The closed bookkeeping uses at most 64 scalar/reference slots and four fixed
records: a conservative modeled `64 * 128 + 4 * 256 = 9,216` bytes within the
existing 131,072-byte candidate evidence/codec control workspace. It adds no
reservation. Persistent output remains inside the existing 32,768-byte first
failure allowance. Separate reachable failure shapes measure at most 22,816 bytes;
their conservative scalar-width bound is 27,288 bytes, preserving null/presence
and mutually exclusive alternatives. The maximum hashed event projection with a
real representation rejection measures 22,944 bytes. This is modeled control and
serialized-view accounting, not a physical heap bound.

This is prospective acquisition, not a diagnosis or repair of the failed 18/20
Original capture. Its underlying representation rejection remains unknown. The
32 MiB shared owner, 10,000 typed records, 4 MiB whole portable and 8 MiB logical
limits, Native-context/full-prefix/body guards and canonical 20-pair/40-command
workload remain unchanged. No failed capture is retroactively qualified.

The normal production fixture supervisor now retains a safe integer exit code,
an allowlisted Node signal (or null/unknown) and the actual UTC observation time
in its existing nonzero-exit error message. Its original zero/null resolution,
error identity, once listeners and shutdown behavior remain unchanged. This is
prospective failed-supervision evidence only; it does not recover the previous
application exit, establish a resource/OOM/Chromium cause or qualify a failed run.

Normal `fixture start` can select an existing compiled app with one explicit
`--app-dir /absolute/app` argument. The custom app's manifest, BUILD_ID and Next
entrypoint are checked before collector configuration or log writes. A custom
directory cannot use `--build`; other commands reject the override. Omitting it
preserves the original application directory, build path, environment and guards.

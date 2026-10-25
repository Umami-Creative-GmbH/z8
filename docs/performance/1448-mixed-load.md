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

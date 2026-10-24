# Single-app mixed workload operator (#1475)

**Prepared; runtime acceptance pending.** No mixed workload, fixture mutation or
browser was run while original C1 capture was active. The two Node CLI safety
checks, JavaScript syntax checks and focused Biome check pass. Those checks do
not prove actual browser control, analytics totals or native telemetry.

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
clock dispatch and maximum user-request concurrency are recorded; zero overlap
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

Each request has a random correlation trace. Numerical records include annual
response bytes/timing, clock response time, post-submit usable header readiness,
popover preparation time, actual overlap, HTTP outcomes and censored failures.
Native PostgreSQL query/row/acquisition, Cache Components hit/miss and event-loop
metrics are collected per command before the collector's trace retention expires.
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
Run original only after its C1 samples finish, or use an exact separate clone.
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

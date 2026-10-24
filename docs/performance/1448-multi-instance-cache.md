# Multi-instance analytics cache (#1472)

The eight-stage results below are historical observations on source `4d8`.
A later audit found that the native observer compared the SDK SERVER span kind
against `2` (CLIENT), while the SDK value is `1`. OTLP's wire SERVER value `2` is
separate and remains correct. The retained outputs and counts are unchanged, but
the old successful reconciliation does not independently establish that every
server request span drained. Corrected-observer runtime acceptance is pending;
do not treat the old reports as final release proof.

Eight finite functional stages passed on the operator-owned two-replica fixture.
The immutable production artifact is application commit
`4d8bdb1d477cd02888565816b0fb96f85dc13b71`. The
[numerical evidence](evidence/1472-multi-instance-cache.json) contains 138
observations and 28,127 application database wire calls matched exactly to SDK
starts, SDK ends and received query spans. Earlier failed attempts remain failed.

This establishes local fixture behavior. Production topology/CDN access was
unavailable; the user explicitly authorized this local deployment. No controlled
route/clock p95, full JavaScript/Flight byte saving or production capacity benefit
is claimed. The later integration includes additional employee-lifecycle/schema
changes and needs its own final build and runtime release checks.

## Final artifact follow-up: prepared, runtime blocked

An offline comparison of source `4d8bdb1d477cd02888565816b0fb96f85dc13b71`
against compiled candidate `ac2fb11334b2fac88144dd405e39a15bd988d29c` found all
12 selected cache, admission, calculation and observer files byte-identical.
[The preparation record](evidence/1472-final-source-preparation.json) stores both
SHA256 values and the candidate artifact fingerprint. This is a selected-file
comparison, not proof that every transitive dependency or generated artifact is
equivalent. In particular, the observer bug exists in both versions.

After the application owner fixes the observer and the parent admits a new
immutable build, rerun the existing `fill`, `mutation` and `scope` stages
sequentially on the parent's `final-multi-instance-runtime` fixture. These cover
all three real callers, independent cold/warm reads on both replicas, two
organizations, manager scope, an accepted A write changing B before TTL,
unrelated tenant hits, scope reduction and denial before native get. Each stage
still requires exact independent native epochs and strict browser transport.
Use the newly admitted full source pin, rather than silently reusing `ac2`.

Historical expiry, stampede, outage, clock and restart results remain attached to
their original source and observer. This targeted smoke will not establish a new
eight-stage matrix or retroactively repair historical drain evidence. The parent
must decide any additional release reruns after admitting the observer fix.
During this preparation there were no HTTP, database or cache requests, no app
restarts, no new services and no changes to original or pristine fixtures.

## Observed deployment

The fixture uses two independent host Next.js 16.4.0 production processes behind
an owned Docker HAProxy 2.8 frontend at `http://localhost:50754`. PostgreSQL 16,
Valkey and object storage run in separately owned Docker containers. Each web
process retains its ten-connection database pool. Images and artifact manifest
hashes are recorded in the evidence; generated credentials and session data are
private. There is no CDN in this topology.

HAProxy supplies the actual server-name response header. A fixture-only request
header selects A or B and is stripped before application dispatch; unpinned
requests use round robin. Every measured replay verifies the actual response
header. Both processes share one read-only compiled artifact, with fixture-only
`experimental.isrFlushToDisk=false`. The installed Cache Components handler and
its 50 MiB default memory limit per process remain unchanged. Valkey is an
application dependency, not a configured shared Next.js cache backend.

The actual source/API pin and required-server-files SHA256 are checked in addition
to Next BUILD_ID, which is stable across these builds and is insufficient alone.
The artifact advertises public origin 58792; browser traffic is allowed only to
50754 and the exact owned storage origin. No unexpected origin is forwarded.
The pristine primary-timing clone and original application/database were excluded.

## Real caller results

Requests were captured from the actual annual UI controls and retained only in
memory. The same captured public Server Actions were exercised on both replicas
and under different effective sessions. Large-admin output was 200 employees /
417,600 hours, manager output 99 / 206,712, and the other organization 8 / 16,704.
Overtime contained 53 weeks with zero baseline overtime.

| Reader | Cold SQL / rows, per replica | Warm SQL / rows, per replica |
| --- | --- | --- |
| Work hours | 66 / 105,615 | 12 / 207 |
| Team performance | 66 / 105,615 | 12 / 207 |
| Overtime | 66 / 53,415 | 12 / 207 |

These are measured caller counts, including fresh admission and dependency
metadata. They are not route latency percentiles.

| Stage | Verified behavior |
| --- | --- |
| Fill | All three readers independently miss then hit on A and B; effective user, organization and manager scope remain distinct. |
| Accepted mutation | An actual public holiday DELETE served by A changes all three B readers before TTL; the other organization's A/B entries remain hits. |
| Scope | Manager membership changes 99 to 98 with exact returned IDs compared privately on B. Reporting-grant reduction changes the lookup; base-role reduction denies all three callers before native get. Scope and roles are restored. |
| Expiry | Each reader waits a real 62 seconds, then misses and repeats as a hit on both nodes. Hits do not renew the lifetime. |
| Concurrency | Eight requests per node require one computation per node: 150 SQL calls, matching one cold control plus seven warm admission paths. Results are equivalent. |
| Outage | Eight real A get faults use 96 SQL calls / 1,656 rows, with no raw recomputation fallback. B remains healthy; unauthorized callers never reach the failed handler. Removing the flag gives an immediate A hit. |
| Interactive clock | Twelve actual public clock-in/out commands succeed. All six loaded commands dispatch while analytics responses remain in flight; commands use zero derived-cache hits/misses. Authoritative cleanup leaves the synthetic user clocked out. |
| Restart | A parent-owned watcher replaces only A within the fixed window. A returns a cold 66-query result while B retains its 12-query hit before TTL. Separate native epochs handle A's reset counters. |

Holiday/category assignment and manager/custom-role changes used explicitly
identified synthetic fixture setup. The holiday CREATE and DELETE were actual
accepted HTTP commands. Canonical work records were never edited directly;
clock records were created/completed only through real public header controls.
All fault flags were removed, and fixture role/assignment setup was restored.

Clock usable-state observations were 145.56–622.42 ms for the six controls and
171.59–2,236.89 ms for the six loaded commands. These finite cases demonstrate
successful interaction, not a tail-latency comparison; the separate mixed-load
release experiment remains responsible for that claim.

## Backend and resource decision

Retain installed per-process memory for the observed topology. Fresh committed
revision keys made writes and scope reductions effective on the other instance
without a shared cache store or global tenant eviction. Concurrent fills were
bounded to two computations total, one per node. A failed cache read did not
produce a database surge, the other node remained usable, and process replacement
recovered correctly. The evidence does not justify adding a custom Redis handler.

The configured default Cache Components entry budget is 50 MiB per process,
100 MiB across these two replicas. Main-thread resource sampling observed whole
process RSS peaks of 1,875.2 MiB on A and 1,268.9 MiB on B. RSS/heap include
framework/worker memory and transient range processing; they do not isolate cache
allocation or establish a production capacity budget. Early fill/mutation heap
samples preceded worker isolation and are excluded from this resource decision.

The cache key includes `recent-analytics-v1`, organization, effective user/current
visibility, normalized request parameters and committed dependency revisions.
Authorization remains request-fresh before lookup. No authentication, clock,
billing or operational-approval lifetime was extended. A semantics change must
update the calculation version. There is no cross-build persisted Cache
Components store: replacing a process starts empty. Operator tests reject a
changed source pin, manifest digest or build ID before starting an app. The
fixture did not run two different application binaries alongside each other;
mixed-version rolling deployment remains unverified.

## Observation and retained failures

Each replica has an independent V2 collector/native control. Every prerequisite,
measured, background and cleanup trace is registered at both nodes before I/O.
Same-ID rows from the two collectors are retained separately and added, never
reduced to one matching row. Closing drains native work and flushes export. Each
accepted epoch requires exact per-node wire = SDK starts = SDK ends = all received
query totals, zero pending queries/active traces, and no lost, late or unattributed
work. Cache outcomes remain unknown during injected get errors; independent fault
counters prove that boundary.

The shared context proxy includes service-worker traffic; service workers stay
enabled. A fresh owned browser profile disables search prediction/suggestions and
Chrome Autofill server communication. Only a fresh empty `about:blank` context
may complete the prospective two-second quiet / ten-second capped initialization,
with zero application requests/bytes/cache warming. Startup refusals remain
recorded separately. Every post-initialization refusal or forwarding error fails;
total/startup/after counter arithmetic is checked.

Retained failures include the early zero-query adapter attempt, the pre-policy
fill with 10/10/14 refused requests, one mutation forwarding failure of unknown
historical cause, inactive external-hook attempts, and the manual restart whose
new process control appeared 54.249 seconds after ready, beyond the 45-second
window. No failed attempt is relabeled as a pass.

The external probe initially supplied the wrong argument to installed
`isBuiltInCacheHandler`, then exposed a second issue: inherited worker preloads
shared the PID and overwrote main-thread counters. A real worker regression
reproduced that overwrite. The corrected probe wraps the same native handler
object, runs only on the main thread and verifies current PID/thread ownership.
Real HTTP tests distinguish observed downstream cancellation from genuine
connection/response resets, including a reused GET socket. Canceled mandatory
bodies still censor full resource cost; no error-code-only ignore or retry was
introduced. The earlier mutation error did not recur and remains unexplained.

## Reproduction and ownership

All long-lived collectors, replicas and containers belong to the parent/operator.
Keep private dumps, cookies, manifests and logs out of public artifacts. Use a new
private directory and the exact compiled source commit:

```powershell
pnpm --config.verifyDepsBeforeRun=false performance:multi prepare <new-private> <candidate-private> <original-private> <compiled-app> <compiled-source>
pnpm --config.verifyDepsBeforeRun=false performance:multi migrate <new-private>
pnpm --config.verifyDepsBeforeRun=false performance:collector --port 0 --require-registration --observer-control <new-private>/observer-a/native-control-private.json --control <new-private>/observer-a/collector-control.json --out <new-private>/observer-a/backend-metrics.json
pnpm --config.verifyDepsBeforeRun=false performance:collector --port 0 --require-registration --observer-control <new-private>/observer-b/native-control-private.json --control <new-private>/observer-b/collector-control.json --out <new-private>/observer-b/backend-metrics.json
pnpm --config.verifyDepsBeforeRun=false performance:multi proxy <new-private>
pnpm --config.verifyDepsBeforeRun=false performance:multi replica <new-private> a
pnpm --config.verifyDepsBeforeRun=false performance:multi replica <new-private> b
pnpm --config.verifyDepsBeforeRun=false performance:multi authenticate <new-private>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs plan <new-private> <compiled-source>
```

Run each finite stage sequentially by replacing `plan` with `fill`, `mutation`,
`scope`, `concurrency`, `expiry`, `outage`, `interactive-clock`, then `restart`.
Keep other requests off both replicas during each global epoch. Pre-arm the
parent-owned restart watcher for a NEW ready handshake; it must replace only A
within 45 seconds while B, collectors and proxy remain unchanged. Do not extend
the test past TTL to manufacture a surviving warm hit.

Preparation copies only the existing guarded synthetic dump, never queries or
redumps the original, and restores into a new owned database. Migration verifies
actual Docker ownership/port/database and runs normal `migrate-with-lock.js` /
Drizzle pending migrations. It never runs a schema-resetting verifier. The frozen
4d8 fixture applied its original 0284 absence index; later integration renumbers
that index to 0288 after other migrations. New application histories use NEW
clones from the original dump; old frozen ledgers are not promoted. The parent
has prepared those separate latest-source fixtures.

Cleanup verifies every actual container label before removing only owned
containers, and runs only after the parent stops its retained processes. Existing
services remain available for the separate #1473 ingress checks.

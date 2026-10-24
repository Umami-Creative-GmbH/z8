# Multi-instance analytics cache (#1472)

All eight finite stages passed on the operator-owned two-replica fixture using
application source `e059597490b02c575c6e1cf64f1d83da712cff97`. The
[corrected-observer evidence](evidence/1472-corrected-observer-cache.json) records
139 observations, including one cleanup diagnostic, and 27,776 application database
wire calls matched exactly to SDK starts, SDK ends and received query spans.
Every accepted epoch closed on both replicas with no pending, late or unattributed
work. This is local functional acceptance, not a controlled timing comparison.

The user authorized a local deployment because production access was unavailable.
Production topology/CDN, capacity, mixed-version rollout, route/clock p95 and full
JavaScript/Flight savings remain unverified. A later employee-form fix requires
its own build and release checks; this evidence remains pinned to `e059`.

## Deployment and identity

Two independent host Next.js 16.4.0 production processes share a read-only compiled
artifact behind owned Docker HAProxy 2.8 at `http://localhost:50754`. PostgreSQL 16,
Valkey and object storage use separately owned Docker containers. Each web process
keeps its ten-connection pool. Fixture-only `experimental.isrFlushToDisk=false`
prevents shared artifact writes. The installed Cache Components handler retains
its default 50 MiB process memory budget per replica; Valkey remains an application
dependency, not a configured shared Next.js cache backend.

Each replay verifies HAProxy's actual instance response header. Source/API pin,
required-server-files SHA256 and Next BUILD_ID are checked together; BUILD_ID is
stable across builds and is insufficient alone. Browser traffic is allowed only
to the fixture origin and exact owned storage origin. Original, pristine primary
and SDK fixtures were excluded. Generated credentials, cookies, action bodies and
employee IDs stay private or in memory.

The corrected observer uses SDK `SpanKind.SERVER === 1` when counting active
request spans. Serialized OTLP SERVER remains 2 in the collector. All eight stages
were rerun on this corrected binary, rather than promoting the earlier observer's
results. The [preparation record](evidence/1472-corrected-observer-preparation.json)
contains source component comparisons and actual build fingerprints. Eleven of
12 selected files match the preceding `ac2` artifact; only native coverage changed.
This selected-file comparison does not establish transitive dependency equality.

## Actual caller results

Requests came from real annual UI controls and were captured only in memory.
The large administrator returned 200 employees/417600hours, the manager 99/206712,
and the other organization's administrator 8/16704. Overtime contained 53 weeks with
zero baseline overtime.

| Reader | Cold SQL / rows, per replica | Warm SQL / rows, per replica |
| --- | --- | --- |
| Work hours | 66 /105615 | 12 /207 |
| Team performance | 66 /105615 | 12 /207 |
| Overtime | 66 /53415 | 12 /207 |

These measured counts include fresh admission and dependency metadata; they are
not route latency percentiles.

| Stage | Observations | Native application queries A / B |
| --- | --- | --- |
| Fill | 30 | 2159 /1211 |
| Accepted mutation | 16 | 2554 /1627 |
| Scope | 21 | 1563 /1497 |
| Concurrency | 18 | 2475 /1554 |
| Expiry | 18 | 2133 /1392 |
| Outage | 7 | 823 /338 |
| Interactive clock | 25 | 3116 /4237 |
| Restart | 4 | pre603/416; post66/12 |

All three readers independently missed then hit on both nodes. An accepted public
holiday DELETE served by A changed all three B readers before 60 seconds; unrelated
organization entries remained hits on A and B. Synthetic holiday/category
assignment was explicit fixture setup, and setup rows were removed afterward.
Canonical work records were not rewritten directly.

Manager assignment reduction 99→98 compared actual returned IDs privately. Grant
reduction changed the lookup. Base-role reduction denied all three callers before
native get, then exact roles and assignments were restored. Each reader waited a
real 62 seconds and then missed and repeated as a hit on both nodes.

Eight concurrent requests per node used 150 SQL calls, matching one cold calculation
plus seven warm admission paths. Work/team returned 107064 rows per node; overtime
returned 54864. Results were equivalent, with one calculation per node, two total.

Eight real native-get failures on A used 96 SQL calls/1656rows without raw
recomputation. Cache outcomes stayed unknown during those errors. B retained its
12-query hit; an unauthorized request stopped before the failed handler. Removing
the fault flag immediately restored A's hit. Both fault flags were absent at release.

The accepted clock stage completed 12 real public header commands with known
outcomes. All six loaded commands dispatched while analytics HTTP was in flight,
and clock commands used zero derived-cache hits/misses. Authoritative cleanup
left the actor clocked out. Usable-state observations were 160.73–286.21ms for the
six controls and 176.47–2315.52ms under load. These finite observations do not
establish comparative p95. Completed synthetic clock work remains in the mutable
fixture; the pristine timing fixture was not used.

A parent-owned, pre-armed watcher replaced only A. Its new process returned a cold
66-query/105615-row result while B retained a 12-query/207-row hit before TTL.
Separate pre/post native epochs handled A's reset counters. No different-binary
rolling deployment was tested.

## Cleanup diagnosis and retained failures

The first corrected full clock run completed 12 known successful commands but
failed B's native closure. Its numerical report remains failed; detailed native
close proof had not yet been retained. The operator was then changed to preserve
that proof verbatim with elapsed time, without changing validation or forwarding.

A one-pair diagnostic reproduced the failure: the authoritative cleanup reload
returned while six finite HTTP responses remained pending. Closing the browser
then reached the native 10-second drain cap despite balanced query/acquisition/
cache counts and no unknown work. Balanced queries alone were insufficient.

The first drain correction exposed a second operator mistake in another full run:
an explicit prefetch error triggered immediate cleanup failure while finite
responses were still pending. That full run also remains failed, despite all 12
clock commands succeeding. Both original full failures and the failed diagnostic
are retained in the evidence.

The corrected operator always finishes already-started finite and explicit-header
prefetch responses before applying errors, with one-second quiet windows and a
fixed10-second cap. Mandatory errors and unfinished/capped work fail. Existing
explicit prefetch errors remain separately classified; no hostname or reset-code
ignore was added. Real HTTP tests prove the same cancellation is rejected when
mandatory and retained separately when an explicit prefetch header identifies it.
Both cases wait for other pending responses before cleanup continues.

The causal one-pair replay then passed with three explicit prefetch errors
retained, zero mandatory errors/pending work, and complete native/transport proof.
The final full clock run passed with two prefetch errors retained and no pending
prefetches. Every native request span still had to drain, and refused requests or
upstream failures still fail. The application and observer were unchanged during
these operator corrections.

Earlier source4d8 results remain in
[the historical evidence](evidence/1472-multi-instance-cache.json). Their numerical
outputs/counts are preserved, but the SDK-kind error means they do not independently
establish corrected SERVER-span drainage. They are not final release proof.

## Backend and resource decision

Retain installed per-process memory for this observed topology. Fresh committed
revision keys made A writes and reduced visibility effective on B without a
shared cache store. Concurrent computation stayed bounded, a failed cache read
produced no raw-query surge, and replacing A preserved B's warm entry. The evidence
does not justify a custom Redis handler or repurposing worker storage.

The configured entry budget is100 MiB across both processes. Whole-process peak
RSS was 2081.3MiB on A and 1684.8MiB on B, including intervening diagnostics. RSS/heap
include framework/workers and transient range processing; they do not isolate
cache allocation or establish production capacity.

Keys include `recent-analytics-v1`, organization, effective user/current visibility,
normalized request and committed dependency revisions. Authorization remains fresh
before lookup. Authentication, billing and operational clock lifetimes were not
extended. Semantic changes must update the calculation version. Process memory
has no persisted cross-build cache; actual different-source rollout remains untested.

## Reproduction and ownership

The parent owns all long-lived processes and containers. Use a fresh normal-schema
fixture and immutable artifact; do not promote an old migration ledger. Keep all
other A/B traffic out of each native epoch. From the operator worktree:

```powershell
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs plan <private-directory> <full-compiled-source>
```

Run sequentially by replacing `plan` with `fill`, `mutation`, `scope`, `concurrency`,
`expiry`, `outage`, `interactive-clock`, then `restart`. Stop on incomplete native
or strict transport evidence. `clock-diagnostic` is a one-pair causal diagnostic,
not a substitute for the full clock stage. Preserve failed reports before retry.

Before the final restart stage, the parent initializes a non-ready handshake and
pre-arms the verified A-only watcher. The stage writes a new ready handshake only
after its preceding native epoch closes. The watcher checks current PID, listener,
source and artifact command, then relaunches only A; B and collectors stay intact.
The operator never starts a retained app process itself.

All epochs and child browser contexts were closed before releasing the fixture.
Subsequent parent builds and runtime checks remain separate from this exact-source
functional acceptance. No ticket was closed automatically.

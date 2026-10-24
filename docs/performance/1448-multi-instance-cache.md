# Multi-instance analytics fixture (#1472)

Status: operator tooling prepared; runtime acceptance pending. No production
topology, shared-hit result, distributed invalidation result or resource benefit
has been inferred from example deployment files. The user authorized a local
Docker fixture because production is unavailable.

The configured topology is a loopback Docker HAProxy 2.8 frontend, two independent
host Next.js 16.4.0 production processes, and separately owned Docker PostgreSQL,
Valkey and object-storage containers. HAProxy supplies an actual server-name
response header. Fixture-only request headers select replica A or B for
deterministic checks and are stripped before application dispatch. Other requests
use round robin. No CDN is part of this local topology.

The existing native `use cache` handler remains process-local, with its original
50 MiB limit and sixty-second analytics expiry. Valkey is an application
dependency, not a shared Cache Components backend. The installed handler and
[Next.js documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers)
distinguish that cache from legacy `cacheHandler` configuration. Measure current
revision-key consistency and fill/resource costs before choosing shared storage.

Both host processes borrow one explicitly selected compiled artifact. Its actual
Next build ID and required-server-files manifest digest are
recorded and checked before each launch. Application source and compiled files
are not edited. The fixture-only runtime configuration disables
`experimental.isrFlushToDisk` so two processes do not write ISR data into the
shared artifact. Cache Components configuration and its handler identity remain
unchanged. This is an explicit fixture condition, not a production configuration
recommendation. A finite Docker curl check verified that host listeners bound to
`127.0.0.1` are reachable from this machine's Docker Desktop network.

Artifact path and source commit are explicit preparation inputs and frozen per
run. The original proposed `897b4077b` artifact predates the later #1455 layout SSO
repair and #1475 admission fixes. The expanded acceptance suite deliberately
requires a new run on the final compiled head, verifies its source ancestry, and
checks the actual app-version response from both replicas. The old artifact is
not a substitute for final ingress or admission acceptance.

`prepare` verifies the original synthetic container's ownership label and the
existing clone manifest, then copies its already-created pre-mutation dump. That
dump was made after all 208 genuine balance projections were initialized. It
neither queries nor dumps the original database again. Restoration and all later
probes use a new owned PostgreSQL container. Credentials, dumps, cookies, logs and
raw application responses stay in the operator's private directory.

Run from the #1472 worktree after the fixture owner releases the measurement
window. Replace the absolute private paths below with the operator's actual
paths. Long-running collector and replica commands must be launched and retained
by the parent/operator, not an implementer that will finish its turn.

```powershell
pnpm --config.verifyDepsBeforeRun=false performance:multi prepare <new-private-directory> <candidate-private-directory> <original-private-directory> <compiled-app-directory> <compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false performance:collector --port 0 --control <new-private-directory>/collector-control.json --out <new-private-directory>/backend-metrics.json
pnpm --config.verifyDepsBeforeRun=false performance:multi proxy <new-private-directory>
pnpm --config.verifyDepsBeforeRun=false performance:multi replica <new-private-directory> a
pnpm --config.verifyDepsBeforeRun=false performance:multi replica <new-private-directory> b
pnpm --config.verifyDepsBeforeRun=false performance:multi authenticate <new-private-directory>
pnpm --config.verifyDepsBeforeRun=false performance:multi:probe <new-private-directory> team
```

The collector and replica launches run in separate retained sessions. `prepare`
uses cached images only, generates loopback ports and records image identities;
`proxy` validates HAProxy configuration before starting it. The normal public
origin must remain `http://localhost:50754` when borrowing this compiled artifact.
Only numeric topology/launch summaries are printed. `multi-private.json`,
`services` fields, replica controls, numeric resource snapshots and private error
logs belong to this fixture. Cleanup verifies every actual container label before
removing only that manifest's containers; it preserves private files for explicit
operator handling and never stops unrelated host processes.

The prepared runtime harness captures a real annual analytics request from the
UI and keeps it in memory. Replays verify the proxy's actual selected replica and
collect native query/row/cache/pool/event-loop evidence. Notifications are denied
before navigation to prevent push onboarding from intercepting controls; other
permissions remain unchanged. The initial smoke expects an A hit, a first B miss
and a subsequent B hit with literal 200 employees / 417,600 hours. It must be run
against fresh processes; it has not run yet.

Remaining runtime gates: cross-replica accepted relevant write and subsequent
correct B output; manager/grant reduction and denial before handler access;
two-organization isolation; sixty-second expiry; bounded concurrent fills on
both replicas alongside a real clock interaction; native-get fault, recovery and
process/deployment restart behavior; a measured decision on retaining local
memory or adding the installed-version shared backend. The external fixture
preload supplies per-replica numeric memory/get/fault observations without cache
keys or manual framework-global initialization. No fault flag is created during
setup. Streaming through this actual proxy is a separate #1473 gate.

The expanded finite suite is prepared, with runtime acceptance still pending:

```powershell
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs plan <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs fill <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs mutation <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs scope <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs expiry <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs concurrency <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs interactive-clock <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs outage <new-private-directory> <final-compiled-source-commit>
pnpm --config.verifyDepsBeforeRun=false exec node scripts/performance/multi-instance-suite.mjs restart <new-private-directory> <final-compiled-source-commit>
```

Run stages sequentially against otherwise quiet owned services. No stage launches
an app process. `fill` forces a new source revision without changing business
values, proves independent A/B fills and repeats for all three readers, and reuses
the same captured request under two organizations and an assigned manager.
`mutation` creates a holiday through the actual API, seeds its synthetic
organization assignment, warms both replicas, then accepts its actual DELETE on
A. B must show the restored 417,600 expected hours before sixty seconds, and the
other organization's entries must remain hits. Fixture setup is explicitly
separate from the public HTTP write under test. Synthetic setup rows are removed
in `finally`; canonical work history is never edited directly.

`scope` removes one actual manager assignment, compares exact returned employee
IDs privately on B, reduces an additive reporting grant, and downgrades the
manager's base role. Denial must precede both native cache outcomes and observed
handler calls. It restores the exact assignment and roles. `expiry` waits two
real 31-second intervals per reader, then requires misses and subsequent hits on
both replicas. Hits do not renew the lifetime.

`concurrency` measures single cold and warm controls before eight simultaneous
requests per node. The declared limit is two native computations total per
reader, with SQL/row work no greater than one cold computation plus the additional
seven warm admission paths per replica. No cross-process shared hit is expected.
Numeric process snapshots report current and lifetime peak RSS/heap alongside
the configured 50 MiB cache limit per process. They do not isolate cache bytes
from the whole Node heap. A decision about keeping process-local memory remains
pending actual consistency, fill and resource observations.

`interactive-clock` reuses #1475's public header helper on an independent small
tenant. For each reader it runs a real clock-in/out control pair and a pair under
two-node cold load. It records whether analytics HTTP responses were still in
flight when the actual clock POST dispatched, verifies B's response header, and
requires native clock cache counts of zero. It records actual command/usable
state timings and censored outcomes without inventing a latency percentile from
these finite functional cases. It resolves uncertain writes before attempting
an explicit clock-out of its own synthetic session. This stage requires the
committed `public-header-clock.mjs` helper and final admission fixes.

`outage` exclusively creates A's fault flag, requires eight bounded retryable
errors without raw recomputation, checks healthy B and denial before the failed
handler, and removes only its own flag before recovery. Cache outcome coverage
can be unavailable during the injected get error; that is retained as unknown,
with actual fault counts proving the injected boundary. Other successful reads
require all five native coverage flags, no rejected batches and measured pool
acquisition duration.

`restart` publishes `restart-handshake.json` and a safe readiness line. Within 45
seconds the parent must stop only its retained A session and launch the same
`performance:multi replica ... a` command in a new retained session. The suite
requires a different actual PID, unchanged frozen source/build, healthy actual A,
a cold A read and a surviving B hit before TTL. It does not restart services
itself. Replacing the compiled build in place is rejected by the launch digest;
different-code rolling deployment remains a separate gate if a second compiled
artifact is introduced. Every completed stage saves only numerical summaries,
native telemetry and fixed operator labels in `multi-<stage>-metrics.json`.

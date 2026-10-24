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

Both host processes borrow the same existing compiled `897b4077b` artifact from
`wt-1467/apps/webapp`; it includes the #1467 cache core and fresh access/billing
guards. Its actual Next build ID and required-server-files manifest digest are
recorded and checked before each launch. Application source and compiled files
are not edited. The fixture-only runtime configuration disables
`experimental.isrFlushToDisk` so two processes do not write ISR data into the
shared artifact. Cache Components configuration and its handler identity remain
unchanged. This is an explicit fixture condition, not a production configuration
recommendation. A finite Docker curl check verified that host listeners bound to
`127.0.0.1` are reachable from this machine's Docker Desktop network.

Artifact path and source commit are explicit preparation inputs and frozen per
run. The borrowed `897b4077b` artifact predates the later #1455 authenticated-layout
SSO redirect repair. Its cache public-reader checks remain usable; protected
layout emission and final ingress checks must use a final compiled artifact that
includes that repair. No layout SSO-emission claim is made for the borrowed build.

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

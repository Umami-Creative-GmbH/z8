# Mounted clock query diagnostic

The existing public-header DOM evaluation now includes a read-only diagnostic of
the mounted clock query. It reports query and fetch status, invalidation, cached
employee/clock booleans, observer count and fetch-failure count. These fields do
not participate in DOM readiness, write acceptance, deadlines or command outcomes.
No mutation status is inferred: the clock hook has no exact mutation key.

The probe starts at the selected connected native button. It inspects at most 32
host properties and both React fiber ancestor paths, each bounded to 96 nodes.
Both paths must reach the same current root and exactly one matching function
provider/client plus immediate React context/value pair, with the same client on
both paths. Missing, ambiguous, detached or bounded-out state returns fixed UNKNOWN
metadata. Prototype method lookup is bounded to eight levels and ignores getters.

Only `getQueryState` for the fixed clock-status key, `getQueryCache().get` for its
fixed default hash, and `getObserversCount` are called. The query's state must be
the identical state returned by the client. The qualified application configures
no custom query hash. Scalars use own data descriptors; counts must be integers
between zero and 10,000. No cache enumeration, subscriptions, state updates,
refetches, requests or extra Page evaluations occur. No IDs, query data, keys,
timestamps or errors are returned. This is a closed-source diagnostic, not an
attestation mechanism for arbitrary JavaScript objects.

The existing parsed clock POST response also supplies separate server-only queued
field metadata: own-field presence, a fixed type and a boolean or null. An absent
field differs from a present `false`. This does not identify the hook's transformed
mutation result and does not affect the accepted-write check. It adds no response
or body read.

Rendered tests exercise the integrated callback with actual Original and HEAD
hooks, real ReactDOM/QueryClient and the installed Next FIFO modules. They cover a
held synthetic Dashboard head and the no-head control, and verify unchanged query
state identity, observer/cache counts, pending queue, action calls and writes.
They also cover missing/multiple providers, getters, scalar limits, fiber/host
bounds and detached state. Business transport remains mocked; JSDOM's absent
layout is supplied at its DOM rectangle boundary. These tests do not reproduce
the actual browser failure or prove an actual queued status invocation.

A separate production-mode ReactDOM/QueryClient smoke exercises the same callback
through idle OUT, fetching OUT, idle IN and detached UNKNOWN. It checks production
fiber availability, not the production application bundle. The existing mocked
public-observer suite checks queued-field privacy and unchanged success behavior.
No application source, benchmark workload or previous failed result changes.

Run the rendered diagnostic with the existing installed webapp dependencies and
`vitest.clock-mounted-query.config.ts`. When running outside the sibling owned
fixture layout, set test-only `Z8_CLOCK_ORIGINAL_APP` to the reviewed Original
webapp directory. This selects a test source fixture, never operational authority.
The production smoke requires `NODE_ENV=production`. Neither command starts a
service or browser.

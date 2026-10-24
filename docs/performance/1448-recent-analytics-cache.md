# Recent authorized analytics (#1467)

The work-hours, team-performance and overtime burn-down Server Actions use the
installed Next.js Cache Components implementation. Their existing bounded readers
remain callable without caching, including through a transaction-bound
`DatabaseService`. This change does not cache clock state, open breaks, approvals,
authentication or billing decisions.

## Request and cache boundaries

Every action first obtains the current session through `AuthService`, checks the
employee's current organization access (including a due departure), approved
membership and existing manager/admin admission rule. When billing is enabled,
the established billing service checks the current subscription with
`createTrialIfMissing: false`. A read cannot provision a trial. These checks run
before visibility queries and before a Cache Components lookup.

The request then reads the current permitted employee IDs using organization,
manager assignment and requested filters in SQL. The cache argument includes the
organization, effective user and actor employee, actual sorted visible employee
IDs, manager scope, normalized range, timezone, filters and calculation version.
Role alone never represents visibility. The three fixed cache functions call
`cacheLife({ stale: 0, revalidate: 60, expire: 60 })`; historical ranges have the
same maximum lifetime. The identity stage completes its shared-runtime run
before the cached function starts its own run.

The source probe returns an opaque digest and marker count. It combines source
family, primary key and PostgreSQL `xmin`, with sorted set membership. An update
with an unchanged `updated_at`, removal or row recreation therefore changes the
identity. These are short-lived MVCC revision tokens, not durable business
version numbers or timestamps. The probe never retrieves `work_period` history
and does not change captured records.

## Source ownership and immediate consistency

| Input | Revision owner read on every request |
| --- | --- |
| Completed work, correction, removal | Existing persistent `employee_work_balance` marker, written by `work-records/effects.ts` through `markEmployeeWorkBalanceDirty` in the canonical work transaction |
| Projection rebuild or dirty-flag clearing | Same retained marker row; its MVCC revision changes even after flags return to clean |
| Tracking boundary | Organization and visible employee tracking settings |
| Employment | Visible employee employment periods and confirmed/history term rows |
| Absence | Visible employee absence rows and organization categories, including status and removals |
| Work policy | Organization policies, applicable assignments, schedule and schedule-day children |
| Shift | Visible employee shifts |
| Holiday | Organization holiday/category/preset rows, preset days and applicable direct/category/preset assignments |
| Labels and filter membership | Employee/user/settings, team, manager relationships and manager labels; cost centers and employee assignments |
| Access and scope | Fresh session, eligible actor, approved membership, role, current employee roster and manager assignments; custom role definitions, grants and actor assignments also version results |

Source revisions take effect after commit, before the next cache lookup. No
pre-commit tag race or TTL wait is needed. A transaction-bound reader still sees
its own writes through the uncached existing service. Organization-local source
writes do not change another organization's dependency digest. Shared reference
tables are restricted to the organization; personal rows are restricted to the
visible employees. Some reference changes conservatively invalidate more than
one range in that organization.

Removing a fixture-only input can restore exactly a previously cached complete
source set. Reusing that entry is valid when the full dependencies and literal
outputs match. This differs from clearing a work marker's dirty flags: canonical
work may have changed, so the persistent marker revision must continue to change
across rebuilding. Tests distinguish those cases.

Missing or deleted work markers **bypass caching**. Empty scopes also bypass.
Caching starts only when every visible employee has a real marker. Deleting a
marker cannot resurrect an old unversioned entry; recreating it changes row ID
and MVCC revision. Tests cover dirty → actual full projection refresh → clean →
delete → recreate and transaction rollback. No projection amount supplies an
analytics result. Existing raw elapsed chart flooring and protected tracked
balance calculations remain in the readers.

The existing tracking refresh helper additionally expires the organization tag
with `revalidateTag(tag, { expire: 0 })`. Unused legacy `unstable_cache` helpers,
long historical lifetimes and global analytics tags were removed. Other legacy
reference cache families in `query-cache.ts` retain their existing owners.

## Functional runtime evidence

The parent-owned production build `df73d9b93` ran against a separate disposable
PostgreSQL clone and Redis instance on a loopback origin. Both fixture
organizations had real projections initialized through
`refreshEmployeeWorkBalanceFromPeriods({ forceFullRebuild: true })` for all 208
synthetic employees before cloning. The large organization has 200 employees,
confirmed forty-hour terms, tracking active from January 2025 and 2,088 completed
hours per employee in 2025. Its literal annual total is 417,600 hours. The small
organization has eight employees.

The native observer measures actual driver queries, returned rows and the
installed Cache Components handler. UI navigation selected Last Year; isolated
requests replayed that UI's actual Server Action request in memory with the same
synthetic session. Cookies, raw request bodies, IDs and returned records were
never persisted in evidence. All reported traces had observer, PostgreSQL,
returned-row, cache and event-loop coverage, with zero rejected batches.

| Functional condition | Queries | Returned rows | Cache outcome |
| --- | ---: | ---: | --- |
| Work-hours UI cold, including default month and selected year | 302 | 106,906 | 2 misses |
| Identical work-hours UI repeat within lifetime | 194 | 490 | 2 hits |
| Work-hours UI after more than sixty seconds | 302 | 106,906 | 2 misses |
| Isolated identical annual action, each of all three readers | 12 | 207 | 1 hit |
| Annual work-hours after accepted canonical one-hour correction | 66 | 105,615 | 1 miss |
| Eight concurrent requests during native cache-read failure | 96 total | 1,656 total | 8 injected failures; no raw recomputation |
| Unauthorized actor while cache handler fails | 10 | 6 | Denied before handler; 0 additional cache calls |
| Immediate recovery of the warm annual work-hours entry | 12 | 207 | 1 hit |

The accepted canonical correction changed work-hours to 417,599 hours and one
hour of undertime; team performance changed to 417,599 hours and minus one hour
variance. Restoring it through another accepted correction restored the literal
totals, with a new miss followed by a hit. These checks use the existing canonical
work command, not direct edits to canonical work rows.

Twenty warm identity-only samples used exactly two queries. The one-person scope
had p50/p95 2.91/3.20 ms; the 200-person scope had p50/p95 14.73/15.54 ms. These
samples exclude authentication and layout work. They quantify dependency-probe
cost, not route readiness or a statistical end-user speedup. The full UI's warm
194 queries include authentication, header and sidebar work and must not be
described as cache metadata overhead.

Cache outage was injected in an external fixture-only preload wrapping the same
native handler object's `get` method after Next initialized AsyncLocalStorage.
No framework global was initialized manually and no handler identity was
replaced. The flag was removed after the probe. The action returned a retryable
`ExternalServiceError`; it did not silently run the underlying calculation for
each failed cache request. The observer's hit/miss counters remain zero when the
injected exception occurs before their healthy outcome; a separate numeric fault
counter verified eight actual handler failures. All processes and fault settings
were controlled by the parent fixture owner.

The updated production build `897b4077b` includes the fresh billing and
due-departure repairs. Its separate mutation clone passed these actual-caller
checks for all three readers. Each changed result was followed by an identical
warm hit, and each routine A-only mutation retained a known fresh B entry.

| Synthetic committed input | Work-hours total / overtime | Team expected / variance | Overtime weekly-series total |
| --- | --- | --- | --- |
| Approved half-day sick absence | 417,600 / 4 | 417,596 / +4 | 4 |
| One employee tracking starts January 2 | 417,600 / 0 | 417,592 / 0 | 0 |
| One employee confirmed terms change from forty to twenty hours weekly | 417,600 / 1,044 | 416,556 / +1,044 | 1,036 |
| Public holiday POST, not yet assigned | 417,600 / 0 | 417,600 / 0 | 0 |
| Holiday assigned to the whole organization | 417,600 / 1,600 | 416,000 / +1,600 | 1,600 |
| Public holiday DELETE | 417,600 / 0 | 417,600 / 0 | 0 |

The different tracking and partial-week totals preserve existing reader
semantics. Displayed raw elapsed hours and protected tracked work used for
variance remain distinct, so the tracking case correctly has zero variance even
though the raw total exceeds required hours. The earlier `df73d9b93`
policy probes also verified that changing a schedule's hours from forty to
thirty-five does not override confirmed forty-hour terms, although it versions
the entry. Changing its working-day preset to weekends instead produced
work-hours overtime 1,600, team expected 416,000 / variance +1,600 and overtime
weekly-series zero. Restoring every case restored the literal baseline.

On `897b4077b`, eight concurrent identical action requests after a new source key used
150 queries and returned 107,064 rows total, with identical 417,600-hour results.
That is eight fresh 12-query request checks plus one 54-query calculation. The
native handler recorded one miss and two hits; other requests shared the
framework's pending work before reaching the native handler. This is observed
single-process fill deduplication, not a cross-instance guarantee.

The real visible header refresh after an accepted canonical correction showed
all 200 table rows totaling 417,599 hours before the verification replay ran.
Restoration showed 417,600 immediately. Both refresh traces recorded one miss;
the subsequent isolated checks hit. The initial refresh trace used 243 queries /
105,695 returned rows, and restoration used 230 / 105,691, including layout work.
An earlier multi-browser diagnostic had zero dispatched actions because push
onboarding intercepted the control; explicit notification denial removed that
fixture interference. It is not evidence of an application refresh regression.

Manager runtime checks compared exact employee IDs in memory. Removing one
assignment changed all three readers from the current 99-person scope to 98,
with a new miss followed by a hit; restoration returned 99. Custom Report grant
addition, removal and restoration also versioned all readers while preserving
the existing manager scope. Downgrading the base employee role denied all three
before cache lookup even while the additive Report grant remained. Replaying
one actual action with large-admin, small-admin and large-manager sessions
returned the literal 200 / 417,600, 8 / 16,704 and 99 / 206,712 employee/hour
results, respectively.

All three `897b4077b` readers independently passed hit → wait 62 seconds → miss
→ hit with identical output and complete native-observer coverage. Each warm
request used 12 queries / 207 rows. Expired work-hours and team requests used
66 / 105,615; expired overtime used 66 / 53,415. No source mutation occurred
during that expiry check.

Warm-result revocation probes also passed on the updated binary. Revoked
membership returned `AuthenticationError` (10 queries / 2 rows), a valid due
departure returned `NotFoundError` (9 / 4), and an inactive actor returned
`AuthenticationError` (10 / 3). All three had zero cache hits and misses: rejection
preceded lookup. Membership revocation and deactivation invalidate the session
through existing authentication behavior; after restoring each fixture fact,
the helper signed in and activated the organization through the real API before
warming the next independent case. It did not treat a dead session as proof of
the next guard.

A parent-controlled enabled-billing runtime variant used the same compiled
`897b4077b` artifact, with billing enabled only in that child process and no
Stripe keys. Existing local-trial/configuration helpers initialized temporary
active subscriptions after an exact private backup. With the annual team result
warm, changing the subscription to past due returned `BillingError`, using
11 queries / 7 rows and zero cache hits or misses. Restoring active status
immediately reused the valid result: 13 queries / 208 rows, one hit and the
literal 417,600 hours. The exact original subscription rows were restored under
the existing organization configuration guard, all browser contexts closed, and
the fixture owner resumed the normal disabled-billing launcher. The private
normal runtime configuration was never changed to enable billing.

[The numerical evidence](evidence/1448-recent-analytics-cache.json) retains 170
reviewed observations with trace IDs, literal summaries, query/row counts,
native hit/miss outcomes and complete coverage. It contains no session cookies,
request bodies, employee/organization IDs, records or credentials. The two build
identities distinguish the first cache implementation from the later fresh
billing/eligibility repairs. An initial browser launch closed before the billing
probe and supplied no observation; the subsequent complete finite probe passed.

## Reproduction and remaining deployment work

Run the six affected integration suites in a guarded disposable PostgreSQL
database: `recent-cache`, `work-hours-range`, `team-performance-range`,
`overtime-range`, `tracked-work` and `tracking-start`. They currently pass 75
tests. The recent-cache suite exercises source revisions, rollback, marker
lifecycle, manager/custom-role reduction, membership revocation, billing
revocation without trial creation and actor eligibility through actual public
actions. It does not mock a framework cache to claim a hit.

For a compiled check, use the authenticated performance fixture and native
observer described in `authenticated-baseline.md`. Initialize genuine employee
projections first and record that fixture condition. Visit each analytics page,
select Last Year, verify literal totals, repeat within sixty seconds, then repeat
after more than sixty seconds. Give each measured request a fresh trace. For a
mutation probe, use a separately cloned fixture and restore through accepted
commands where available. Use only numeric telemetry and synthetic output
assertions. Explicitly deny browser notifications before navigation to prevent
push onboarding from intercepting header controls; leave other permissions
unchanged.

An unrelated-tenant survival check must initialize a **known fresh** B key before
writing only A. Touching an existing hit does not renew its fixed lifetime and
can make a legitimate expiry look like cross-tenant invalidation. A no-op update
of B's synthetic user row followed by a miss creates that controlled starting
condition. It is setup, not the write under test.

The installed default Cache Components handler is process-local memory. Existing
Redis usage and a legacy `cacheHandler` setting do not configure shared storage
for these `"use cache"` functions. #1472 must verify the actual replica/proxy
topology and installed-version `cacheHandlers` integration. A shared backend
must retain the maximum lifetime, consistent deployment/function versions,
bounded concurrent fills, stream-safe get/set semantics and tested outage and
recovery behavior. Source-version keys already prevent another instance from
using a pre-mutation result when it reads current committed dependency revisions;
fresh authoritative source reads remain a prerequisite. Shared hits and
cross-instance stampede control are not claimed here.

These are functional and structural measurements, separate from the controlled
before/after latency cohorts owned by #1448. The mutation clone accumulates audit
history even when business totals are restored and must be re-cloned before an
identical-workload timing comparison. No throughput or p95 route-speed claim is
made from these samples.

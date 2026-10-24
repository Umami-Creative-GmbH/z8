# Employee detail reference selectors (#1462)

## Production consumer and cache scope

The manager and work-policy branches of the employee GET transport now call
`lib/organization/employee-detail-selectors.ts`. That server-only module uses the
current Cache Components `use cache` directive. Both cached functions explicitly
set `stale: 0`, `revalidate: 299` and `expire: 300` seconds. This is a server cache
whose arguments isolate viewers and organizations; it does not use the private
cache directive or cache an authentication result.

Every call runs the existing employee-settings actor resolver before looking in
the cache. The GET handler retains its fresh settings, MFA/SSO, billing and
expected-scope checks, including a session-scope check before the response. The
cache receives only serializable user ID, organization ID, access tier, effective
manager ID, selector filters/exclusion/limit and a source revision. Sessions,
abilities, headers, service instances and operational employee detail are absent
from cache inputs and outputs.

Manager choices reuse the existing employee filter and sort expressions, with
the current roster, admin/manager roles, target exclusion and limit of 1000.
Manager visibility uses the existing direct assignment rule. The cached DTO has
only employee ID, user ID and the name/email/image fields used by the selector.
Policy choices retain the existing active-organization policy rule and return
only ID and name, without schedules, regulation or other nested details.

## Freshness across every writer

Before each cache lookup, a PostgreSQL aggregate computes a scoped source
revision. For managers it hashes the ordered eligible employee IDs and employee
and user `xmin` values. The aggregate uses the same organization, manager scope,
roster, role and exclusion predicates as the choice read. Policy revisions hash
the active policy IDs and their `xmin` values for that organization.

Consequently an accepted field/role/lifecycle/policy change uses a new entry on
the next read. Inserts, removals and updates that preserve `updatedAt` also change
the revision. The eligible-set predicate is evaluated at database request time,
so a departure taking effect changes the version even before a lifecycle worker
changes the employee row. A manager assignment reduction changes the eligible
set. Losing settings access is refused before any cache lookup.

This versions the data from committed source rows instead of relying on every
API, import, SCIM hook and worker to send an invalidation notification. It avoids
a pre-commit invalidation racing a cache fill and never marks unrelated
organizations stale. No authentication, canonical command or operational detail
is placed in this cache. Each request still pays for fresh authorization and one
organization-scoped source-revision aggregate; a hit avoids the selector row/detail query.

The client includes access tier in manager-choice keys and stops returning
administrator choices immediately after a tier reduction. Policy-choice keys
are descendants of the existing organization policy-list key, so accepted policy
UI mutations invalidate them through their existing owner. Both selectors
revalidate on a return visit; GETs can then reuse the server cache. Existing
manual refresh and mutation invalidation remain the sole owners of their reads.
The form, selected managers, error/retry behavior and SuperJSON boundary are
unchanged.

## Evidence on 2026-10-24

A finite read-only probe used the actual pre-change candidate `897` production
server with the stable small-organization administrator. It did not touch the
original baseline, change fixture data, open a browser or change services. Each
request had an independent trace and complete PostgreSQL/native-cache observer
coverage. The two manager GETs each executed 46 SQL statements and returned 24
rows, taking about 64 and 54 ms. The two policy GETs each executed 48 statements
and returned 23 rows, taking about 60 and 53 ms. All four recorded zero native
cache hits and misses. Serialized JSON lengths were 626 and 198 characters. These
are isolated HTTP observations, not controlled browser readiness results.

The public PostgreSQL GET suite now covers minimal DTOs, accepted employee-name
and policy-name changes, current manager assignment reduction, privilege loss,
organization switching, another organization's unchanged choices, external
deactivation and policy deletion with unchanged update timestamps, and a departure
becoming due without a worker write. Together with the existing selectable-reader
suite, 36 tests pass. The focused provider/page/form/work-policy suite passes 97
tests, including a red-to-green same-viewer role-reduction case. Full TypeScript
checking passes.
React Doctor changed-code checking reports no findings. The change preserves the
existing form and selection components; no new UI or accessibility behavior is
introduced beyond removing choices after access reduction.

Vitest does not compile `use cache`. Its PostgreSQL suite stubs only `cacheLife`
request infrastructure and deliberately makes no cache-hit or expiry claim.
The actual compiled Next cache remains the required acceptance seam. The
controller's next integrated fixture must verify a cold miss and warm hit for
both GETs, a blocking fresh read after the 300-second maximum lifetime, accepted
mutation read-your-writes, organization B staying warm after an organization A
mutation, and privilege/assignment reduction after a broader entry was warm.
Record query counts, native cache coverage and response/readiness measurements
there. Keep #1462 open until those compiled-runtime checks and the final spec
review pass. The source and deterministic tests alone do not close these gates.

# Dashboard team and approval delivery

Issue [#1457](https://github.com/Umami-Creative-GmbH/z8/issues/1457), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

Managed Employees, Team Overview, Pending Approvals and Recently Approved now
join the working Dashboard server slots and scoped GET refresh interface from
[#1456](1448-dashboard-foundation.md). Their visible reads start independently
after the saved layout is resolved. A slow or failed read has its own slot and
retry. The existing grid, employee links, inbox links, row limits, order and
approval labels remain in place. Managed employee presence still uses its
existing live presence query.

Initial reads use the trusted render identity. GET retries resolve authorization
again, verify expected user/organization scope and retain the private, no-store
response policy. Missing or inconsistent employee scope fails instead of returning
invented empty data. Organization statistics retain their existing manager/admin
display rule. Assigned approvals and direct reports do not gain a new base-role
restriction: the existing recipient and manager-link readers remain authoritative.

The pending reader shares the original approval query, including self-request
exclusion and orphan-correction filtering. Its Dashboard DTO selects only names,
absence calendar dates/categories and the work-period start instant. The recent
reader retains historical organization employees, its approved status filter,
descending update order and ten-request limit. It now resolves the action's
employee in the active organization and explicitly filters approval requests by
that organization. Neither approval reader has a shared cross-request cache.

Date-bearing database values are converted explicitly to UTC ISO strings at the
DTO boundary. Existing date formatters accept ISO strings, so clients do not
pretend JSON strings are Date objects or perform a second implicit revival. The
recent DTO explicitly selects the two displayed names, omitting unrelated employee
records and their nested dates. The established action wrapper retains its
Date-bearing result for other callers.

The shared hook suppresses mount refetch when a valid initial snapshot exists,
including a snapshot older than the client stale-time window after slow streaming.
Showing an unbootstrapped widget still performs its GET. Local retries use GET;
global refresh remains owned by router/RSC through the existing query metadata.
New server snapshots replace earlier client snapshots using server timestamps.

## Caller and database evidence

- The initial rendered test failed before migration: the four widgets ignored
  delivered snapshots and showed their hydration loaders. It now renders their
  real names, counts, approval dates and inbox links with no initial dataset GET.
- With a real QueryClient and fetch boundary, each widget can be retried while
  its request is held and then fails. All three siblings remain usable. Retrying
  again replaces the error with real content and sends only that widget's two
  explicitly requested GETs. Scope replacement hides previous-organization data;
  reducing the base role hides organization statistics immediately.
- A deliberately old initial snapshot reproduced an extra mount GET before the
  hook fix. The passing case keeps the delivered content without that request.
- Actual React server-stream tests exercise both orders of completion for the
  team pair and approval pair, alongside the original foundation pair.
- PostgreSQL snapshots preserve current manager reports and current-roster counts
  and average hours, including exclusions for deactivated and departed employees.
  The manager snapshot succeeds without reacquiring a session.
- PostgreSQL approval cases exercise assigned recipients, self-request exclusion,
  another organization, a caller with profiles in two organizations, Date-to-JSON
  round trips and the immediately following read after a status change. An
  employee base role retains its assigned pending work while organization counts
  are withheld. Invalid employee scope fails closed.

## Remaining integration gates

Production builds, authenticated browser manager/restricted-role journeys,
drag/scroll preservation, clock controls under held/failed widget requests, and
cold/warm request/byte/paint measurements remain owned by the parent spec run.
These caller and database checks do not claim measured browser performance gains.

The broad approval ownership inventory test
`src/lib/approvals/approval-write-boundary.test.ts` fails its full production scan
with `Approval write boundary production file-count limit exceeded: 4096.`
The #1457 starting integration commit `7606bc177` already contains 4,101 source
files under that scanner's production path/suffix rules. This establishes ticket
baseline inheritance, not inheritance from the whole spec's original baseline.
The parent must resolve the scan before completing #1448; this ticket does not
widen or bypass its safety limits. No approval writer moved or changed here.

Final focused checks: 26 unit files / 147 tests passed; the three PostgreSQL
suites passed (with the active-organization action case added to final validation).
All typecheck projects passed before integration merge. Changed-source Biome
checks pass; the two untouched legacy Luxon min/max warnings in `actions.ts`
remain. React Doctor against the #1457 integration base reports 93/100 with no new
issues. Final post-merge results are recorded in the implementer handoff.

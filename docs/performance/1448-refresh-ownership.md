# Refresh ownership (#1471)

## Owners

The migrated Dashboard server groups, layout preferences and initial employee
detail are owned by their server snapshots. Active deferred Dashboard widgets
and employee schedule/history/manager/policy datasets are owned by TanStack
Query. An unopened deferred widget has no reader. Existing SWR and registered
custom readers continue participating in explicit refresh.

The refresh provider cancels old local retries for server-owned snapshots and
starts the route refresh before waiting for independent client/custom work.
Manual refresh shares an already-active client request instead of canceling it
and starting the same dataset again. Mutation invalidation retains its separate
fresh-read behavior where an accepted write makes an older request obsolete.

Client refresh waits for every sibling before reporting failures. Previously a
single failed query rejected the combined refetch promise early, ending the
header's busy feedback while another dataset was still pending. Failures are
now checked after all client reads finish. Local read errors remain local, the
header keeps its pending/offline/error feedback, and an operation finishing
after navigation does not display a stale refresh error on the new view. The
route is refreshed only if the original URL still matches when dispatch begins.
No route key, hard reload, scroll reset or draft reset is introduced.

## Settings saves

Notification channel configuration is server-owned. A successful save refreshes
that server configuration without invalidating every client query. The public
action receives only its settings argument, rather than TanStack's internal
mutation context as a second argument. A confirmed save resets the form's
baseline to the accepted submitted values; refusals and transport failures keep
the edits and do not claim success or dispatch a refresh.

Surcharge model create/update invalidation targets the affected organization
model catalog, the edited model and relevant organization assignment labels.
It does not restart Dashboard reads or another organization's models. The
catalog and assignment selector now share the existing canonical organization
model key through one query definition. This replaces the catalog's separate
custom read and the selector's unrelated literal key. Accepted saves cause one
immediate catalog reread, without waiting for its short reference-data stale
time. Existing model/assignment/report business actions and authorization stay
with their current owners.

The catalog remains mounted during background reads, preserving tabs, selection
and form state. A failed read keeps existing content with an alert and retry;
an initial failure is not presented as a successful empty catalog. Model save
callbacks retain their submitted organization/model identity. An older save
finishing after another form is selected does not close the newly selected form.

## Focused evidence and outstanding gates

Tests use the approved public refresh/provider seam with real QueryClient, SWR,
fetch, actual deferred Hydration activation and the employee hook. Only network,
public mutation and router boundaries are controlled. They establish:

- An in-flight job/status read is shared: two total reads rather than three.
- Server refresh dispatch is independent of a held custom reader.
- The twelve server widget datasets, Dashboard layout and initial employee
  detail issue no extra client GET on header refresh. Activated Hydration and
  the four employee auxiliary datasets each issue one GET. Unopened birthdays
  issue none.
- A failed history GET does not hide the employee or successful siblings.
  Pending feedback continues until a held schedule GET finishes. Fresh server
  props preserve the employee draft and widget order.
- Real notification and surcharge forms exercise accepted saves, refusals,
  transport failures, immediate reread, partial failure/retry and form switching.
  Unrelated organization and Dashboard reads stay warm. The catalog and selector
  share one model request.

The focused suites pass. Existing provider tests also retain SWR/custom refresh,
offline, repeated-click and navigation coverage. These are structural/UI caller
checks, not production timing or PostgreSQL query-count claims.

The controller's C1 baseline capture was active during this slice. Per controller
coordination, TypeScript, React Doctor and broad integration checks are explicitly
**PENDING** for the post-capture integrated gate. Production-mode Dashboard and
employee save/manual-refresh/partial-failure/navigation journeys still need
request and query evidence from that gate. No runtime service, fixture data,
collector, original baseline or candidate environment was changed here. Keep
#1471 open until those checks and the final spec review pass.

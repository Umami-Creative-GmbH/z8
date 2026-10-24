# Dashboard server delivery foundation

Issue [#1456](https://github.com/Umami-Creative-GmbH/z8/issues/1456), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The Dashboard now obtains saved widget visibility and order from the render-local
user settings read before starting visible Manager Today and Quick Stats reads.
Both readers start together. Each slot has its own Suspense fallback and receives
its own success or failure snapshot. The existing client grid still owns
customization, drag order and visibility; other widget components remain compatible
with the existing mapping. The customization header waits for the grid's scoped
bootstrap, including when it hydrates before the grid's server chunk.

The readers accept only a server-owned subject. Initial reads use the shared
render authorization context. Local retries use `/api/dashboard/widgets/[widget]`,
which resolves fresh canonical authorization, checks eligible employee membership,
compares expected user/organization headers and enforces enabled billing. The
headers detect replaced scope and cannot authorize a read. Layout fallback uses
the same authorization through `/api/dashboard/layout`. Responses are private and
not cached. Mutations still resolve fresh authentication; layout writes also
reject a replaced expected scope.

## Working migration interface

`DashboardWidgetData` and `SERVER_WIDGET_IDS` describe only the two working
consumers. A later widget migration adds its explicit DTO and reader, its server
slot renderer, and switches its client component to `useDashboardWidget`. Existing
legacy widgets continue to render without joining this transport. Hidden widgets
do not start server reads; showing a previously hidden widget can use its scoped
client GET before a later server refresh supplies its slot.

Snapshots contain user/organization scope, a result and the server's observed-at
timestamp. The query key includes dataset, user and organization. Query hydration
uses that timestamp. A newer RSC snapshot is compared against the embedded server
timestamp, rather than the browser's `dataUpdatedAt`, so clock skew cannot suppress
it. Accepting it cancels previous local work. Failed reads remain visible with a
local retry and do not render invented zero counts. A shared role reduction hides
cached Manager Today content immediately.

These two DTOs contain only numbers, strings and null. Plain JSON is intentional.
Later migrations must define JSON-safe DTOs for date-bearing action results, or
explicitly serialize and revive their dates. Casting a JSON response to an old
Date-bearing action type is not this interface's contract.

Queries marked `meta.viewRefresh = "server"` have one global refresh owner: the
RSC route. `ViewRefreshProvider` cancels their pending GETs and excludes them from
query invalidation before `router.refresh()`. Local retry still performs one GET.
Other queries, SWR and manual refresh participants retain their existing behavior.
The RSC merge retains the grid subtree, draft inputs and scroll state. Pending
optimistic layout changes are retained until their scoped mutation settles; its
server acknowledgment timestamp prevents an older server layout from rolling
back a successful edit.

Quick Stats calculation code was moved without changing its established tracking
window, work policy, holiday or legacy Luxon semantics. This ticket adds no new
Date-based business rules; snapshot freshness uses the shared Temporal clock.

## Evidence and remaining gates

- The old server-render regression failed with only the hydration skeleton. The
  new initial layout/slot case renders useful content before client hydration.
- A real React server stream releases either completed slot while the other
  reader remains deliberately pending. No application-wide cache mock is used.
- Actual Manager Today/Quick Stats rendering with a real QueryClient keeps
  successful manager counts visible through a held and failed Quick Stats GET;
  its local retry fetches only Quick Stats. Server-snapshot hydration performs no
  initial action or GET read.
- Real provider/render tests cover a successful local retry, a second held GET,
  global refresh, a newer RSC snapshot with the client cache clock one day ahead,
  late old-request completion, and preservation of an unsaved input. The failing
  implementation issued a third duplicate GET; the corrected version issues only
  the two explicitly requested local retries.
- Layout caller tests cover header-before-grid hydration with zero initial
  settings GETs and customization surviving a newer server merge while saving.
- GET handler tests exercise fresh authorization, changed identity/organization,
  ineligible employee access, enabled billing and independent pending requests.
- The original PostgreSQL suite exercises the extracted calculation through both
  the action and snapshot seam, saved layout projection, JSON-safe DTOs and tenant
  isolation. All seven cases pass on the approved disposable database.
- Dashboard/refresh unit selection: 24 files, 108 tests passed. The existing
  Cache Components route contract: 198 tests passed. Typecheck passed before the
  final formatting and is repeated for handoff.

These are caller, render, transport and PostgreSQL proofs. They do not measure
cold/warm browser paint, transferred bytes, request arrival through ingress or
real clock interaction. Production builds, authenticated employee/manager journeys,
drag/scroll checks and known-authorized clock controls with held/failed widget
data remain integration gates owned by the parent spec run. Ticket #1456 stays
open until those gates and the final review are complete; no latency or byte
improvement is claimed from this suite.

# Webapp performance and architecture review — October 24, 2026

The strongest opportunities are reducing repeated identity/context reads, removing client read waterfalls, and making analytics query counts independent of employees × days/weeks. Caching will help repeated visits, but it should follow those changes rather than conceal an expensive cold path.

This is a source review of checkout `39a08d0bb`, on `dev`, supplemented by official framework documentation and existing repository measurements. Impact and effort below are estimates, not measured speedups. No application behavior was changed. Production tracing, database plans, bundle measurement and load tests were not run: Phase runtime configuration is unavailable to agents. The companion [data query audit](2026-10-24-data-query-audit.md) contains additional query evidence.

## Current architecture and existing improvements

The app uses Next.js 16.4 App Router, React 19, PostgreSQL/Drizzle, Effect services, Better Auth, TanStack Query, Zustand, and BullMQ workers with Redis-compatible storage. It mixes Server Component reads, client reads through Server Actions, client GET endpoints, and custom effect-based widget fetching.

Several worthwhile optimizations have already shipped:

- [Next configuration](../../apps/webapp/next.config.ts#L89) enables Cache Components, partial prefetching, React Compiler and optimized icon/chart imports.
- [Time tracking](../../apps/webapp/src/app/%5Blocale%5D/(app)/time-tracking/regions.tsx#L46) streams separate clock, timeline, summary and history regions with a shared rendering context.
- [Render session](../../apps/webapp/src/lib/auth/render-session.ts#L7) and [user preferences](../../apps/webapp/src/lib/user-preferences/render-snapshot.ts) support request-local reuse. Adoption is incomplete outside those paths.
- Route translation slices, lazy manual-entry dialogs, lazy Excel export and several lazy chart/calendar components already exist. Recommending those as entirely new features would duplicate work.
- Work periods already have relevant composite indexes. Work balance already has monthly projections and dirty-range rebuilding. See the companion audit before adding indexes or another balance store.
- The store-app ADR chooses one shared web UI. Improving this app also benefits its Capacitor shells; a separate mobile rewrite would contradict that decision without solving these query patterns.

The historical [October 3 navigation report](2026-10-03-deployed-navigation.md) recorded warm time-tracking clock readiness at median 881.5 ms and p95 1,650 ms, and Team readiness at median 1,102.5 ms and p95 3,145 ms. Those automation-assisted samples are neither current timings nor a controlled regression comparison.

## Ranked backlog

Impact describes the affected workload. “Very high at scale” does not mean every small-organization page will improve. Effort includes focused correctness checks and represents approximate engineering days for a maintainer. Overlapping items are not additive estimates.

| Priority | Improvement | Expected speed impact | Effort | Main beneficiary |
| --- | --- | --- | --- | --- |
| 1 | Share one client organization/employee bootstrap | High | Small: 1–2 days | Every authenticated load; especially Dashboard |
| 2 | Stream server-loaded Dashboard widgets; move remaining client reads off queued Server Actions | High | Medium: 3–6 days for Dashboard/one detail view | Dashboard and employee settings |
| 3 | Complete render-local identity reuse and shorten shared-layout/sidebar waterfalls | High | Medium: 2–4 days | First loads, reloads, server refreshes |
| 4 | Put the organization predicate into absence-pattern SQL | High at multi-tenant scale | Small: 0.5–1 day | Absence analytics and shared DB load |
| 5 | Reuse report-wide periods for home-office calculations | High on long reports | Small/medium: 1–2 days | Annual/monthly reports |
| 6 | Batch employee/week analytics; bound remaining concurrency | Very high at scale | Large: 5–10 days | Overtime, team and work-hours analytics |
| 7 | Cache actual analytics/reference readers with scoped invalidation | High on repeat loads | Medium: 3–5 days for an initial family | Analytics and repeated selectors |
| 8 | Allocate daily tracked minutes without rescanning every period | Medium/high on long ranges | Medium: 1–3 days | Work-hours analytics and balance readers |
| 9 | Defer closed/secondary UI data and analytics SDK loading | Medium | Small/medium: 1–3 days | Initial JS, mobile CPU and background requests |
| 10 | Replace broad cache invalidation with affected-query refreshes | Medium, especially after mutations | Small: 1–2 days for key paths | Saving/editing and refresh load |
| 11 | Verify shared runtime cache and unbuffered streaming in the actual deployment | Potentially high; deployment-dependent | Medium: 2–5 days after verification | Multiple web replicas and streamed pages |
| 12 | Add indexes only where representative query plans justify them | Potentially high; unmeasured | Small/medium: 1–2 days per hotspot | Large datasets |

## 1. Share the client organization context

[useOrganization](../../apps/webapp/src/hooks/use-organization.ts#L46) owns component-local state and an effect that requests `/api/auth/context`. It is not a shared query/provider. Both the [notification bell](../../apps/webapp/src/components/notifications/notification-bell.tsx#L13) and its [popover](../../apps/webapp/src/components/notifications/notification-popover.tsx#L29) call it, even with the popover closed. Nine Dashboard widget components use [useWidgetData](../../apps/webapp/src/components/dashboard/use-widget-data.ts#L28), which also calls it once per mounted widget.

Consequently, a default Dashboard can trigger eleven independent context fetches from those consumers alone: two notification consumers and nine widget consumers, subject to what mounts. This is a static call-site count, not a measured network trace. Each endpoint evaluates authentication/employee context and then [organization settings](../../apps/webapp/src/app/api/auth/context/route.ts#L19), including another membership check.

Create a display-safe client bootstrap containing organization ID, employee ID, role and settings. Seed it from already authorized server data, and share a TanStack query/provider for subsequent refreshes. A bootstrap can remove those initial context requests; without bootstrap, shared querying should reduce them to one request per identity/organization. Do not serialize session tokens. Query keys must include user and organization; clear or replace them on identity changes. The current organization switch performs a full reload, which should remain until a correctly scoped client switch is implemented.

## 2. Remove the Dashboard hydration and action queue waterfall

[SectionCards](../../apps/webapp/src/components/section-cards.tsx#L189) waits for hydration and a client [widget-order settings action](../../apps/webapp/src/components/dashboard/use-widget-order.ts#L44), then mounts widgets. Most data widgets fetch through Server Actions from `useQuery` or `useWidgetData`. [Manager Today](../../apps/webapp/src/components/dashboard/manager-today-widget.tsx#L31) is one example; the custom widget hook has no query cache for return visits. [Employee details](../../apps/webapp/src/lib/query/use-employee.ts#L91) similarly launches several independent action reads, then waits for employee data before policies can load.

The installed Next.js guide and [official BFF documentation](https://nextjs.org/docs/app/guides/backend-for-frontend#server-actions) explicitly describe Server Actions as queued and intended primarily for mutations. Parallel-looking client hooks therefore do not establish parallel transport.

Read Dashboard layout/settings on the server, authorize once, start visible widget reads together, and stream each widget behind its own boundary. Hydrate client query data where widgets need live interaction, using an accurate freshness timestamp. For client-owned reads such as search/detail refreshes, use authorized GET handlers or a narrowly scoped aggregate read endpoint. Keep mutations as actions. Avoid replacing many actions with one response that blocks every widget on the slowest calculation.

[The registry](../../apps/webapp/src/components/dashboard/widget-registry.ts#L32) defaults to fourteen widgets and appends newly introduced widget IDs to existing layouts. New releases therefore tend to add more default work. Choose role/feature-aware defaults and defer below-fold widgets, while preserving user choices. Hidden widgets already avoid mounting; the remaining opportunities concern default visible widgets and statically imported widget code.

## 3. Keep new features out of the global critical path

The [authenticated layout](../../apps/webapp/src/app/%5Blocale%5D/(app)/app-layout-content.tsx#L81) reads its render session, preferences/settings, then billing status before returning content. Billing enforcement is followed by membership/subscription reads. The [sidebar](../../apps/webapp/src/components/server-app-sidebar.tsx#L107) begins three context readers, then has successive phases for works council, payroll/finance, personnel files, submissions/presence, driving licence visibility, and project management. New product capabilities add more work to this shared path.

Several readers still call raw `getRequestSession`: [getAuthContext](../../apps/webapp/src/lib/auth-helpers.ts#L75), [getUserOrganizations](../../apps/webapp/src/lib/auth-helpers.ts#L232), and [getCurrentSettingsAccessTier](../../apps/webapp/src/lib/auth-helpers.ts#L751). Caching the first and third separately does not deduplicate their underlying session reads with each other or with the layout's separate render-session wrapper. Organization lists are also read from both Dashboard and sidebar.

Complete a render-only access snapshot and reuse membership, employee and organization data within that render. Start independent capability reads together once identity and applicable feature flags are known. Replace full location lists with existence reads where navigation needs only a boolean. Give the sidebar its own dimension-preserving Suspense fallback so an unrelated navigation capability does not hold the nearest whole-app boundary. Do not move billing enforcement or protected-content authorization after rendering protected content. These are first-load/refresh improvements; persistent layouts need not rerun on every soft navigation.

## 4–6. Reduce query volume before adding capacity

[Absence patterns](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L894) queries overlapping absences with employee/user/team/category relations across tenants, then filters by employee organization at line 915. Add the organization predicate in SQL. The returned collection is filtered today; this finding does not establish browser disclosure. It does establish unnecessary cross-tenant reads and a violation of the repo's query-scoping rule.

[Home-office reporting](../../apps/webapp/src/lib/reports/report-generator.ts#L490) executes one work-period query per home-office date, even though [report generation](../../apps/webapp/src/lib/reports/report-generator.ts#L144) already loads periods for the whole range. Reuse that range data. H home-office dates can then require zero additional work-period queries instead of H.

[Overtime analytics](../../apps/webapp/src/lib/effect/services/analytics.service.ts#L1451) nests employees and week buckets with unbounded concurrency. Each employee/week invokes tracking-context and work/requirements readers. For illustration, 200 employees × 26 weeks yields 5,200 tracking-helper calls before additional reads. Parallel execution does not reduce that count, and the [application pool defaults to ten connections](../../apps/webapp/src/db/index.ts#L42).

Batch authorized employee contexts, periods and requirement evidence for the full range, then bucket in memory with existing domain rules. Reuse loaded employee/holiday context and overlap genuinely independent requirement reads. Bound unavoidable remaining I/O; choose the bound from pool-wait/load measurements across web and worker processes. Increasing connection limits alone can move the queue to PostgreSQL.

## 7. Cache the readers that actually run

[createCachedQuery](../../apps/webapp/src/lib/analytics/cache.ts#L63) has no production call sites in the searched source; the other references are its example. Likewise, the general [query-cache helpers](../../apps/webapp/src/lib/cache/query-cache.ts) are definitions without current production consumers. These files are not evidence that screens use those caches. Some other features do have real caches.

Choose one cache policy for each data family and wire it into the actual read path:

| Data | Proposed policy |
| --- | --- |
| Authentication, current membership/permissions, billing enforcement | Fresh request checks; render-local deduplication only |
| Active clock, open breaks, approval decisions | Fresh authoritative reads; invalidate/refetch after commands |
| Teams, policy/holiday reference data, lightweight selectors | Organization-keyed caching, explicit mutation invalidation; choose a short tolerance with the product owner |
| Recent analytics summaries | Start with a proposed 30–120 second TTL, plus scoped invalidation; make freshness visible if useful |
| Historical derived analytics | Longer caching only with correction/policy/employment invalidation and versioned calculation semantics |

Authorize before reading a shared cached result. Keys need organization, relevant user/visibility scope, normalized range, timezone and filters; role alone does not represent manager/custom-role scope. Scope changes must not permit an older broader result to be reused. Existing analytics invalidation helpers include global tags, so indiscriminate wiring could evict every tenant on one tenant's write.

Use current Cache Components conventions deliberately. The [Next cache documentation](https://nextjs.org/docs/app/api-reference/directives/use-cache) distinguishes request inputs from cached work and describes the default runtime cache as memory-based. Longer TTLs cannot compensate for incorrect keys or missing invalidation.

## 8. Improve the daily allocation algorithm

[Daily tracked work](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L97) loops every day, and [its allocator](../../apps/webapp/src/lib/work-balance/tracked-work.ts#L147) scans all loaded periods each time. Bucket a period into only the local days it actually overlaps, or use a sorted sweep. This removes the common D × P scan pattern and repeated instant conversions. Preserve protected-minute allocation, stored rounded durations and reconciliation failures; test midnight, DST, travel offsets and tracking boundaries. Do not substitute a naive UTC `GROUP BY date` for this business logic.

## 9–10. Reduce initial client work and broad refreshes

The global [header clock](../../apps/webapp/src/components/time-tracking/time-clock-popover.tsx#L379) initializes vehicle-use data whenever the employee is available; assigned projects/categories load while clocked in even if the popover is closed. Keep compact authoritative clock status eager, but fetch secondary selection data on interaction intent/open where its required validation permits. Required driving warnings and server command checks must still run.

The bell needs only an unread count, but [useNotifications](../../apps/webapp/src/hooks/use-notifications.ts#L36) enables both list and count queries. Split the badge query from the list, loading the latter on open. Notification polling is already twenty minutes; the principal opportunity is avoiding list requests and unconditional focus refetches, not replacing a nonexistent rapid poller.

[PostHog](../../apps/webapp/src/components/posthog-provider.tsx#L3) is statically imported by the shared app provider even when capture is disabled or the user opted out. Isolate it behind a lazy, consent-aware client boundary, retaining current privacy behavior. Split widget/dialog bundles where they are not needed initially; measure compressed bytes and main-thread work before assigning a numerical benefit. Existing lazy Excel/dialog/calendar work should remain.

Some mutations, such as [surcharge edits](../../apps/webapp/src/components/settings/surcharge-model-dialog.tsx#L145) and [notification settings](../../apps/webapp/src/components/settings/notification-channel-settings.tsx#L141), invalidate all queries. [Manual view refresh](../../apps/webapp/src/components/providers/view-refresh-provider.tsx#L63) refreshes active Query data, SWR, custom handlers and then server props. Narrow mutation invalidation to affected domains and make each visible dataset have one refresh owner. Preserve the intentional refresh button, while checking for data loaded through both server and client paths.

## 11–12. Deployment and query plans: verify first

The [Kubernetes template](../../deploy/k8s/webapp.yaml#L10) declares three web replicas, while Next configuration has no custom shared cache handler. Redis existing elsewhere does not automatically share Next runtime caches. Verify the actual production topology before implementing a remote backend; coordinate both cache storage and invalidation when multiple instances serve cached runtime data. `use cache` and the legacy incremental cache have distinct configuration surfaces. Consult the installed-version docs and [self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

Also check real ingress/CDN streaming with deliberately delayed regions. The repository's [NGINX template](../../deploy/k8s/ingress.yaml#L10) does not explicitly configure response buffering; that is a reason to verify, not proof production buffering is enabled. A successful streaming implementation can still appear slow when a proxy buffers it.

After SQL scoping and batching, inspect absence overlap queries with representative `EXPLAIN (ANALYZE, BUFFERS)` plans. Existing [absence indexes](../../apps/webapp/src/db/schema/absence.ts#L143) do not declare a tenant/date-overlap composite. Evaluate suitable B-tree or range indexes from the plans, row counts and write cost. Work-period composites already exist. [PostgreSQL's EXPLAIN guide](https://www.postgresql.org/docs/current/using-explain.html) explains why execution/row/buffer evidence matters; an index's existence alone does not establish that a query uses it effectively.

## Suggested implementation sequence and evidence

1. Establish a repeatable production-mode fixture benchmark, while fixing the SQL tenant predicate and shared client context. Treat measurement as a parallel enabling task, about 1–2 days if the environment is ready.
2. Remove Dashboard hydration/action waterfalls and shared-layout duplication. Measure first document loads separately from repeat Link navigations and server refreshes.
3. Remove report per-day queries and batch employee/week analytics. Test small, medium and large organizations with month, quarter and year ranges.
4. Add scoped caching to the now-cheaper read paths. Record cold/warm behavior and verify corrections, scope changes and cross-instance invalidation.
5. Pursue measured bundle/index/infrastructure issues. Consider additional daily/weekly projections only if batched reads remain expensive; extend existing projection/rebuild machinery where semantics match, rather than adding an unrelated reporting store.

Track route/widget p50/p95 readiness, LCP/INP, initial JavaScript and RSC bytes, request/query counts, rows returned, query duration, pool wait, cache hit rate and server event-loop delay. Existing [OpenTelemetry setup](../../apps/webapp/src/instrumentation.node.ts#L63) and [named Effect query spans](../../apps/webapp/src/lib/effect/services/database.service.ts#L30) provide a starting point. Without a remote endpoint, the current processor retains error output rather than an exported successful-request performance history. Confirm transaction-client query coverage and avoid logging tokens or personal SQL parameters.

Use identical fixtures/builds, at least twenty cold-context and twenty warm-navigation samples per condition, plus representative concurrent load. Set route-specific budgets after establishing that baseline. Add structural guards such as one shared client-context request, no work-period query per report day, and no tracking-context query per employee/week. Preserve authorization, org isolation, clock freshness, error isolation and timezone semantics alongside latency budgets.

The React/Next performance, composition and Web Interface Guidelines were consulted for these proposals. UI recommendations retain stable loading geometry and keyboard/focus behavior; this review is not a separate visual accessibility audit. No tests or builds were needed for this documentation-only source review, and historical checks are not asserted as newly run.

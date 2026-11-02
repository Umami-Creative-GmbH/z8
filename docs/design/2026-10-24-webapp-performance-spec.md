# Keep Z8 responsive as features and organization history grow

Specification prepared with to-spec on October 24, 2026. The user approved the authenticated-journey and existing PostgreSQL integration test seams on the same date.

## Problem Statement

Z8 has become more capable, but employees and managers experience increasing delays when opening the app, navigating to the Dashboard or employee details, and viewing analytics or reports. A routine task such as clocking work should not become slower because unrelated capabilities or historical records have been added.

The source review found repeated organization and employee context requests, overlapping authentication reads in server rendering, a Dashboard that waits for hydration and client-loaded preferences before requesting widget data, queued Server Actions used for independent reads, analytics that multiply queries by employees and weeks, report queries per home-office day, and daily calculations that rescan every period for every day. Some cache helpers exist without production consumers. Absence-pattern analytics also fetches across organizations before filtering the results in memory.

These are confirmed source patterns, not a measured attribution of production latency or proof that a particular release introduced a regression. Production query plans, current browser timings and concurrent-load measurements are still needed. Existing historical navigation observations do not establish a controlled before/after baseline.

## Solution

Make everyday work available sooner and keep response times predictable as organizations, history and features grow. Load shared context once, start independent reads together, stream useful content as it becomes available, and make query volume depend on bounded data batches rather than employee/day/week combinations.

Cache suitable reference data and derived analytics with explicit freshness and invalidation rules. Keep authoritative authentication, permission, billing and clock-command checks fresh. Preserve the existing meaning of completed work, day totals, absence days, employment terms, compliance weeks and closed months.

Deliver the work in independently verifiable phases ordered by impact and effort. Measure real route readiness and resource use before and after each phase, retaining useful structural regression tests so later features do not silently recreate the same costs.

## User Stories

1. As an employee, I want the application to become usable quickly when I open it, so that recording work does not interrupt my day.
2. As an employee, I want clock controls to become available independently of historical summaries, so that a slow report does not delay clocking.
3. As an employee, I want my current clock and break state to be accurate, so that faster loading does not cause an incorrect command.
4. As an employee, I want the compact header clock to remain available on every appropriate page, so that I can record work without unnecessary navigation.
5. As an employee, I want secondary clock selectors to load when needed, so that unrelated project, category or vehicle data does not slow every page.
6. As an employee, I want required driving warnings and position-consent behavior to remain dependable, so that deferred loading does not remove an important safeguard.
7. As an employee, I want my organization and employee context to be shared by the page's controls, so that the app does not repeatedly load the same information.
8. As a user belonging to several organizations, I want organization changes to replace all relevant display data, so that I never see another organization's cached information.
9. As a signed-out or revoked user, I want protected content to remain inaccessible, so that performance improvements preserve access control.
10. As a user, I want my locale, timezone, week-start and time-format preferences available immediately, so that loading does not show misleading values or cause avoidable layout changes.
11. As an employee, I want my Dashboard to show useful information before every widget finishes, so that I can act on the information already available.
12. As a manager, I want independent Dashboard widgets to load without waiting for each other, so that one slow calculation does not delay the whole overview.
13. As a user, I want a failed secondary widget to have its own error and retry treatment, so that the rest of my Dashboard remains usable.
14. As a user, I want my saved widget visibility and order preserved, so that faster loading does not reset my workspace.
15. As a user, I want new optional widgets to avoid adding automatic loading work to my existing Dashboard, so that each release does not make my routine slower.
16. As an employee or manager, I want default widgets to match the capabilities available to me, so that unavailable features do not trigger unnecessary data loading.
17. As an administrator, I want employee details and related settings to become available without a chain of independent requests, so that reviewing an employee is quick.
18. As an administrator, I want repeated visits to employee selectors and reference settings to reuse suitable data, so that common administration tasks stay responsive.
19. As a user, I want notification badges to load without downloading the notification list, so that a closed popover adds little work.
20. As a user, I want opening notifications to show the list promptly, so that deferred list loading remains convenient.
21. As a user, I want saving a setting to refresh affected information, so that unrelated widgets and requests do not restart unnecessarily.
22. As a user, I want manual refresh to update visible data without losing drafts or scroll position, so that I can request fresh information safely.
23. As a manager, I want analytics to remain responsive for larger teams and longer ranges, so that growing my organization does not make its overview unusable.
24. As a manager, I want overtime, team and work-hours analytics to respect my current visibility scope, so that shared caches do not broaden my access.
25. As an administrator, I want absence analytics to read only my organization's records, so that other tenants do not add work to my request.
26. As a manager, I want repeat analytics visits to reuse a recent result when appropriate, so that I do not wait for identical calculations.
27. As a manager, I want corrections and relevant policy, holiday or employment changes reflected after refresh, so that cached totals remain trustworthy.
28. As an administrator, I want annual reports with many home-office days to avoid a separate database request for every day, so that reports complete predictably.
29. As a payroll reviewer, I want report totals and hourly earnings preserved, so that performance work does not alter what an employee is owed.
30. As a payroll reviewer, I want work spanning midnight, wage changes, DST or travel offsets calculated correctly, so that faster aggregation preserves timekeeping meaning.
31. As a payroll reviewer, I want work-policy evidence and closed-month protections preserved, so that optimization does not rewrite historical decisions.
32. As a user, I want long-range daily charts to avoid unnecessary repeated calculation, so that opening history does not consume excessive server CPU.
33. As a mobile or store-app user, I want less initial JavaScript and secondary network activity, so that the app remains responsive on a slower device or connection.
34. As a user who has opted out of product analytics, I want the analytics integration to respect that choice, so that deferred SDK loading preserves my privacy settings.
35. As an operator, I want expensive analytics and reporting requests to use bounded database concurrency, so that they do not delay employees' clocking requests.
36. As an operator, I want runtime caching and invalidation to behave correctly across the actual deployment's instances, so that load balancing does not produce inconsistent results.
37. As an operator, I want streaming verified through the real proxy and CDN path, so that users receive the early content the application renders.
38. As a maintainer, I want reproducible measurements for first loads, repeat navigation and concurrent use, so that prioritization follows evidence.
39. As a maintainer, I want tests that exercise visible behavior and real query budgets, so that internal refactoring remains possible while regressions are caught.
40. As a maintainer, I want each phase's measured benefit, limitations and deployment prerequisites recorded, so that the next optimization starts from reliable evidence.

## Implementation Decisions

1. **Preserve the existing architecture and domain decisions.** Retain Next.js App Router, the shared web UI used by the thin store-app shells, PostgreSQL/Drizzle, Effect, Better Auth, TanStack Query and existing background workers. Keep Cache Components, partial prefetching, React Compiler, route translation slices and existing lazy export/dialog/calendar work. No framework, authentication or mobile rewrite is required.

2. **Measure before promising numerical latency gains.** Establish an operator-configured production-mode fixture environment with disposable users and organizations. Benchmark Dashboard, time tracking, employee list/detail, reports and analytics. Separate initial documents, repeat Link navigation, return visits, manual refresh and mutation refresh. Record build, fixture size, role, organization, range, locale, timezone, viewport and concurrency. Set numerical latency/resource budgets from that baseline before evaluating each implementation phase; do not derive acceptance thresholds retrospectively from its results.

3. **Use one display-safe organization/employee bootstrap.** The authenticated layout supplies the minimum organization, employee, role, settings and presentation data already resolved through authorized reads. Reuse it through a shared client query/provider instead of component-local context effects. Include identity and organization in client cache keys and reset relevant state on identity changes. Never serialize session tokens, a server authorization context or privileged internal data. The existing full-page organization switch remains until an independently verified client switch can provide equivalent isolation.

4. **Complete request-local reuse for server rendering.** Migrated layout, sidebar and page readers share authoritative session, approved membership, eligible employee, organization and preference reads within one render. Render-only readers stay internal and cannot be supplied by the browser. Public actions and handlers retain fresh authorization; request memoization must not become a cross-request permission or session cache.

5. **Shorten shared layout and sidebar dependencies.** Once authorized identity and applicable feature flags are known, start independent capability reads together and reuse available evidence. Read existence rather than full lists where navigation only needs a boolean. Isolate sidebar loading behind a dimension-preserving Suspense fallback. Authentication, MFA/SSO requirements, billing enforcement and protected-content access must succeed before protected content is emitted. Do not count persistent layouts as rerunning on every soft navigation without observing that behavior.

6. **Load Dashboard preferences and initial data on the server.** Remove the hydration-plus-client-preferences prerequisite for starting visible widget reads. Authorize and begin independent reads together, then stream each widget with local loading/error treatment. Hydrate client queries where interaction or subsequent refresh needs them, carrying real freshness timestamps. A slow or failed secondary widget must not become a prerequisite for the others or for clock controls.

7. **Use appropriate read transport.** Retain Server Actions for mutations. Move migrated independent client-owned reads, initially Dashboard refreshes and employee-detail data, to authorized GET handlers or a narrowly scoped aggregate read interface. Preserve authentication, errors, tenant and visibility filters. Prefer existing read modules behind that interface rather than duplicating business logic. Do not replace many independent requests with one aggregate response that requires every slow calculation to finish before any content is usable.

8. **Bound Dashboard growth.** Preserve saved widget order and hidden choices. For users without a saved layout, offer role- and feature-appropriate defaults. Newly introduced optional widgets are available through customization rather than automatically added to existing users' visible layouts; existing explicit visible choices remain visible. Defer secondary below-fold widgets and their code where this improves measured readiness, retaining stable placeholders and keyboard access. Existing hidden widgets already avoid mounting and should continue to do so.

9. **Enforce tenant scoping in absence analytics SQL.** Add the organization predicate before retrieving absence-pattern rows and their relations. Apply manager/employee visibility in database predicates where appropriate. Any retained in-memory checks are additional checks, not the means of tenant isolation. The reviewed code filters returned results today; this spec does not assert that other tenants' results reach the browser.

10. **Reuse report-range work periods.** Feed already loaded completed work into home-office aggregation instead of querying again for every date. Preserve half-open overlap, local-day allocation, completed-work inclusion, tracking boundaries, stored rounded durations, custom-field visibility and confirmed employment terms. Reuse must not include live or deleted work or reinterpret captured endpoint offsets.

11. **Batch analytics inputs across employees and ranges.** Replace employee-by-week tracking/period/requirement reads with organization- and visibility-scoped batch reads. Load each employee's tracking context once for the requested calculation, load range evidence in bounded batches, and reuse work-policy, absence, holiday and employment evidence. Query volume may grow with explicit bounded batches, but must not multiply by the number of weekly buckets. Keep remaining concurrency bounded by measured pool capacity and the needs of interactive requests across web and worker processes.

12. **Allocate daily tracked minutes efficiently.** Bucket each period only into days it intersects, or use an equivalent sorted sweep, avoiding the common full-range day-by-period rescan. Preserve protected-minute allocation, reconciliation failures and rounding. Employee-local day totals, organization-local report ranges, captured event-local offsets, display weeks and Monday compliance weeks retain their distinct meanings. New date/time business logic uses Temporal with explicit zones; native Date stays at database/external interfaces.

13. **Cache actual production readers.** Migrate callers to deliberate caching rather than relying on unused helper definitions. Use current Cache Components conventions with one clear owner for each data family. Authentication, current permissions and billing enforcement stay request-fresh. Live work, open breaks, operational approval state and command decisions retain authoritative fresh reads. Reference selectors initially use a maximum five-minute TTL with targeted invalidation. Non-operational recent analytics initially use a maximum sixty-second TTL with targeted invalidation. Exclude widgets whose operational freshness is stricter. Do not introduce a longer historical TTL in the initial delivery.

14. **Treat cache scope and invalidation as part of the interface.** Authorize before serving a shared cached result. Keys include organization, effective user/visibility scope, normalized range, timezone and relevant filters, with calculation versions where semantics can change. Role alone is insufficient for manager assignments, custom roles or officer scopes. Permission changes must not reuse a previously broader result. Invalidate the affected organization's derived data after accepted work corrections, relevant absence changes, tracking-boundary changes, holiday/policy/employment changes and other dependencies of the cached calculation. Do not let a single tenant's routine write evict every tenant's analytics.

15. **Preserve source semantics behind invalidation.** Absence days continue to resolve from the work policy and holidays in effect on each day; they do not become new stored canonical amounts. Captured work-policy/compliance evidence is not retroactively re-evaluated because a cache is invalidated. Confirmed employment terms remain the only wage history. Completed work is written only through work records, work-transaction guards retain their acquisition protocol, and closed-month protections remain unchanged. Read optimization must not become a historical repair or write-path migration.

16. **Defer secondary global client work.** Keep compact clock status eager. Load optional selection data on interaction intent/open where current clock validation and driving-warning behavior permit it. Split notification count and list reads so the closed bell needs only the count. Retain useful freshness and retry behavior; notification polling is already infrequent, so do not premise this work on removing a rapid poller. Load the analytics SDK lazily in accordance with existing consent and disablement behavior. Assess compressed JavaScript bytes and main-thread work rather than assuming a static import's exact cost.

17. **Give each dataset one refresh owner.** Narrow mutation invalidation to affected query families. Coordinate server props, TanStack Query, SWR and registered custom refresh handlers to avoid redundant reloads of the same data. Preserve the explicit refresh control, visible pending/error feedback, drafts, selections and scroll position. Successful writes must become visible without waiting for TTL expiry where read-your-writes behavior is required.

18. **Verify deployment before changing infrastructure.** Inspect the actual replica topology and verify cache hits and invalidation across instances. Existing Redis usage does not automatically share Next.js runtime caches. Add a compatible shared cache backend and cross-instance invalidation only if the deployment requires them; use the correct installed-version configuration for each cache type. Test deliberately delayed streamed regions through ingress/CDN. Configure unbuffered streaming only when evidence shows buffering prevents early delivery. Do not infer production settings from example manifests.

19. **Add indexes only from representative plans.** Capture query plans and row/buffer evidence after tenant scoping and batching. Evaluate absence-overlap indexing and other demonstrated hotspots; do not duplicate existing work-period composite indexes. An accepted index change includes measured benefit and write/storage cost, a repository-compliant migration, and a safe operational rollout. If representative plans do not justify an index, record that conclusion and make no speculative schema change.

20. **Reuse existing projections where semantics match.** Existing work-balance projections and dirty-range rebuilding remain authoritative for their current purpose. Additional daily/weekly analytics projections are a follow-up only if batched reads and caching still miss agreed budgets. Do not silently substitute a balance total for an overtime or compliance metric with different semantics.

21. **Acceptance is both behavioral and structural.** For migrated initial loads with a server bootstrap, there are no redundant client organization-context fetches. With bootstrap unavailable, simultaneous consumers share at most one in-flight context request per user/organization. Migrated consumers in one server render share one underlying session evaluation and their same-purpose membership/employee reads; separate requests re-evaluate authorization. Increasing home-office dates adds no work-period query per date. Increasing weekly buckets adds no employee/week tracking-context query. Slow secondary data does not hide known-authorized clock controls or completed siblings. Correct totals, tenant/visibility isolation, invalidation and fresh command authorization must pass alongside the recorded latency/resource budgets.

## Testing Decisions

1. **Primary seam: authenticated web journeys in a production-mode fixture app.** Exercise the same route/request/render interfaces used by employees, managers and administrators. Observe usable content, enabled controls, loading/error isolation, request counts, response bytes and readiness timings. Prefer this high seam to tests of hook internals, private helper call order, source strings or chosen cache implementation. Reuse navigation readiness markers and region-loading patterns already established in the application.

2. **Supporting existing seam: public read-module interfaces against disposable PostgreSQL.** Call the report, analytics and requirement readers as real callers do, with controlled authorization fixtures. Observe results and database query counts through the existing integration database adapter/query logger. Do not fake the entire ORM or invent a new database abstraction just for this work. Extend existing employee-report and work-policy requirement integration suites, including completed/live/deleted work, confirmed wage changes and local-day allocation. Existing analytics grouping tests remain useful for output examples but are not proof that batching or SQL tenant isolation works.

3. **Use smaller tests only where they add distinct evidence.** Retain focused deterministic tests for pure interval/rounding behavior and client bootstrap replacement where full browser cases would obscure edge cases. Reuse organization-settings bootstrap/provider tests, Dashboard settings/rendering tests, query-provider refresh tests and time-tracking region error/loading tests. Update any existing test that intentionally enshrines the old hydration waterfall to assert the new external behavior. Do not introduce a new seam per widget or private helper.

4. **Test real authorization and cache isolation.** Use at least two organizations and two users, including employee, manager, organization administrator and a restricted custom-role/grant case. Cover organization switching, sign-out, revocation, unapproved/inactive employees, MFA/SSO-required states and billing denial. Concurrent requests must not share another request's identity. A manager's cache must never expose the administrator's broader result. Re-check after permission reduction and relevant scope changes.

5. **Test independence by controlling completion.** Hold a secondary Dashboard/sidebar/history read pending and fail it separately while successful siblings and eligible clock controls render. Unknown clock state must not be treated as clocked out. Protected content must not be emitted before authorization. Verify loading geometry, busy/status text, focus and retry behavior through the rendered interface.

6. **Test query growth at the existing database seam.** Compare equivalent fixtures with more consumers, home-office dates and week buckets. Assert the externally documented query budgets, using query families rather than every incidental SQL statement or exact query text. Include a large unrelated tenant in absence-analytics fixtures, verify SQL predicates/query evidence as well as output, and ensure those records are not retrieved. Cover transaction-bound query paths where used. Mocked React cache behavior is not evidence of actual render-scoped deduplication.

7. **Test timekeeping equivalence using domain evidence.** Cover UTC storage with explicit zones, DST gaps/folds, midnight/month/year crossings, travel with differing captured offsets, half days, policy changes, confirmed wage changes, tracking start, protected-minute rounding and closed months. Compare established expected outputs, not just old/new implementations that could share the same bug. Keep absence-day resolution and recorded compliance evidence distinct.

8. **Test cache behavior through callers.** Verify first read, cache hit, expiry, mutation invalidation, immediate read-your-writes and permission/scope reduction using deterministic time where possible. A change in organization A must not invalidate unrelated organization B entries. If multiple web instances are deployed, perform the write and subsequent read on different instances. A cache outage must preserve authorization and use the documented error/fallback behavior without an uncontrolled recomputation storm.

9. **Record meaningful performance evidence.** Use the same hardware/runtime, build mode and fixtures for comparisons, at least twenty fresh-context first visits and twenty warm navigations per condition, and representative concurrent load. Include small and large organizations and month/quarter/year ranges. Capture p50/p95 route/widget readiness, LCP/INP where applicable, JavaScript/RSC bytes, request/query counts, rows retrieved, pool wait, cache hits and event-loop delay. Record variance and limitations; automation polling time is not a browser-native paint metric. Keep protected fixture values and credentials out of artifacts.

10. **Gate each phase on its scope.** Run focused behavior and PostgreSQL integration checks, appropriate React/Next quality checks and production-mode runtime verification. Run type checks and the required CI-mode build for implementation changes. Broader checks follow the affected surfaces and repository workflow. Missing runtime credentials or an unavailable benchmark environment are an explicit unfulfilled acceptance gate, not a passing or skipped performance result.

## Out of Scope

- A promise that every screen becomes instant, or a claimed percentage/millisecond improvement before current controlled measurements exist.
- Replacing Next.js, PostgreSQL, Effect, Better Auth, the existing workers or the shared store-app web UI.
- A blanket application-wide transport migration or a new general data-access framework; migrate the Dashboard, shared context and employee-detail reads in scope, then expand only from evidence.
- Longer-lived authentication, permission or billing-enforcement caches; stale authorization for clocking or other commands.
- Changing timekeeping, wages, absence-day meanings, compliance-week rules, approval semantics or closed-month behavior.
- Historical backfills, record repairs, write-path rewrites, generated authentication schema edits or new canonical stores for derived totals.
- A visual redesign, resetting existing widget preferences, changing consent defaults, removing warnings or weakening access checks.
- Speculative indexes, larger pools, new cache infrastructure, partitioning or microservices without measured justification.
- New long-lived historical analytics caches or additional analytics projections in the initial delivery.
- Accessing production secrets or employee data to manufacture a benchmark; use an operator-configured disposable fixture environment.
- Publishing implementation tickets or implementing the changes as part of creating this spec; derived tickets are a separate workflow and must use native sub-issues when created.

## Further Notes

The source evidence is the October 24 webapp performance and architecture review and its companion data/query audit. The reviewed checkout was `39a08d0bb`; implementers must re-check current callers and existing work before editing. October 3 navigation observations are historical after-deployment evidence only. Earlier navigation work already delivered streaming time-tracking regions, translation slices and lazy exports; retain it and avoid reopening completed work without a current failing case.

Recommended delivery order and approximate effort:

| Phase | Outcome | Likely impact | Initial effort estimate |
| --- | --- | --- | --- |
| Baseline | Reproducible production-mode journeys, query budgets and load evidence | Enables trustworthy decisions | 1–2 days once the environment is ready |
| Quick improvements | Shared client context, tenant-filtered absence SQL, report-period reuse | High across initial loads and long reports | About 2–5 days; items can land independently |
| Shared rendering and Dashboard | Render-local identity reuse, independent sidebar/widget delivery, appropriate read transport | High for first loads and interactive overviews | About 5–10 days with overlapping work |
| Analytics scale | Batched range evidence, bounded concurrency and efficient daily allocation | Very high for larger organizations and long ranges | About 6–12 days |
| Caching and client cost | Scoped reader caching, precise invalidation and deferred secondary work | High on repeat visits; medium for mobile initial cost | About 4–8 days with overlapping work |
| Evidence-led infrastructure | Verified shared cache, ingress streaming and demonstrated indexes where necessary | Conditional on deployment and query plans | About 2–5 days per confirmed area |

These are source-based planning estimates, not commitments or additive totals. Each phase must publish its measured effect and remaining limitations. If a proposed optimization does not improve its target workload, revisit it before expanding its scope.

The principal architectural constraint is that new capabilities must not automatically add mandatory requests to every authenticated page or every existing Dashboard. Keep that constraint visible in review and in the structural performance checks.

The approved test approach uses authenticated web journeys as the primary seam and reuses the existing PostgreSQL integration seam for correctness, tenant isolation and query-growth evidence, with focused tests only for distinct edge cases.

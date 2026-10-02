# Navigation performance improvements

Status: proposed written spec. The user approved the overall design and four staged changes on October 2, 2026. This document requires review before the detailed implementation plan is written. Implementation is outside the current planning stage.

## Purpose and scope

Make page navigation faster and make the time tracking page usable sooner. Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.

Deliver four independently reviewable changes:

1. Deduplicate session and employee reads during server rendering.
2. Render time tracking clock controls independently of secondary data.
3. Load the Excel exporter when an Excel export is requested.
4. Consolidate user settings reads and deliver translations by route.

Changes 1 and 2 address the clearest observed delay. Change 3 can proceed independently. Change 4 follows the time tracking work and has separate settings and translation validation within its review.

Source paths below are relative to `apps/webapp` unless a repository-level path is stated.

Cache Components and Partial Prefetching are already enabled. Keep their flags and the default navigation Link behavior. This design does not add longer-lived caches for sessions or time data, enable cookie session caching, change billing or approval policy, redesign pages, or migrate unrelated date logic.

## Evidence and measurement

The production audit used the authenticated Codex browser at `https://ui.z8-time.app` in its existing narrow viewport. Production reported build `743f288`, which resolves locally to commit `743f2887f`. The relevant time tracking data and auth helpers, session helper, layout settings readers, translation loader, Excel exporter, and Next.js configuration matched checkout `144ab9bd8` when inspected.

| Destination | Checked content | Three repeat navigation samples | Median |
| --- | --- | --- | --- |
| Dashboard | Manager summary | 472, 348, 304 ms | 348 ms |
| Time tracking | Timeline heading after page data resolves | 3099, 1232, 2929 ms | 2929 ms |
| Team | Team content heading | 1203, 968, 774 ms | 968 ms |
| Reports | Empty report state | 2269, 453, 454 ms | 454 ms |
| Calendar | Completed work event in the current view | 465, 453, 804 ms | 465 ms |

These measurements include browser automation overhead. They are neither precise browser timing metrics nor statistical performance percentiles. Readiness markers differ by route, and repeat visits can benefit from existing client caches. They establish a reason to investigate time tracking, not a historical regression or a proven query bottleneck.

Before implementation, capture at least 20 navigations per compared condition against the same credentialed production-mode test environment, with the same fixture account, organization, selected date, viewport, and readiness markers. Keep first visits and repeat visits separate. Record median and p95 for route header, clock controls, timeline, summary, and history readiness; query counts and query duration; initial JavaScript; and translation/RSC bytes. Compare against the immediate predecessor of each change. Redact credentials and employee details from artifacts.

Correctness and structural acceptance criteria below are mandatory. Report measured gains separately; the existing three samples do not justify a promised millisecond target. The controlled delayed-data tests provide a deterministic streaming gate even when wall-clock measurements are noisy.

## 1 Deduplicate rendering reads

### Boundaries

Keep `getRequestSession` as the fresh authoritative reader for actions and handlers. Add a render-specific React-memoized session reader in the server-only auth layer. Its underlying read retains `await connection()` before headers and Better Auth I/O. React memoization is limited to a server render/request; there is no module-level session map, shared persistent auth cache, or change to cookie caching.

Resolve the time tracking rendering context through a request-memoized server-only reader. It contains the session identity needed on the server, the approved membership, active organization, eligible employee, and presentation preferences required by the page. Reuse the existing authorization predicates and current behavior; do not invent a reduced permission check for performance.

Use that validated context for rendering data helpers. Publicly callable actions keep their current authentication and permission checks, then call the same internal helpers where useful. They never accept a browser-supplied authorization context. Internal helpers remain outside `use server` modules' public action surfaces and filter all tenant queries by the resolved organization.

The page currently invokes its session helper directly and resolves the current employee three times through page data, history, and summary. Replace those repeat resolutions with the shared context. Any existing header or layout consumer moved to the render-specific reader shares that request's session lookup; unrelated handlers remain unchanged.

Only display-safe fields cross into Client Component props. Never serialize the session object, session token, or validated server context to the browser. Request-local memoization must not survive an organization switch, sign-out, preference mutation, or subsequent request.

### Acceptance

- One underlying authoritative session evaluation for the migrated consumers in one Server Component render.
- One approved-membership lookup and one eligible-employee lookup for the time tracking rendering context, reused by its migrated regions.
- Auth tests retain unauthenticated, banned, SSO-required, revoked/unapproved membership, inactive employee, and cross-organization behavior.
- Separate requests re-evaluate authorization. Calling an action after a mutation cannot reuse a prior render's authorization or preferences.
- Query counting uses actual rendering and database seams. Mocking React `cache` as a global memoizer is not evidence of request isolation.

### Main files

`src/lib/auth/request-session.ts`, `src/lib/auth-helpers.ts` where selected rendering consumers need the shared reader, and `src/app/[locale]/(app)/time-tracking/{page-data.ts,actions/auth.ts,actions/queries.ts}`. New render context and internal read modules live alongside time tracking and are server-only.

## 2 Render clock controls independently

### Data flow

The time tracking page currently awaits `searchParams` and one complete page result before rendering the clock widget. That result waits for active period, history, summary, translations, timeline, work balance, and manager eligibility. Parallel work still makes the slowest result block every region.

Replace that aggregate render dependency with four regions sharing the authorized rendering context:

| Region | Required data | Data that must not block it |
| --- | --- | --- |
| Clock controls | Authorized employee, active work period, display preferences, common label translation | Timeline, summary, balance, history, manager eligibility, selected date |
| Timeline | Authorized employee and organization, display context, selected-date parameter, timeline result | History and summary |
| Summary | Authorized employee and organization, current summary and balance | Timeline and history |
| History | Authorized employee and organization, weekly periods, edit/approval capabilities and manager eligibility | Timeline and summary |

An outer boundary handles the shared identity/employee resolution and the existing no-employee state. Once that context resolves, sibling async components start their independent reads without awaiting an aggregate result. Give each region a Suspense boundary with the current loading dimensions and accessible busy/status text. The clock region renders as soon as its own inputs are ready.

Pass the `searchParams` promise only to the timeline region and await it there. The selected timeline date must not change clock state or the existing weekly summary/history semantics. The existing timeline normalization decides invalid and absent dates.

Preserve layout order and spacing. A history-only capability lookup cannot delay the clock controls. Existing mutations retain their authorization, idempotency, and refresh behavior; subsequent rendering resolves fresh active-period data. Streaming does not make prefetched clock state authoritative for a mutation.

### Failure behavior

Authentication and access failures deny or redirect before any protected region is emitted. Do not turn a failed active-period read into a fake clocked-out state: show the existing application error treatment and keep clock actions unavailable until the status is known.

Keep the existing structured timeline error result and work-balance-null fallback. Region components normalize independent data failures to the app's existing inline error treatment, with a retry through the existing refresh mechanism. Error handling must rethrow framework redirect/not-found/prerender control-flow errors rather than swallowing them. Log only safe identifiers and error metadata. A secondary data failure must not remove already-rendered clock controls. No new error-boundary dependency is needed.

Keep UTC instants, captured event-local offsets, selected employee timezones, weekly boundaries, durations, and report totals unchanged. Any newly introduced date calculation uses Temporal with an explicit zone; native Date conversion stays at database or external boundaries. Moving a legacy calculation must not silently alter its meaning.

### Acceptance

- With timeline, summary, balance, and history promises deliberately held pending, real clock controls appear once active-period and context data resolve.
- A held or failed secondary read does not hide clock controls or unrelated completed regions.
- Controls cannot appear with unknown authorization or an unknown active-period state.
- Selecting a timeline date suspends that region without requiring unrelated data to wait for the date.
- Existing timekeeping, capability, mutation, and canonical action-surface tests pass.
- A production-mode browser run confirms fallbacks resolve, the page remains useful during streaming, and layout shifts do not increase materially.

### Main files

The time tracking page, its render context/data modules, and new region components. Reuse `ClockInOutWidget`, `PersonalWorkdayTimeline`, `WeeklySummaryCards`, and `TimeEntriesTable`; change their contracts only where necessary to preserve independent loading.

## 3 Load Excel only on demand

Remove the static Excel exporter import from `src/components/reports/export-buttons.tsx`. Import the exporter module inside the Excel branch of the existing export handler. Both workbook generation and filename generation come from that dynamic module so a static filename import cannot keep ExcelJS in the initial dependency graph.

Keep the CSV and PDF paths, generated filenames, MIME types, report content, and download cleanup behavior. Set the loading state before importing; import failures use the existing error toast and reset loading. Repeated exports reuse the module loader's cache. Do not warm ExcelJS on page mount or link prefetch.

Acceptance: ExcelJS is absent from the initial Reports client dependency graph and arrives on Excel export; an existing-style report fixture produces the same worksheet contents and filename; import/generation failure resets controls and allows retry. Use bundle inspection and a disposable fixture download, not a live employee report. Do not claim a byte saving from source inspection alone.

## 4 Consolidate settings and split translation delivery

### Settings

Introduce a server-only user preference snapshot reader for locale, week start day, time format, timezone, and analytics preference. Use one narrow `userSettings` query keyed by the authorized user ID and reuse its result during the render. This is user-level data; organization permissions continue to come from the organization-scoped context.

Preserve the current defaults: unset locale does not force a redirect, week start normalizes to Sunday, time format normalizes to 24-hour, timezone defaults to UTC, and an unset analytics preference keeps its current true default. Reuse the existing normalizers for invalid values. Preference writes retain their current behavior and become visible in a new request. The layout's organization settings and billing gates stay independent.

Migrate the authenticated layout's five reads and time tracking's preference read to this snapshot. Compatibility wrappers may remain for callers outside the migrated rendering paths. Avoid broad changes to bot localization or unrelated preference consumers.

Acceptance: one settings query for migrated consumers within a render, identical defaults for absent/partial rows, unchanged locale redirect behavior, immediate preference visibility on subsequent requests, and isolation between users.

### Translation loading model

The current locale loader returns all 35 namespaces to the root provider. `TolgeeBase` also has a per-language fallback that loads every namespace. Catalogs are merged into the default locale dictionary, with namespace aliases. Consequently `addActiveNs` alone is not a selective-loading solution for this application's existing key model.

Retain that key model. Introduce cached catalog-slice loading keyed only by supported locale and a canonical sorted namespace set. Cache code-owned translation catalogs with the existing lifetime; keep request headers, sessions, and tenant data outside those cache boundaries.

Maintain a shared shell dictionary containing the translations needed by global providers, navigation, all route title metadata, header clock/break controls, notifications, organization and billing banners, and their reachable dialogs. Extract the required shared keys from those components and the route metadata registry; retain their complete translation subtrees where keys are dynamic. This avoids loading an entire feature namespace merely for its header title. The implementation records the explicit shared key manifest, with coverage for metadata and dynamic key families.

Feature boundaries deliver the relevant catalog slices from the existing route-to-namespace mapping. Extend that mapping for reachable cross-feature dialogs and error content. Use a shared server boundary component in page/feature layouts so direct loads and client navigation hydrate the required dictionaries before feature content is shown. Never select root translations by request pathname headers; the root remains independent of the destination URL.

Keep one stable browser Tolgee instance per locale and the persistent QueryProvider. A dictionary merge adapter maintains the cumulative loaded records for that locale, deep-merges new slices using the existing tree/alias semantics, and adds the resulting records without discarding previously loaded keys. Deliver matching SSR records through feature boundaries so feature content never relies on a post-paint effect to acquire its translations. A new route must not briefly render keys or the previous language.

Replace the browser's all-namespace fallback with a selective loader for requested feature slices. Rework `useNamespaces` to explicitly materialize catalog slices through that loader before marking them ready. Deduplicate in-flight loads per locale and canonical namespace set. Unknown namespaces and failed imports retain controlled loading/error behavior rather than marking an incomplete dictionary ready. Loading records must not trigger a redundant router refresh through Tolgee's permanent-change listener; explicit translation edits preserve their existing refresh behavior.

Separate the selective browser loader from server translation initialization. Server-only `getTranslate`, bot translations, and outbound notification localization can continue to use their existing catalog coverage. Reducing serialized client dictionaries does not require changing those consumers or contacting the Tolgee service.

On a language switch, resolve shared and current feature records for the destination locale before revealing feature content. Retain the existing locale cache behavior without mixing dictionaries across locales. Local catalogs are not tenant-specific; authorization for page data remains separate.

### Acceptance

- Direct loads and navigation across all route families retain translations in supported locales, including shared controls, authorization/no-employee errors, and lazy dialogs.
- Server and client rendering agree on primary keys and namespace aliases; overlapping trees merge without replacing unrelated keys.
- Rapid navigation and language switching cannot publish stale locale records or trigger refresh loops.
- Feature readiness waits for its needed slices, not all 35 namespaces. Root delivery and the fallback loader both avoid loading every namespace for an ordinary feature route.
- Representative initial serialized translation payloads and RSC responses are smaller than the baseline. Check the actual `loadNamespaces` merged/aliased output; source-file sizes alone understate that output's structure.
- Shared providers and the query client remain stable during route transitions.

### Main files

`src/lib/user-preferences/*`, the authenticated layout, time tracking rendering context, `src/tolgee/{shared.ts,load-translations.ts,client.tsx,server.tsx}`, locale translation providers/layout, route metadata and namespace mappings, and page/feature layouts supplying translation slices. The catalogs' keys and translated text remain unchanged.

## Verification and delivery

Keep four change boundaries. Change 2 depends on the render context from change 1. Change 3 is independent. Change 4 reuses the render session mechanism, consolidates settings first, and then verifies translation delivery before completing its change.

Use the project's existing unit and disposable PostgreSQL test approaches. Add behavioral tests for request isolation, query reuse, delayed streaming, export failure/retry, and translation merging/readiness. Reuse applicable existing auth, time tracking, and Tolgee tests. Do not substitute source-string assertions for actual rendering or browser correctness.

Run targeted tests, application/workflow-contract/smoke typechecks, formatting/lint, React diagnostics, and the required production build with `CI=true`. Use the Next.js development loop for changed Suspense/cache behavior and a production build/start for prefetch and bundle verification. A green build alone does not demonstrate useful prefetched UI. Document runtime checks that require operator-provided Phase configuration; agents must not acquire those secrets.

Use authenticated fixture environments for mutation, export, organization-switch, and preference-write checks. Production remains limited to explicitly authorized read-only navigation and inspection. Captured output must omit credentials and unnecessary employee information.

Before implementing tickets, publish/link the approved spec in GitHub, create its four native sub-issues, claim each started ticket with verified assignment and a start comment, and work on dedicated branches. Respect existing assignees. PRs target `dev`; normal review and deployment gates apply. Revert a problematic stage independently through Git rather than introducing permanent runtime flags. No database migration is required by this design.

## Review result

The written spec preserves the four agreed areas and separates persistent catalog caching from request-local auth reuse. It specifies region dependencies, safe error handling, explicit translation merging/fallback behavior, acceptance tests, and staged rollback. It does not promise an unmeasured speedup or treat the existing production observations as a historical regression. The next stage is user review of this document, followed by a detailed implementation plan and selection of its execution method.

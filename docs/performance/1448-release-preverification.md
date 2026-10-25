# Release preverification checkpoint (#1475)

This is a source checkpoint for preliminary review, not completed release acceptance.
The fixed comparison source remains `39a08d0bb`. Controlled original C1 capture
was running while these focused checks ran; no app build, runtime probe, original
fixture access or capacity scan was performed by this implementer.

## Public admission failures reproduced and repaired

The existing disposable PostgreSQL integration adapter and unique lifecycle fixtures
exercise real public handlers/actions. Only Next request/cache infrastructure,
controlled request-session inputs and external configuration are replaced. SQL,
membership, lifecycle access, billing evaluation, protected trial provisioning and
Clocking operations are real. The native Next cache is not tested by Vitest.

| Reproduced pre-change behavior | Result after repair |
| --- | --- |
| Notification count returned 200 after membership became pending | Count/list/PATCH/DELETE require fresh approved employee access, including due departures |
| Public clock-in successfully wrote with an MFA-required session | Web action admission denies MFA/SSO flags and freshly evaluated organization policies |
| Retained team-overview action returned protected data for a pending member | Retained Dashboard wrappers check fresh organization membership/lifecycle before reads |
| Hydration widget write accepted a pending member | Migrated hydration actions use the same fresh scoped admission |
| Retained presence action succeeded for a pending member | Its public wrapper checks fresh scoped admission before the shared reader |
| Direct Dashboard GET with no subscription provisioned a trial and returned 200 | Dashboard and employee GETs check billing without provisioning; missing subscription returns 402 |

Notification routes retain their original employee requirement and response shape.
Member-only admins still cannot use employee notifications. Dashboard preference
reads/writes and empty manager state retain their original member-only admin behavior.
The new scoped admission does not change the global AuthService session contract.
Clocking, work records, billing transaction guards and acquisition order are unchanged.
The employee resolver now uses the canonical lifecycle predicate instead of an
active flag alone. Accepted commands still receive transaction-time authorization.

The negative matrix covers actual revoked and pending membership, inactive employees,
due-but-pending departures, current-organization mismatch, missing sessions, explicit
MFA/SSO flags and newly enabled database MFA/SSO policies without session flags.
Clock-in/out, add-break, start-break and resume-break are denied without changing the
authoritative public live-work snapshot. Fresh checks add real authorization SQL;
the integrated runtime comparison must include that cost.

The billing GET tests also observe no subscription write before denial, then call the
existing mutation guard and verify that it still provisions a protected trial and
allows the next GET. Existing layout and mutation provisioning owners are unchanged.
There are no Stripe requests or external credentials in these checks.

## Growth guards and catalog generation

The original production inventory cap was 4,096 files. A root `git ls-tree`
inventory with the scanner's exclusions counted 4,081 files / 27,173,939 bytes at
the original source and 4,121 / 27,361,915 at integration `ce9c2510d` before this
checkpoint. The feature therefore crossed the cap. The proposed bounded capacity
is 6,144 files; independent 32 MiB aggregate, 2 MiB per-file, symlink/read-error,
prefilter and native-analysis guards remain. Exact-capacity detection and 6,145-file
fail-closed overflow tests are prepared. Their execution and actual filesystem/native
scan timing are **pending after C1**; this capacity is not yet a measured acceptance.

The current-roster source guard now names the shared production schedule/absence
and team readers, where the predicates moved, and retains the historical approval
reader classification. The public calendar remains listed. Three stale-owner guard
failures were reproduced; 90 selected ownership/history/classification cases pass.
The full raw-active-check inventory remains enabled, with a finite 15-second budget;
its final timing is pending. Runtime roster and history semantics are not relaxed.

Normal `pnpm run i18n:metadata` generated 18 locales / one shape. Its legitimate
three-key membership delta (`triage`, `approvalTriage`, `kioskBadge`) is committed;
no catalog values or collisions were hidden. Catalog-store/slices checks pass after
the required generation prerequisite.

## Evidence and pending gates

- 37 focused public admission PostgreSQL cases pass across notification, clock and
  retained Dashboard surfaces; two real PostgreSQL billing GET cases pass separately.
- 150 unit cases across seven auth/notification/Dashboard GET/catalog/billing files pass.
- 90 selected roster ownership/history/classification cases pass; seven unrelated cases
  were deselected by the explicit filter, not represented as a full-suite pass.
- Biome checked seven new/changed helper and integration files; Git diff whitespace check passes.
- Full unit suite with its normal generation prerequisite, full roster/inventory scans,
  capacity timing, all three type configurations, whole-spec React Doctor, CI build,
  compiled public/browser denial and performance/cache gates remain **pending**.
- Formal Standards and Spec review and all resulting fixes remain pending. No issue
  is closed and no release/PR readiness is asserted.

The mixed-load operator is being prepared separately and is not acceptance evidence.
Parent owns all runtime services and controlled captures. C1 repeat-link priming can
leave an earlier analytics calculation in flight, and Last Year → Custom Range can
include a prior annual action in its queue. Keep those exact before/head conditions;
their timing is a holistic journey, not isolated monthly-reader latency or proof of
a fully settled warm data cache. Missing production/CDN access remains a limitation.

## Preliminary review resolutions

The preliminary Standards review at integration `025336721` found no hard
documented-standard violation. Its P3 repeated-switch judgment is retained as
an intentional boundary: `dashboard-reads.ts` owns production readers/DTOs used
by GET, while `server-section-cards.tsx` owns rendering and Client Component
references. Combining loaders and renderers into one definition table would pull
the UI graph into the read/API module. Their shared `ServerWidgetId`/data map and
public per-widget tests retain the contract. No speculative cross-boundary
refactor was made for this nonblocking maintainability judgment.

The preliminary Spec review found one P2: rejected deferred Hydration/Birthday
module loading escaped Suspense and replaced the Dashboard through its enclosing
route error boundary. Two rendered tests reproduced that loss. A widget-local
error boundary now keeps the dimensioned region, alert and keyboard retry. An
explicit retry constructs a new lazy identity and invokes the loader again;
resetting an error boundary around the same rejected lazy object is insufficient.

Both tests use actual React.lazy and actual widget/QueryClient rendering, with a
controlled rejection at the imported module's export-resolution boundary. They
keep an edited sibling input's DOM identity/value, an interactive sibling's state,
and focus in the stable widget region. Successful retry performs one dataset GET.
The regression suite passes 16 cases across deferred loading, existing personal
widgets and combined refresh ownership. A deliberate mutation retaining the old
lazy object made both recovery tests fail; restoring the new identity passes.
No React.lazy mock, module-cache reset, whole-page refresh or route remount hides
the rejected-promise behavior.

The installed compiled Next 16.4.0 artifact uses string chunk paths for these
dynamic imports. Its terminal browser network failure deletes the chunk resolver
after the runtime's bounded automatic retry; a new import invocation can therefore
start a fresh chunk request. This source inspection is **not** the required final
compiled-browser proof. A real transient chunk failure through ingress, successful
local retry and usable actual header/siblings remain pending after C1.

## Post-capture loader type correction

The production TypeScript check reproduced two TS2345 errors in the deferred
boundary: indexing loaders inferred a union of components with incompatible
optional snapshot props. The deferred map now declares its actual no-props
ComponentType contract. Both implementations satisfy it without assertions;
loading and the fresh lazy identity on explicit retry remain unchanged.

Production, workflow-contract and smoke TypeScript configurations pass. Normal
Next type generation and ignored license generation pass. The lazy rejection,
personal widgets and combined refresh tests pass all 16 cases. File-level Biome
and React Doctor 0.9.17 schema-3 lint report no diagnostics for the corrected
component. Whole-feature unit, Doctor and broader quality gates are being run
separately; compiled browser and production-build gates remain pending.

## Full-check historical selection guard

The full roster inventory reproduced one added raw active check in recent
analytics identity metadata. Its shared population predicate now lives with the
existing historical analytics service and is reused by its readers and metadata
query. Historical active-only defaults and explicit inactive-employee work lookup
remain unchanged; current actor admission still uses the separate fresh lifecycle
rule. No roster-baseline exception, new module dependency, rich employee load or
query was added. All 97 roster guards pass (raw inventory 415 ms in the red run).

A real public caller/PostgreSQL regression retains work before a viewed employee's
due departure, excludes inactive employees from the default team population and
retains the explicit inactive employee's historical hour. All 11 recent analytics
cases pass; the affected eight-suite admission/analytics selection passed 91 cases
before adding that one case (overlapping coverage is not additive).

The exact 6,144-file injected-write capacity test passes in 3.795 s; 6,145-file
overflow fails closed in 2.465 s. Independent 2 MiB and 32 MiB guards pass in
4.5 ms and 106 ms. The actual filesystem/native production owner inventory passes
in 45.717 s. These are test durations under concurrent bounded quality checks,
not application latency or isolated scanner benchmarks. The later neutral DTO
adds one source; the admitted filesystem currently contains 4,124 files and
28,229,366 bytes, including normally generated ignored licenses, below all limits.
A final inventory rescan after all release source changes remains necessary.

## Shared presentation type dependency

The root Docker manifest check reproduced an introduced worker dependency on
Zustand. The fixed original's trace matched its manifests. The new server display
module imported its presentation type from the client store, which the repository
tracer follows even for type-only imports. OrganizationSettingsBootstrap now lives
in a dependency-free module consumed by both sides, with the original store type
export retained for callers. Runtime settings and hydration semantics are unchanged;
no unnecessary worker dependency or manifest exemption was added.

All 34 Docker tracer/manifest cases and 16 store/provider cases pass. The actual
RSC identity PostgreSQL suite passes, as does full production TypeScript. The
changed-source Doctor regression report is schema 3, complete, with zero errors
or warnings; scoped Biome passes. Broader source/runtime gates remain separate.

## Existing source and edge-test ownership

Full unit verification exposed stale expectations for the pre-extraction layout:
embedded membership SQL, the old settings prop, direct sidebar rendering and a
source slice that accidentally included the adjacent session helper. Those
existing guards now follow the actual render identity/region owners, retaining
approved membership, same-user/organization, fail-closed billing, locale redirects,
protected children and neutral loading assertions. They remain architectural
guards; actual RSC/PostgreSQL tests supply behavioral proof.

The render-context edge test's Drizzle stub also omitted sql after the canonical
lifecycle predicate replaced its raw active check. It now retains the real sql
constructor and expects the canonical predicate, plus the shared preferences'
actual allowlisted projection. All 14 render-context tests and 17 layout/banner/
pathname tests pass. No application authorization or denial behavior changed.
The initial full-unit run still contains its earlier failures and is not a pass;
a final bounded complete rerun is pending after resolving its full result.

The first complete two-worker unit run finished in 1,148 seconds: 19,410 passed,
16 failed and 38 skipped across 1,816 files. Fifteen failures were the corrected
existing render/layout guards. The remaining vacation assignment test queried
an async popup option synchronously under load; the same test passed focused.
Both selections now await the same accessible option using findByRole, preserving
all date, review and submitted-value assertions and existing timeout. Both focused
cases pass. The complete bounded rerun remains the acceptance check.

## Required completed-work regression gate

The first exact dev-PR PostgreSQL set passed 681 cases and failed 294. Its affected
request doubles returned only activeOrganizationId. The fresh canonical MFA/SSO
admission correctly rejects subjects missing session id and userId. Adding those
real session fields first repaired both vehicle-completion cases with the actual
policy gate intact. The same correction in the 12 affected suites repairs the
entire required set: **975 cases pass across 38 files, zero failures or skips**.
No production admission check, transaction protocol, assertion or policy mock was
weakened. The test fixtures still use the approved request/session seam; real
negative MFA/SSO and revoked/lifecycle admission tests remain separate.

The remaining managed-team regression now separates an outsider with no approved
membership (AuthorizationError) from an approved member-only administrator with
employment only in another organization (the original empty manager state).
Both real public-caller cases pass. The application code was unchanged.

The first integrated index catalog assertion correctly failed because the shared
disposable integration database had not applied the absence-index migration
(now named 0288 after base integration). Its owner applied
only the pending committed migration through migrate-with-lock.js/Drizzle after
checking the Docker label and exact loopback database. It independently verified
one valid, ready, nonunique, nonpartial index. The original performance database
was untouched. All 23 feature PostgreSQL suites are rerun against this prerequisite;
the prior failure remains recorded and is not hidden as a skip.

## Integrated source-check checkpoint

The normal application test command, including its catalog metadata prerequisite,
passes with maxWorkers 2: **19,428 tests pass, zero fail, 38 existing tests skip**;
1,811 files pass and the same five existing files skip. Duration: 1,065 seconds.
No test was skipped or disabled to repair this feature.

The required completed-work set passes **975/975 cases across 38 files**. The
remaining changed feature set, selected without overlapping those files, passes
**245/245 cases across 23 files** after the pre-base absence-index migration
(the same SQL now named 0288). These include fresh
public admission, real RSC identity, employee transport/selector and Dashboard
readers, historical analytics and the actual absence-index catalog/reader checks.
No PostgreSQL case skips. The earlier prerequisite and request-fixture failures
remain in private run records.

After merging integration a80c3ed50, normal Next typegen and all three TypeScript
configurations have passed for the integrated application source. The focused
instrumentation/roster run passes 104 cases. The final actual production write
inventory passes in 50.600 seconds. The complete root safety prefix passes 49
cases; newly integrated observer/budget checks pass 29, and the latest native
attribution subset passes 15 (these Node selections overlap, so are not summed).
The final whole-feature React Doctor error gate against 39a08d0bb completes all
237 selected files with zero errors, the same 14 reviewed warnings and no skipped
checks. Full-source Biome remains red on the original and feature; its baseline,
formatter differences and reviewed named-group diagnostic are not called a pass.
Scoped source/test checks and the introduced import fixes pass.

Application source is clean at 4d8bdb1d4. The parent began its controlled CI=true
production build from that exact pin using the real frozen dependencies. This
agent started no application build, server, collector, browser or live benchmark.
Subsequent changes in this checkpoint are documentation only.

Runtime acceptance remains open: compiled widget network-chunk failure/local
retry, native selector expiry and downscope, corrected controlled original/head
runs with complete registered native/SDK evidence, mixed public clock/analytics
load, resource/budget evaluation and final two-axis formal review. The legacy
mixed operator requires its separately assigned v2 registration/whole-run wire
proof before it can support acceptance. No ticket closure or PR-ready claim.

## Concurrent staging-base integration

The staging base advanced from `39a08d0bb` to `ec3414d16` with the independently
merged employee-deactivation work (#1437, PR #1449). The integrated candidate
retains that work alongside #1448; employee detail lifecycle sections and query
keys preserve both features. The approval boundary retains the new cancellation
owner and the measured 6,144-file limit with its exact-capacity regression.

The unreleased absence-index migration is now `0288_absence_employee_overlap`,
after the peer's unchanged `0284`–`0287`, with journal time `1809619200000`.
Existing private fixtures that applied its old journal entry must not run this
merged chain. Recreate final-head clones from the original dump through `0283`
and validate the full chain there. The original before database stays unchanged.

The source-check totals above describe the earlier application pin. Full source,
migration, type, build and semantic checks must be repeated after this base merge
before final head measurement. Controlled before remains business source
`39a08d0bb` with the frozen dependencies and fixture. A subsequent comparison
against this combined head includes the concurrent deactivation changes and
cannot establish an isolated #1448 effect.

## Fresh merged-fixture projection initialization

The first-missing CLI branch now uses the repository's normal `tsx --tsconfig
./tsconfig.json --import ./src/worker-preload.mjs` server loader. A real installed
`server-only` import fails without that preload and succeeds with it. Three focused
operator tests pass, including exact preservation of prior failed progress and
bounded private failure classification. Existing logs remain appended; each retry
copies the previous progress into a new private file before running the unchanged
production work-balance rebuild API. No business rows are reset.

Run `pnpm performance:test:projection` for the loader checks. For a freshly prepared,
incompletely initialized disposable fixture, set `Z8_PERFORMANCE_RUNTIME_DIRECTORY`
to its private directory and run `pnpm performance:test:projection:runtime`. This
explicit acceptance test requires a real first-missing rebuild, verifies 208 total
projections, then reruns the normal CLI and requires 208 preserved and zero rebuilt.
It refuses an already complete fixture; never delete projections to manufacture
this condition. The parent-owned acceptance passed on the fresh final functional
fixture at operator commit `ac2fb1133`: 208 rebuilt on the first run, then 208
preserved and zero rebuilt on retry. The fresh final primary fixture separately
rebuilt all 208 through the same CLI. Both used the explicit
`2026-10-24T12:00:00Z` as-of instant, retained prior failure evidence, and left
canonical business rows unchanged. This is separate actual database evidence
from the three focused loader/progress tests.

## Employee form initial-value correction

The corrected `e05959749` functional build exposed a real employee-detail form
defect. A fresh authorized public detail response contained both names and a
start date, and the browser's active session matched that caller. The enabled
form fields remained empty after the document completed and an additional
30-second readiness wait. A real submitted role edit carried empty names and
was refused by the existing required-name validation. No role change was
accepted, and the failure is retained separately from later verification.

The form now initializes TanStack Form with the authorized employee's existing
field mapping, also used when resetting its pristine baseline. This retains the
same date, invitation-contract, field-validation and submit rules. Fresh scoped
data still updates a pristine form; the existing dirty guard preserves a local
draft. Lifecycle controls and their authorization are unchanged.

The real edit-card/form first-render regression failed before the correction
(one failure, 32 passes), then the three focused employee-detail files passed
62 assertions. Coverage includes initial names/date before client effects,
preservation of a typed draft, and a clean server refresh that leaves Save
Changes disabled. Normal Next route type generation and all three TypeScript
configurations pass after this correction and the SDK-enum observer change.
Focused Biome passes for all three edited files. React Doctor reports no new
diagnostics against the preceding source (one existing diagnostic matched).

These source checks do not replace the required rebuilt browser acceptance:
accepted role reduction/restoration, selector invalidation and other-tenant
warmth, actual compiled widget-chunk failure/retry, and manual-refresh draft,
selection and scroll preservation remain pending on the next final artifact.

## Optional header selective hydration

A normal, uninjected Dashboard document on `eee1fc650` reproduced React error
418 at 812 milliseconds, before any deferred-widget activation. The real
`DashboardHeaderCustomize`/QueryClient hydration regression identified a concrete
ordering defect: the server renders an empty header control while waiting for
the body layout, but a streamed sibling can populate that shared query before
the header hydrates. The first client tree then inserts the Customize button
where the server emitted nothing, causing a recoverable HTML mismatch.

Only that optional control now uses a stable empty server snapshot. It reads the
existing shared layout after its own hydration; its hooks remain unconditional.
The clock, sibling regions and layout readers gain no dependency or request.
This does not opt the header out of SSR or suppress hydration errors. The real
hydrateRoot regression fails before the correction and passes for both layout
arrival orders afterward, preserving the existing clock node. The three focused
layout/customization files pass 22 tests, with zero new React Doctor diagnostics.

The real terminal chunk-failure cases separately observed two failed requests
for the same compiled birthday chunk, a local widget alert, and actual user
Retry followed by a third uncached HTTP 200 response (3,787 encoded bytes) and
successful public widget GET. Header, ready clock, Quick Stats and time origin
survived. The installed Turbopack runtime retries once itself; failing just its
first request therefore tested automatic recovery, not the local Retry control.
The target query suffix and actual Script requests are recorded privately; no
other asset, API or worker is faulted, and the active ServiceWorker did not cache
the target or serve its successful response.

These chunk trials remain separately retained overall failures: an initial
oracle counted same-document frame events as reloads; the corrected CDP oracle
proved one main document and one same-document transition, but another trial
observed the independent React 418. A prior terminal trial had zero page errors.
They are not combined into a fabricated fully passing run. Repeat the finite
case on the corrected compiled header artifact.

## Native closure diagnostics checkpoint

The incomplete refresh proof above motivates additive private observer fields:
server balance, server starts/ends, fixed HTTP/Next/other technical scope counts,
last-activity age, drained result and drain elapsed time. No span name, URL,
payload or new business identifier is retained. SDK span classification,
10-second cap, 500-millisecond quiet interval, query/acquisition/cache counts,
driver comparison and completion expressions are unchanged.

The SDK-enum fixture and real private control-server tests fail before these
fields exist, then pass with exact positive counts and an actual open Next
server still rejected after the unchanged ten-second cap. These are structural
span fixtures with the installed SDK enum, not SDK-provider-created spans.
The instrumentation/privacy set passes 16 assertions. The 12 operator checks
retain successful and failed close proofs, compare every previous accounting
field unchanged, and leave unknown query metrics null on rejected coverage.
Normal Next typegen and all three TypeScript configurations pass after both
the header correction and diagnostic addition; focused Biome passes.

The parent owns the final-only CI build at `31d67bbcb`. Rebuilt no-418 Dashboard,
terminal chunk/local Retry and refresh native-drain diagnosis remain pending.
The original before artifact is unchanged. No PR-ready or closure claim follows
from this source checkpoint.

## Compiled functional acceptance at 31d

The corrected `31d67bbcb` artifact passes the bounded functional cases in
[the numeric browser proof](evidence/1475-31d-functional-browser.json).
Three fresh-browser, uninjected Dashboard documents report zero page errors,
including no React 418. Each whole run reconciles 867 queries, with all 263
server spans ended (154 HTTP and 109 Next), zero server balance and successful
native drainage. These totals include authorized prerequisites and browser
prefetch; they are not isolated Dashboard reader costs or timing budgets.

The terminal compiled-chunk case passes in one complete trial: two observed
failures of the same exact Script, a local widget alert, actual user Retry,
and a third uncached HTTP 200 response containing 3,787 encoded bytes. Its
public widget GET succeeds with an empty birthday list, so the recovered empty
region is valid. The active ServiceWorker neither caches nor serves the target.
Header, ready clock, Quick Stats and time origin remain unchanged. CDP records
one main-frame document response/commit and one loader before and after the
fault/retry; the separate same-document transition is retained. There are zero
page errors. All 826 driver/SDK/received queries and all 325 server starts/ends
reconcile, with clean transport and native completion.

The employee refresh case also passes as one complete trial: one RSC request,
zero duplicate detail GETs, and one GET per auxiliary dataset. Draft, selection,
input identity and scroll survive. Its 1,699 queries and acquisitions and 37
cache operations reconcile; all 693 servers end (322 HTTP, 371 Next), server
balance is zero, last-activity age is 4,600 milliseconds and `drained` is true.
Native close takes 2.81 milliseconds. There are no page or transport errors.
These are diagnostic closure values, not user-response performance results.

The prior `eee1fc650` refresh cap remains failed with unknown cause; the new
successful run does not retrospectively explain it or imply an accounting fix.
The earlier zero-error positives and all failed trials remain retained. The
accepted role/policy cases retain their measured `eee1fc650` source qualification;
the current proof verifies identical Git blobs for the selector, public route,
canonical mutations and authentication service. The real 301-second expiry
observation remains qualified `ac2fb1133` awaited-GET behavior under its older
observer, not a relabeled final native run. Controlled performance, mixed load,
budgets and final formal reviews remain separate gates.

The functional window is closed: owned Chrome contexts and native registrations
are zero. The controller independently retained final v6 counters/metrics and
stopped the exact owned functional application. No further runtime or source
change follows this documentation checkpoint.

## Compiled captured-scope browser observation at de0

One functional-only, two-tab trial used a legitimate temporary membership and
employee in the other disposable fixture organization. The original organization
read succeeded. CDP then paused the actual compiled operational vehicle read with
its captured original scope; another tab publicly switched organization and
successfully read its new employee and vehicle status. Continuing the original
request without changing its body, headers or URL returned ScopeChanged without
data. The actual QueryClient original-scope entry held an error and no data.
Its visible local Retry succeeded after publicly switching back.

[The numeric observation](evidence/1475-de0-two-tab-scope.json) retains an overall
failed result despite those passing behavior assertions. All 2,102 driver,
native-start, native-end and received queries matched, with known rows, no query
errors, zero pending work and all 486 server spans ended. The harness's final
cleanup-drain catch lost its cause and prevented transport-snapshot collection.
The aggregate transport boolean over zero snapshots is vacuous and is not
accepted as strict transport evidence. Transport acceptance therefore remains
unknown; no complete browser-race gate or application defect is claimed.

The actor was verified back in the original organization before exact removal
of the three owned membership/employee/employment-period records. No canonical
time data or sessions were written by setup/cleanup. Eight normal fixture actors
were authenticated again, owned Chrome processes were zero, and the runtime
window was closed. No repeat or application change followed this failed trial.

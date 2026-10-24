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

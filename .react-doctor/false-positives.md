# React Doctor review notes

Reviewed with the installed React Doctor 0.9.13 (JSON schema 3), September 10, 2026.
These notes do not disable rules. Recheck the stated predicates when the code changes.
Paths below are relative to `apps/webapp` unless stated otherwise.

## Native form submission (`react-doctor/no-prevent-default`)

**Rejected when the submit handler owns a client-side form lifecycle.**
The following handlers call a TanStack Form submission or a client mutation after
cancelling the native browser submission. Cancellation is required to preserve
validation, pending state, errors, and the open dialog:

- `src/components/data-table.tsx`: editable cell forms and local toast feedback.
- `src/components/scheduling/shifts/shift-dialog.tsx`: shift editor submission.
- `src/components/settings/location-employee-dialog.tsx`: employee assignment dialog.
- `src/components/settings/subarea-employee-dialog.tsx`: subarea assignment dialog.
- `src/components/settings/payroll-export/lexware-config-form.tsx`: configuration form.
- `src/components/settings/payroll-export/sage-config-form.tsx`: configuration form.
- `src/components/settings/wellness-settings-form.tsx`: settings form.
- `src/components/settings/change-policy/change-policy-assignment-dialog.tsx`: TanStack Form submission.
- `src/components/settings/holiday/holiday-assignment-dialog.tsx`: TanStack Form submission.
- `src/components/settings/travel-expense/reimbursement-currency-settings.tsx`: TanStack Form submission (PR #738 review, October 7, 2026).

The installed `@tanstack/form-core@1.33.5` `FormApi.handleSubmit` takes submission
metadata, not a browser event, and does not cancel native submission. The payroll
access form test checks cancellation on the real submit event as well as the saved payload.
Do not remove `preventDefault()` to clear this warning.

## Table memoization (`react-doctor/react-compiler-no-manual-memoization`)

**Rejected as an automatic removal recommendation.** The explicit caches in these
files preserve references consumed by TanStack Table, rather than caching arbitrary
expensive-looking expressions:

- `src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`: table data depends on employee rows and the presence snapshot.
- `src/app/[locale]/(app)/team/team-members-list.tsx`: column definitions depend on translated headers and presentation labels.
- `src/components/licenses/license-table.tsx`: column definitions depend on translation state.

React Compiler is enabled in `next.config.ts`. That setting alone does not prove
these particular identity contracts are redundant. Require compiled-output evidence
and table interaction/locale-update tests before removing the caches.

## Carousel callbacks (three state/effect rules)

**Rejected while the value is the Embla instance, not mirrored application state.**
`src/components/ui/carousel.tsx` obtains its instance from `useEmblaCarousel` with
the carousel's own DOM ref, then publishes it through the existing `setApi` API.
The separate effect subscribes to and unsubscribes from Embla `select`/`reInit`
events. Moving this instance into a parent would change the public ownership API.
This applies to `no-pass-data-to-parent`, `no-pass-live-state-to-parent`, and
`no-prop-callback-in-effect` at the same `setApi(api)` occurrence.

## Locale routing (`react-doctor/rerender-defer-reads-hook`)

**Rejected for a replacement with `window.location`.**
`src/components/language-switcher.tsx` uses the locale-aware `usePathname` and
`useRouter` exported by `src/navigation.ts`. The locale change passes the router
pathname to `replace(pathname, { locale })`; a browser URL is not an equivalent
locale-stripped router pathname. No equivalent imperative snapshot was established.

## Sequential operations (`react-doctor/async-await-in-loop`)

These occurrences have concrete ordering constraints:

- `src/lib/audit-pack/application/audit-pack-orchestrator.ts`: the lineage traversal's next lookup batch is discovered from the current query results. **Rejected.**
- `src/lib/time-record/migration/backfill.ts`: the three legacy-link update loops use the same transaction connection. Parallel promises do not make those database statements concurrent. **Rejected as a promise-parallelization fix.**
- `src/lib/vault/secrets.ts`: the documented provider contract stores secrets sequentially because providers may not support atomic multi-write. **Rejected without a provider-contract change.**

Transaction-scoped and ordered server work is excepted in `doctor.config.ts` (PR #484
review, September 26, 2026, React Doctor 0.9.14). Awaits on one PostgreSQL transaction or
snapshot connection serialize in the driver, so `Promise.all` gains nothing and their order
carries lock acquisition and read-your-writes. The second group covers ordered side effects
outside one transaction (sweep before claim, count after cleanup, after-commit hooks). Reads
that were independent and ran on the pool were parallelized instead: bot approval routing,
clock command endpoint validation, review notification preferences, and the work-diagnostics
page. Remove a file from the exception list when it stops using one connection.

Other import, seed, demo-generation, and carryover candidates require measurements
and verification of cancellation, error ordering, transaction boundaries, and
service limits. **Needs evidence**, not an exception or a confirmed performance defect.
The same applies to the collection traversal/lookup suggestions: no representative
production profile was available during this review.

## Changed-scope complexity matching

The changed-scope scan also reports these already-existing complexity findings
after formatting or JSX label changes. Their metrics are identical in the initial
and final full reports; they are **not new complexity regressions** and remain
open maintainability observations, not suppressed defects:

- `src/app/[locale]/(app)/settings/payroll-export/page.tsx`: `PayrollExportContent`, cyclomatic 19, cognitive 21, nesting 2.
- `src/components/settings/holiday/holiday-list.tsx`: `HolidayList`, cyclomatic 18, cognitive 21, nesting 2.
- `src/components/settings/vacation/vacation-assignment-manager.tsx`: `VacationAssignmentManager`, cyclomatic 18, cognitive 21, nesting 2.

## Release PR #927 follow-up (October 9, 2026, React Doctor 0.9.17)

The release pass resolves compiler failures and refactors the reported component
size/complexity findings. The added exceptions in `doctor.config.ts` are limited
to the following verified boundaries:

- **Serialized database work:** Clockodo mapping upserts, project/template reads
  and writes, payslip upload reservations, retention purges, upload leases,
  canonical backfill, position-capture resolution/export audits, and Billable Time
  settings use transaction or snapshot readers. The clock path reads settings
  under its share lock before resolving the subject. Review these exceptions when
  a helper stops accepting or using the transaction reader.
- **Ordered rate changes and bulk amendments:** Rate steps remove overlap before
  inserting a successor. Bulk work changes acquire ranked owner/organization
  guards and finish their after-commit work in order. These are not independent
  requests to fan out.
- **Bounded reminder jobs and ZIP expansion:** Delivery stays at one tenant or
  reminder at a time; retention recipient reads populate a shared cache. ZIP
  members decompress sequentially to bound transient memory. Revisit these
  throughput tradeoffs only with transport-capacity and peak-memory evidence.
- **Client form submission:** `BillableCurrencyForm` uses TanStack Form validation
  and a caller-supplied client callback. Native form navigation bypasses that
  contract. This is the same exception as the client forms documented above.
- **Redacted works-council snapshots:** Position review rows are immutable server
  output, without client state, filters or reordering. Names can repeat and
  identifiers are intentionally withheld. Index keys cannot misassign editable
  state here. Revisit the exception if the section becomes interactive.
- **Read-only Clockodo wizard data:** `fetchProjectsMutation` performs a
  user-triggered fetch into wizard-local state; it changes no server record or
  cached query. No cache invalidation is required. The payslip staging request is
  likewise an upload-completion operation, now isolated in its client transport
  module; its effect owns Uppy subscription setup and teardown.

Independent accounting reads now overlap. Independent purge cleanups and import
insert chunks use bounded concurrency, with every in-flight worker joined before
an error is returned. The concurrency helper has tests for its limit, result order,
and failure joining.

## Release PR #1096 follow-up (October 11, 2026, React Doctor 0.9.17)

The compiler failures (`try` without `catch`, manual memoization, render-time
reassignment, an Effect Event called from a click handler) were fixed in code.
One finding is rejected:

- **Asynchronous native push listener (`react-doctor/effect-needs-cleanup`):**
  `src/components/notifications/native-push-bridge.tsx` gets its push client and
  listener asynchronously. The effect stores the `remove` handle the listener
  returns and calls it on unmount. A listener that attaches after unmount is
  removed at once through the `disposed` flag. The rule does not follow handles
  assigned inside an async setup, so the line is suppressed. **Rejected.**


## Release PR #1193 follow-up (October 14, 2026, React Doctor 0.9.17)

The release baseline reproduced 5 errors and 63 warnings against `origin/main`.
Compiler failures were fixed in source: an Effect Event now reads the latest
committed vehicle-warning callback from the debounce effect, export actions handle
transport failures without unsupported finalizers, and the kiosk action is defined
before its caller. Focused regressions cover debounce/cancellation, transport
failure retries and refreshed organization settings. Calendar and vehicle UI
branches were extracted, and the two expiry lead-time forms now share their
validation and field UI. Independent pool reads overlap; repeated lookups use
sets/maps, and number formatters are cached by locale and options with a fixed bound.

The new scoped exceptions have these observed predicates:

- **Transaction readers:** absence-change validation and retirement, demo vehicle
  writes, confirmed employment-term updates, skill-certificate expiry updates,
  position export audits, submitted-period content and vehicle form context all
  accept or operate on transaction readers. Preserve acquisition order and
  read-your-writes. Absence retirement publishes only after its transaction.
- **Bounded jobs:** driving reminders visit one tenant/employee at a time, as the
  existing reminder jobs do. The clocking job finishes one reminder family before
  starting the next. Export collection visits one category at a time; cleanup
  finishes one object's deletion and retry bookkeeping before taking another.
  The export sweep counts its ledger only after draining it. These exceptions
  preserve the current capacity and failure isolation; revisit with measured
  provider/database capacity and an explicit concurrency decision.
- **Server-only mailers:** billing, scheduled-export and security-alert templates
  import `server-only`. Their subjects, copy and render helpers do not participate
  in client Fast Refresh. Component rendering still uses JSX.
- **Storage serialization tests:** `notification-params.test.ts` deliberately
  round-trips JSON because `notification.metadata` stores JSON. `structuredClone`
  would test a different representation.
- **Client form submission and redacted snapshots:** the mileage form uses
  TanStack Form and client mutation feedback. Vehicle review rows, like the
  existing position review rows, are immutable redacted snapshots without editable
  state, filtering or reordering; names can repeat and employee IDs stay withheld.
- **Incidental JSX resemblance:** the proration table and invoice tables share
  four-column header structure but represent different domains and copy. Vehicle
  and position-capture assignment selectors belong to separate forms with different
  policies and downstream fields. The canonical duplicate-tree guidance explicitly
  rejects incidental resemblance and variants that evolve independently. The
  genuinely shared expiry lead-time form was extracted instead.

The vacation-accrual insertion loop remains an unsuppressed observation. It already
bounds writes to one chunk at a time, and no throughput failure was established.
Automatic approval review rejected the proposed parallel persistence change as
outside this PR-fix scope. Only its independent reads were overlapped; write order,
conflict handling and row totals remain unchanged.

The refreshed catalogs also exposed missing vehicle-use shell coverage and redundant
enterprise catalog loading on the nested audit-log page. The shell now projects
`timeTracking.vehicleUse`, including the header clock and approval views, and the
nested audit-log scope relies on its enterprise ancestor for enterprise copy.
Translation message files are unchanged; generated source metadata is refreshed.

CI's seven notification failures were reproduced using the actual Temporal formatter
bundled for Linux Node 24: the default numeric hour produced `7:00` instead of
`07:00`. Time presets now explicitly request two-digit hours for 24-hour display,
while 12-hour display keeps numeric hours. The same Linux harness turns green,
and named-zone/fixed-offset notification suites pass without changing instants.

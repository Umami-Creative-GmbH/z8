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

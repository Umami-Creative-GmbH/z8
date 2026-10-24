# Employee directory and detail reads (#1461)

## Production path

The directory uses the shared organization display bootstrap to start its scoped
GET without the approvals `getCurrentEmployee` Server Action. The existing
server detail page already loads and authorizes the target employee; it now sends
that result to the client instead of discarding it and requesting the same detail
again after hydration. The server validates the result's organization before
handing it to the client.

`/api/settings/employees/read/[dataset]` exposes directory, detail, schedule,
managers, employment-history and work-policies datasets. It freshly resolves
settings access, requires the expected user/organization to match the current
session, applies the existing billing guard, and calls the established business
readers. It rechecks session scope before returning data. Display headers and
bootstrap values grant no authority. Responses use `private, no-store` and the
existing SuperJSON envelope; the existing fetch utility revives Dates explicitly
at the JSON boundary.

Directory filters, pagination, current/former/draft semantics, member/invitation
views and personnel-file capability resolution remain with their current owners.
The directory's existing profile reconciliation remains inside its business
reader. Schedule and employment-history target lookups now include organization
in SQL before loading a target. Cross-organization targets produce a not-found
result. All field, lifecycle and employment mutations retain their public action
authorization and mutation logic.

Known real employee detail starts schedule, eligible manager choices, employment
history and policy choices independently. Policy choices can start as soon as
the active organization is established. Invitation drafts request none of the
real-employee auxiliary datasets and retain their separate write path; accepted
drafts cannot submit field edits. Managers retain their established restricted
target and personnel-file visibility.

## Cache and refresh ownership

Employee query keys include user, organization, target and relevant filters.
Manager choices and policy choices use their own scoped keys. Responses with a
different scope fail rather than populating the view. Employee custom-field
sections also include the viewer and organization while retaining the existing
server field-visibility reader and prefix invalidation.

The initial detail snapshot belongs to the RSC render for global view refresh.
The view refresh provider cancels its old client request and refreshes the server
props; the client accepts a newer server snapshot without remounting the page.
Auxiliary data belongs to TanStack Query. Explicit detail retry/manual refresh
invalidates each visible dataset once. A successful field save invalidates detail,
schedule and history once, the current viewer's directory lists and the target's
custom-field section. It does not refetch unrelated organizations' directories.

The existing TanStack Form now resets its baseline in one operation when loading
an untouched record. A refresh updates an untouched form and preserves typed
values in a dirty form. Selection, pagination and scroll are not reset by a new
page key. Optional read failures render an alert and retry action without hiding
the authorized detail; directory failures render an error rather than a successful
empty roster.

## Evidence and limits

Validation used local fixture data on 2026-10-24. The PostgreSQL suite used the
existing disposable database adapter and lifecycle fixture, with unique fixture
organizations and no database reset. The GET route ran with actual business
readers, Effect services and PostgreSQL queries. Only request/session and Next
boundary infrastructure were replaced. Billing was disabled in that fixture;
the production billing guard is preserved but this run is not billing-denial
evidence.

- The provider/caller test initially failed while the directory waited on the
  current-employee action. It now sends one directory GET and no old read action.
- Holding schedule completion does not delay successful manager, history or
  policy reads. The initial server-authorized detail remains visible and starts
  four auxiliary GETs with no redundant detail GET.
- Provider tests cover optional failure, rejected response scope, an old user's
  delayed response, administrator-without-employee bootstrap, invitation drafts,
  accepted-draft edit refusal and viewer-specific custom-field sections.
- Explicit manual refresh produces one GET for each of five visible datasets.
  A successful field save produces one detail, one schedule and one history GET.
- The focused unit/provider/page/form suite passes 93 tests. PostgreSQL route,
  selectable-employee and custom-field visibility suites pass 40 tests, including
  17 public GET cases. Full webapp TypeScript checking passes.
- React Doctor changed-code checking reports no errors. Its remaining
  maintainability findings concern control-flow complexity in the two established
  page components and two query hooks. These are recorded here rather than
  suppressing diagnostics or performing an unrelated component rewrite.
- The changed error/retry UI was checked against the current Web Interface
  Guidelines: semantic buttons with visible labels/focus treatment, alert/status
  regions and preserved form state. No new accessibility finding was identified.

These tests establish caller behavior and PostgreSQL authorization, not browser
latency or a production performance budget. Cold/return production-mode browser
journeys, actual request timing/bytes/SQL counts under representative history,
concurrent load, mobile/focus/scroll behavior, and the full restricted custom-role,
MFA/SSO and billing-denial browser matrix remain controller-owned acceptance gates
for #1448/#1471. Reference-selector caching and invalidation are the next ticket
(#1462); operational detail is not put in a long-lived reference cache here.

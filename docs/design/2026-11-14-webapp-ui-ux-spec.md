# Z8 webapp UI and UX refresh specification

Status: approved on 14 November 2026, including all ten product decisions, testing boundaries, page briefs and ticket breakdown. Publication is tracked in #1692.

Canonical spec issue: [#1692](https://github.com/Umami-Creative-GmbH/z8/issues/1692). This document is one specification, including its per-page briefs. Organizational issues arrange its execution; they do not introduce separate specifications.

## Problem Statement

Employees, managers and administrators move between workforce records, approvals, planning and configuration throughout a working day. Inconsistent headings, containers, controls and operational feedback make those transitions harder to scan and operate. A page can look similar to another while having a different authorized scope, time model or irreversible action, so visual consistency alone is insufficient.

The approved dashboard and time-tracking refresh establishes Z8's restrained visual direction and task-first organization. The rest of the webapp needs the same language while retaining every existing capability, permission, preference, calculation and recovery path. A single specification and complete route coverage must prevent independent route refactors from becoming different design systems.

## Solution

Apply the [approved UX language](../refs/ux-language.md) and [design context](../refs/design-context.md) through a small family of page and interaction compositions. Each page has a defined task, scope, primary action, main record or form and supporting context. Its implementation ticket combines the shared contract with the specific brief in this document.

Refresh real application components and behavior. Keep authorized reads, actions, data/state owners and domain calculations authoritative. The [dashboard/time-tracking direction](2026-11-14-dashboard-time-tracking-redesign.md) supplies reference composition; its prototype figures, demo interactions, missing controls and review toolbar are not production requirements.

### Coverage and ticket identity

| Page family | Persistent page templates | Redirect-only templates |
| --- | ---: | ---: |
| Authenticated workplace, team and operational pages, excluding settings | 52 | 0 |
| Settings | 68 | 19 |
| Authentication and public information | 10 | 0 |
| Platform administration | 9 | 0 |
| Onboarding | 9 | 0 |
| Initial setup | 1 | 0 |
| Shared report | 1 | 0 |
| Standalone initialization, kiosk and organization MFA | 3 | 0 |
| **Total** | **153** | **19** |

- One persistent route template receives one page ticket. Dynamic records, locales, query parameters, role variants, tabs and responsive/operational states belong to that same ticket.
- The 19 settings aliases are explicitly verified in their destination-page tickets. Preserve destination, locale, relevant query/tab state and access behavior; do not create separate visual-refactor tickets for them.
- `/` and `/time-tracking` are included as reference conformance tickets. Preserve the approved organization and verify any changes caused by the final shared contracts; do not repeat their redesign without an identified gap.
- Existing persistent legacy screens, including `/approvals` and `/travel-expenses/[claimId]`, remain in scope. Their existence is not permission to retire or consolidate them.
- Error/not-found boundaries and streamed loading states are owned by the relevant shared foundation and consuming page tickets. They are not additional page templates.
- Include the webapp experience inside the mobile store wrapper: safe areas, navigation, authentication handoff and offline behavior remain relevant. Separate marketing, docs, desktop and API endpoint implementations are outside the route inventory.

The [route inventory](2026-11-14-webapp-route-inventory.md) supplies stable IDs and exact template coverage. The [pattern inventory](2026-11-14-webapp-pattern-inventory.md) and [domain constraints](2026-11-14-webapp-ux-constraints.md) are supporting evidence, not competing product specifications. The [grilling record](2026-11-14-webapp-ui-ux-grilling.md) records agreed decisions and their provenance.

## User Stories

1. As an employee, I want each page to state my task and scope, so I can recognize what I am viewing before acting.
2. As an organization member, I want the active organization and affected person or period to remain clear, so I do not act on the wrong records.
3. As a manager, I want authorized decisions and exceptions to be prominent, so I can resolve work without searching through unrelated summaries.
4. As a person without management access, I want a useful personal layout, so unavailable team modules do not leave misleading gaps or empty manager sections.
5. As a user, I want related summaries to read together with their units, periods and authoritative targets, so I can compare values without mistaking estimates, balances or unavailable data for one another.
6. As a user, I want meaningful records and working controls to lead record pages, so decoration does not displace my task.
7. As a user, I want every existing destination and action to remain reachable after reorganization, so the refresh does not remove capabilities.
8. As a desktop user, I want sidebar expansion, collapse, shortcuts and persistence to remain usable, so I retain my working space and navigation habits.
9. As a phone user, I want navigation, organization switching, search and account controls to remain accessible, so I can complete the same tasks on a small screen.
10. As a keyboard user, I want visible focus, named controls and predictable overlay focus return, so I can navigate and operate every affected task.
11. As a user with larger-text preferences, I want readable labels and wrapping layouts, so increasing text size does not hide information or actions.
12. As a user, I want the same hierarchy and status meaning in light and dark modes, so theme selection does not change how I interpret the application.
13. As a user of another supported language, I want translated, locale-aware controls and values, so layout changes do not introduce raw keys, ambiguous dates or clipped labels.
14. As a list user, I want search, filters, sorting, pagination and selection to retain their current meaning, so visual changes do not silently alter which records I act on.
15. As a phone list user, I want identity, status and useful actions first with all other fields accessible, so a concise view remains a complete workflow.
16. As a report or planning user, I want to compare genuinely wide records through local scrolling when necessary, so mobile adaptation preserves the comparison task.
17. As a bulk-action user, I want the selected scope, eligibility, pending state and partial outcomes to remain clear, so I can assess the effect before and after submitting.
18. As an export user, I want the existing formats, period, scope, redaction and delivery lifecycle preserved, so downloaded evidence agrees with the viewed workflow.
19. As a person editing a record, I want a consistent contextual panel with visible save/cancel behavior, so ordinary changes feel familiar across pages.
20. As a person completing a long configuration or onboarding task, I want appropriate sections and existing step navigation, so the form remains understandable without a cramped modal.
21. As a person submitting a form, I want validation near the affected fields and retained values after failure, so recovery does not require re-entering my work.
22. As a user, I want existing draft, cancellation and unsaved-change behavior preserved, so moving a form does not discard input.
23. As a user performing a consequential action, I want its existing reasons, evidence and confirmations retained, so a consistent container does not weaken the decision.
24. As a user, I want loading, empty, filtered-empty, unconfigured, restricted and failed states to remain distinguishable, so I do not mistake missing information for zero or success.
25. As a user, I want refresh to update the real data owners while retaining usable data and drafts, so refreshing does not restart my page.
26. As an employee clocking work, I want every clock surface to agree on working, break and stopped state, so I can trust the action and displayed totals.
27. As an offline user, I want queued, uncertain, saved, refused and review-required outcomes to remain truthful, so the interface never invents confirmation.
28. As a time-record user, I want durations and captured endpoint offsets preserved, so visual grouping does not reinterpret audit evidence through my device timezone.
29. As a manager viewing another employee's calendar, I want that employee's calendar context preserved, so records near midnight and period boundaries remain correct.
30. As a planner, I want scope, period, availability and publish warnings to remain connected, so presentation changes do not detach a decision from its evaluated evidence.
31. As an approver, I want the correct kinds, audiences, records, reasons and workflow outcomes preserved, so a shared queue appearance does not merge distinct approval rules.
32. As an officer or verifier, I want my actual grants and scope to govern controls and records, so visual consistency does not broaden access.
33. As a settings user, I want named configuration tasks, current values and explicit save/error feedback, so I understand what a change affects.
34. As an account holder, I want personal account/security tasks to retain their own authorization and recovery, so an organization-settings refresh does not change account access.
35. As a platform administrator, I want privileged tasks and their global scope to remain distinct from organization administration, so similarly named roles are not confused.
36. As a person signing in, I want branded and alternative authentication paths and their recovery states retained, so a simplified screen does not block an existing way into my organization.
37. As an invited or onboarding user, I want the intended organization, progress and access checks preserved, so moving through screens does not imply permissions I do not have.
38. As a first administrator, I want the existing secure setup and expiry/retry guidance preserved, so the setup page remains a controlled bootstrap workflow.
39. As a shared-report reader, I want the frozen and redacted snapshot and its safe unavailable state retained, so a cleaner page does not imply access to live or additional data.
40. As a user with saved widget, layout, theme or other preferences, I want those choices to survive the refresh, so the default design does not overwrite my setup.
41. As a user of an optional or restricted module, I want enabled, disabled, missing-configuration and unavailable states to keep their current meaning, so restyling does not activate a feature or imply new authority.
42. As a reviewer, I want a capability map, actual before/after evidence and explicit verification limits for every page, so I can assess preservation rather than judging a screenshot alone.

## Implementation Decisions

### Preservation and ownership

1. Before implementing a route, map its destinations, actions, fields, reads/state owners, permissions, role/feature variants, keyboard interactions and saved preferences. Record the refreshed location and verification evidence for each capability. The brief below supplements this inventory; it does not replace it.
2. Retain existing domain models, authorized reads/actions, payloads, query boundaries, calculation sources, snapshots, state transitions and recovery mechanisms. Shared presentation receives the context and actions it needs; it does not become a universal business controller.
3. Preserve route URLs, deep links, redirect contracts and existing filter execution/selection semantics. New saved views, changed bulk-selection scope, retired workflows or new canonical URLs are separate product changes.
4. Honor repository conventions for organization scoping, Temporal and explicit zones, TanStack Form, Tabler icons, translations, server/client boundaries and concurrent work. Keep generated auth schemas and generated translation catalogs under their established workflows.
5. Preserve persisted choices and their existing storage owners. Do not reset widget ordering/visibility, column choices, navigation state, work location, theme, text size or route-specific selections to make the default composition easier.

### Visual and page grammar

- Use the existing friendly tech-blue direction, app font, theme tokens and spacing scale. Primary color signals primary actions, selection and relevant progress; status color has text or icon redundancy. Preserve meaningful user-configured category colors and existing organization branding rather than substituting prototype colors.
- Prefer fine borders, restrained radii, aligned sections and meaningful surfaces. Related metrics share a strip or aligned surface; rows use spacing/dividers. Avoid nested cards around routine values, decorative gradients, arbitrary icon colors and oversized empty illustrations.
- Each persistent page has one semantic main heading. The page heading states the task with useful scope/person/organization/period context and a named primary action when applicable. A subtitle must supply useful information rather than repeating the title.
- The shell header provides location and global utilities as a route adopts its own page title. Stage heading ownership: retain a title for unconverted consumers while adding page-owned headings atomically. Do not create duplicate headings or leave routes such as Calendar without a main title during migration.
- Overview pages lead with related summaries and attention; queues lead with actionable work and scope; records/reports lead with records and their controls; calendars/planners lead with selected scope and period; configuration pages lead with named settings and fields. Supporting context follows the primary task on phones.
- Bound reading-heavy content on wide displays. Allow records, reports and planners the room needed for their task; use a deliberate form/reading width for long text and configuration. Do not force every screen into the dashboard's columns or one universal maximum-width card.
- Keep production labels readable under existing font preferences and browser zoom. Use tabular numerals for comparisons and records, units beside values, and locale-aware formats. Unknown, pending and failed data are not formatted as zero.
- Light/dark variants keep the same hierarchy and meaning. Use paired semantic tokens and inspect contrast, focus and disabled/pending treatments in both themes. Respect reduced motion; transitions must not delay operational work.

### Shells, navigation and entry surfaces

- Preserve every current destination and capability-derived visibility, organization switching, account controls, search/shortcuts, notifications, global clock, saved timezone, refresh, help and platform administration.
- Desktop expansion/collapse retains the icon rail, accessible names/tooltips, active-route indication, toggle feedback, keyboard operation and persistence. Mobile navigation retains separate drawer state, scrolling, Escape/dismissal, safe areas and focus return.
- Apply shared changes to all consumers. Keep page state and selected route stable when the shell resizes, collapses or refreshes. Header overflow on phones retains labeled access to every utility.
- Auth, public, setup, onboarding, kiosk, MFA, shared-report and platform-admin shells keep their own purpose and admission. Apply restrained typography/surfaces/spacing and state treatment without adding inappropriate workspace navigation or erasing organization/domain branding.
- Keep system-browser/store-app sign-in handoff, callbacks, verification, alternative authentication methods, Turnstile and sensitive recovery paths intact. Preserve legal/information links and safe unavailable states. A generic public form must not replace setup, MFA or a token-shared report workflow.

### Records, filters and exports

- Keep comparable records in aligned lists/tables with stable identity, readable status and useful actions. Preserve native table semantics where cross-row/column comparison is the task.
- Keep search, filtering, sort, pagination, selection and bulk/export actions close to the record. Preserve immediate versus explicit Apply/Generate execution, current reset behavior, selection scope, page size, query/local/persisted state and pending/partial outcomes.
- Ordinary phone records prioritize identity, status and useful actions; secondary fields remain reachable through accessible details. Comparison-heavy reports/planners may scroll locally with reachable identity/actions. Keep every field and action; do not use whole-page overflow or silently hide a column.
- Reuse existing responsive table behavior without rendering duplicate desktop/phone mutation forms. Verify mounted controls, labels, sorting, selection, inline edits and focus across responsive changes.
- Group history by a meaningful boundary when useful, with authoritative subtotals and full-record access. Preserve descriptions, endpoint context, correction/decision controls and all fetched rows; a preview must lead to complete history.
- Export, download, share and queued delivery keep their existing datasets, formats, period/scope, redaction, readiness, one-time reveals and failure/retry lifecycles. Consistent placement is not permission to replace a domain export with generic table CSV.

### Forms, detail panels and confirmations

- Ordinary create/edit tasks use a consistent contextual side-panel pattern. Short confirmations use dialogs. Long/multistep configuration and onboarding retain full-page/wizard space. Purpose-built authentication, operational recovery and evidence review use the family member that preserves their task; document justified exceptions.
- Reuse existing field and overlay primitives, including their compatibility, scrolling, safe-area and focus behavior. Use TanStack Form for editable forms and touched legacy-form migration under repository conventions. Do not turn native download/transport boundaries into new stateful CRUD flows.
- Keep labels visible, validation associated with fields, submitted scope explicit and default values/payloads typed. Preserve field and form validation, draft lifetime, unsaved-change/cancel behavior, required reasons, evidence acknowledgment and current mutation-in-flight dismissal rules.
- Keep input after failure, prevent duplicate pending submissions, expose a useful retry, and announce feedback. Provide confirmations/undo appropriate to current consequences; do not add confirmation to routine reversible actions merely for uniform appearance.
- Inline details, histories, uploads, secret reveal/copy, versioning and on-behalf context remain reachable. Moving them into a panel must not reset state, broaden access or change transaction boundaries.

### Operational feedback and refresh

- Distinguish first load, refetch/stale data, empty scope, no filter matches, all clear, unconfigured policy, restricted access, partial failure, full failure, pending mutation and recovery. Use consistent visual families while the domain owner supplies truthful meaning and allowed next actions.
- Keep refresh attached to the existing combined data-refresh mechanism and registered readers. Refresh real state without remounting drafts, resetting selection or hiding usable data behind a new full-page loader.
- Preserve shared clock synchronization across all surfaces. A changed clock state must reconcile the relevant server totals and record views; active/break/stopped labels and values must agree using the current authoritative model.
- Preserve offline queue, frozen command identity, uncertain/not-committed/saved/review-required distinctions and synchronization feedback. Do not turn a queued or uncertain outcome into a confirmed-success toast.
- Keep failure/retry close to the affected task and retain global connectivity/deployment/consent/banner behavior. Sensitive exact-item, auth and public-token boundaries retain their deliberately generic unavailable responses where more detail would disclose protected information.

### Domain boundaries and deliberate differences

- Authorize data and mutations server-side in the active organization and target scope. Hiding a control is presentation, not authorization. Preserve settings access versus object-level permissions, custom-role base behavior, current-roster restrictions, platform-global administration and independent officer/verifier grants.
- Keep selected-employee calendar zones, organization-local planning/policy dates, captured endpoint offsets and compliance/submission week rules explicit. Compute durations from canonical UTC instants and use authoritative shared helpers; a single viewer timezone is not a universal business context.
- Preserve legitimate calculation differences. The legacy dashboard monthly estimate prorates weekly hours across calendar time; time tracking sums actual daily requirements. Day totals, compliance totals, policy-resolved absence days, captured evidence, live prices and frozen export/invoice baselines have different owners and meanings.
- Keep approvals, deputy decisions, submission/recall, closed months, compliance publishing, reimbursement, invoices, payroll exports, document evidence, employee departure/rehire, licence checks and equipment obligations in their existing workflows. Shared pills/panels must not merge their states or required acknowledgments.
- Optional features, configuration, release gates, subscription access and permissions are separate. Restyling must not activate a module, reopen a rollout or change billing recovery eligibility. Preserve currently distinct CTA authorization sources pending a separate domain decision.
- Keep public shared-report snapshots distinct from coded scheduled-export downloads, account verification distinct from organization MFA, and controlled initial setup distinct from ordinary signup.

### Shared foundations and proposed work graph

The inventory supports three additional shared-pattern tickets. These are planning IDs, not published GitHub numbers.

| ID | Deliverable and owner boundary | Dependencies and adoption |
| --- | --- | --- |
| **F1** | Shared shell/page composition, title ownership, visual tokens/typography, scope/action regions and operational-feedback presentation. Preserve navigation, personalization, refresh/state owners and cross-shell security. Own common error/not-found/loading presentation. | Requires the approved dashboard/time-tracking baseline from #1689 in the implementation base. Introduce compatible, staged adoption; keep unconverted routes functional. Every page applies the contract, with implementation edges only for required changed outputs. |
| **F2** | Record views and filter/toolbars: existing table/list presentation, task-based phone adaptation, sorting/selection/pagination affordances, scope/period/export placement and reusable slots. Queries, selection meaning and domain exports remain with consumers. | Depends on F1's composition interfaces. Prove a local-list and a server-paged consumer before dependent adoption. Only relevant record/queue/report/planner routes require this output. |
| **F3** | Form/overlay presentation: existing TanStack field/validation composition, side panels, confirmation dialogs and full-page/wizard conventions, focus, pending/close/scroll affordances. Form payloads, security, drafts and mutations remain with consumers. | Depends on F1's composition interfaces. Prove ordinary editing and a consequential reason/evidence interaction before dependent adoption. Only consumers needing changed form/panel/confirmation outputs are blocked. |

Reuse current components where their contract already meets the spec; do not create a new framework or abstract business state to justify a foundation ticket. F2 and F3 can proceed in parallel after F1 supplies their shared composition interfaces. Applying F1's design contract does not automatically create an implementation dependency: routes using a changed common shell wait for that shell's owner; standalone layouts can adopt existing compliant primitives independently. A brief's shared-work references identify relevant contracts; the reviewed ticket breakdown names actual outputs that block adoption.

Source inspection proves these additional handoffs. Owners implement and demonstrate reused presentation; receivers retain their own authorization, arrival states and page tasks. A dependency does not transfer domain authority.

| Presentation owner | Receiving page | Shared output |
| --- | --- | --- |
| R011 — `/approvals/inbox` | R012 — `/approvals/review/[organizationId]/[kind]/[id]` | Approval detail and decision panel. |
| R014 — `/calendar` | R015 — `/calendar/[employeeId]` | Calendar page composition and controls. |
| R019 — `/equipment` | R021 — `/equipment/employees/[employeeId]` | Equipment assignment records and filters. |
| R021 — `/equipment/employees/[employeeId]` | R093 — `/settings/employees/[employeeId]` | Employee equipment section. |
| R044 — `/payroll/work-balances/[employeeId]` | R093 — `/settings/employees/[employeeId]` | Work-balance section and its existing actions. |
| R046 — `/personnel-files/[employeeId]` | R093 — `/settings/employees/[employeeId]` | Personnel-file panel and evidence controls. |
| R105 — `/settings/export` | R107 — `/settings/export/history/[organizationId]` | Export settings view, with History selected after receiving-route organization reconciliation. |

| Organizational group | Page tickets | Purpose |
| --- | ---: | --- |
| G1 — Workplace, team and operations | 52 | Authenticated non-settings workflows, including the two reference conformance tickets. |
| G2 — Settings | 68 | Settings/account/configuration routes and coverage of all 19 redirect aliases. |
| G3 — Entry, onboarding and public experiences | 24 | Auth/public information, onboarding, setup, shared report, initialization, kiosk and MFA. |
| G4 — Platform administration | 9 | Global platform-administrator routes, distinct from organization authority. |

The single root spec has three foundation issues, one administrative foundation-handoff issue and four organizational groups beneath it; each page issue is a native child of its group and explicitly references the root spec and stable route ID. This is the user-approved exception to the repository's direct-spec-child rule. Groups are tracking containers, not substitute implementation tickets or alternate specs. This gives **153 page issues + 3 foundation issues + 1 handoff issue + 4 grouping issues = 161 new subordinate issues**; #1692 already exists. Dependencies use native blocking edges only where real work gates a consumer. Root completion requires all applicable route/foundation acceptance and integration verification, not merely closing grouping issues.

### Native dependency capacity accommodation

During publication, GitHub rejected a new F3 blocking relation with HTTP 422: “Target issue cannot have more than 100 blocking relations.” The original graph required F3 to block 111 issues. Introduce **H1**, an administrative foundation-readiness handoff blocked by F2 and F3, for the 75 pages that require both. Each of those pages is blocked by H1 rather than two direct edges. F2 and F3 still execute in parallel; every pre-existing page retains exactly the same reachable foundation and route prerequisites.

H1 verifies that both approved demonstrations are complete and their record/form interfaces can be consumed together, reusing their evidence. It creates no additional UI pattern, feature, domain authority or route scope. Keep the four organizational groups as tracking containers rather than turning them into blockers. The resulting graph has 161 subordinate issues, 159 native blocking edges and a maximum blocking fanout of 75. All page briefs and 19 alias owners remain unchanged.

The [numbered ticket breakdown](2026-11-14-webapp-ui-ux-ticket-breakdown.md) records proposed titles, actual blockers and complete deliverables. It is an execution index of this spec, not a second design specification. Review it with the testing boundaries before publication.

## Testing Decisions

### Test boundaries

Prefer observable behavior through existing component/route and domain integration seams. Shared-foundation tests exercise the assembled user-facing contract; per-page tests verify changed interactions and important preserved variants. Reuse existing authorization, timekeeping, workflow, refresh/draft, table/mobile and overlay suites. Do not add tests that only repeat class strings or mirror an implementation.

- **F1:** navigation and title ownership during staged adoption; expanded/collapsed persistence and shortcuts; phone drawer/focus/safe areas; global actions and refresh without draft reset; honest feedback and cross-shell restrictions.
- **F2:** local and server pagination/filter/sort contracts, stable IDs/selection scope, phone details versus local scroll, action reachability, full history and domain export/bulk behavior. Existing DataTable responsive/control suites and holiday server-query versus local approval/portfolio consumers supply prior art.
- **F3:** labels/errors/focus, typed defaults and real submission, pending duplicate prevention, failure retention, save/cancel/dismissal/draft lifetime, nested-overlay return focus and reason/evidence requirements. Existing TanStack form and ActionPanel/Dialog behavior supplies the seam; retain compatibility wrappers.
- **Each page:** verify its capability map, primary task/action, actual access/feature states, preserved reads/mutations and applicable shared contracts. Inspect successful changes in real records/state rather than only a toast or mocked click handler.
- **Sensitive domain paths:** retain existing integration coverage for organization/target scoping, captured offsets/DST boundaries, approval evidence, recovery/idempotency and lifecycle semantics. Visual snapshots cannot replace domain assertions.

### Runtime acceptance for every page

Use a guarded disposable fixture or another authorized non-production environment with representative real records. Compare before and after in the same meaningful scope. Do not replace real application reads/actions with prototype values to make a screenshot.

1. Account for every existing field, action, destination, state, permission, shortcut and preference; record where moved controls now live.
2. Exercise admitted roles and meaningful restricted/read-only/feature variants by actual capability boundaries. Where applicable, switch organizations during an in-flight read or mutation and revoke authority while a panel is open: stale records/action targets must not appear current, and late submission must be refused safely with recoverable input retained where the security boundary permits it.
3. Inspect desktop around 1600px, phone around 390px and a wide layout in light/dark themes. Check larger text/zoom, long translated content, keyboard/focus and unintended overflow. Check expanded/collapsed and mobile navigation when that shell is used.
4. Verify meaningful loading, empty/no-match, unavailable/unconfigured, failed/retry, pending and active operational states. Retain honest sensitive-unavailable responses and offline/recovery distinctions.
5. Exercise changed real actions, cancellation and important failure/recovery paths. Verify shared-state consistency, persisted preferences, back/deep-link/selection behavior and synchronized period controls where applicable.
6. Capture actual before/after evidence and relevant operational states. State fixture, role, scope and data differences; screenshots alone do not prove functionality.
7. Run appropriate regressions, required React performance/composition/accessibility skills, React Doctor and applicable runtime verification. Complete type/build/integration checks appropriate to the change and known baseline.
8. List each skipped or blocked check with its exact dependency and scope. Unavailable checks do not pass by implication. Complete independent work and retain unresolved acceptance before calling the page or root rollout verified.

Use shared-foundation coverage for exhaustive common primitive interactions while checking each page's own layout, actions and critical states. Avoid multiplying identical primitive tests across 153 pages. Do not omit an applicable role/domain path because another consumer passed.

### Integration and known verification limits

The prior [refresh verification](2026-11-14-refresh-verification.md) supplies before/after evidence and baseline checks, not blanket acceptance for this rollout. Its complete production static generation did not finish, although optimized compile mode passed. New Tolgee keys also required configured catalog synchronization. These remain explicit verification items; unrelated build/credential failures are not silently attributed to, or declared fixed by, a visual ticket.

Root verification checks route/alias coverage, shared-consumer consistency, applicable full application checks and catalog synchronization. Close or explicitly retain every material outstanding check. Follow repository environment rules; never use production secrets or customer records to manufacture evidence. Use safe local fixtures where supported and report unavailable provider/system-configuration checks precisely.

## Out of Scope

- Rebranding, new fonts or a separate visual direction.
- Feature removal, route retirement/consolidation, changed canonical URLs, new saved-view/filter semantics or silently reset preferences.
- New domain calculations, authorization levels, approval/lifecycle rules, billing entitlements, authentication providers or security policy.
- Replacing data owners, broad database/schema migrations, universal business controllers or unrelated architecture rewrites.
- Separate marketing/docs/desktop applications or backend endpoint redesign. Existing endpoints remain correctly wired from the refreshed page.
- Blanket conversion of unrelated legacy date/form code. New/touched business-date logic and editable forms follow conventions as part of their legitimate change.
- Claiming complete browser/provider/build/translation acceptance when its required environment or check was unavailable.

## Further Notes

- Use established domain terminology in labels, states and tickets. Keep actual domain-documentation gaps separate from presentation vocabulary; discovery does not authorize resolving permission/lifecycle differences by restyling.
- Recheck current source before implementing and route coverage before publication/root completion. Preserve concurrent work and newly added routes; the checked inventory is a snapshot.
- Route tickets are claimable complete-page workflows with their role/query/state variants, concrete brief, capability map, actual blockers and verification evidence. Avoid arbitrary linear route sequencing.
- Use dedicated branches and repository ticket-ownership/review rules. The integration target is `dev`; this spec does not authorize merge or deployment.

## Per-page composition briefs

The briefs cover all 153 persistent pages by stable inventory ID. They supplement the shared contract and implementation-time capability map. Destination briefs explicitly cover all 19 redirect-only aliases.

<a id="r001"></a>

### R001 — /

- Task and scope: Give the active organization's member a personal work overview, with team oversight only where authorized.
- Primary action: Use the existing clock, leave request, attention links or Customize control appropriate to the visible module.
- Composition: Preserve the approved date/greeting, summary strip, attention/team main column, personal-day/leave/history support and disclosed secondary widgets.
- Preserve and verify: This is reference conformance: close outstanding role, timezone, offline, mutation, translation and billing checks; retain widget order/visibility and synchronized clock state.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r002"></a>

### R002 — /absences

- Task and scope: Let an employee review their own absences and vacation balance for the current organization-calendar year.
- Primary action: Add absence through the existing request flow.
- Composition: Lead with year and balance context, then the calendar/table switch and full absence record; place request action beside view controls.
- Preserve and verify: Keep holidays, categories, half days, deputy and sick-note paths, approved-change proposals and table actions. Distinguish missing/conflicting policy and zero-working-day setup from an empty calendar; verify balance calculations and failed submission recovery.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r003"></a>

### R003 — /accept-invitation/[invitationId]

- Task and scope: Review an invitation to the named organization using the intended recipient account.
- Primary action: Accept the valid invitation; offer sign-in or signup when authentication is needed.
- Composition: Use a bounded branded flow with organization, inviter, invited email and role context before the action; place account mismatch guidance beside account switching.
- Preserve and verify: Retain expiry/status refusal, matching-email checks, callback continuity, sign-out recovery, pending/error feedback and successful initialization handoff. Joining retains current membership and reactivation rules.
- Shared work: F1 auth-shell presentation and states; F3 focus and action feedback.

<a id="r004"></a>

### R004 — /analytics

- Task and scope: Give managers and workforce admins organization analytics for the selected date range.
- Primary action: Inspect the range and export its existing team-hours summary.
- Composition: Place range/export controls above an aligned employee/hours/absence/approval summary, followed by team/absence charts and manager/team/type approval bottlenecks.
- Preserve and verify: Keep organization-zone presets, current-month initialization and independent data failures. Approval analytics unavailable must remain distinct from zero; verify background refresh retains the selected range and that exports match their existing team dataset.
- Shared work: F1/F2; owners unchanged.

<a id="r005"></a>

### R005 — /analytics/overtime-burn-down

- Task and scope: Let managers and workforce admins compare overtime reduction across the active organization's selected period and grouping.
- Primary action: Set the existing filters and export the resulting breakdown.
- Composition: Lead with period, team, cost-center, manager and breakdown controls; align current overtime/change/direction summaries above weekly trend and comparison records.
- Preserve and verify: Retain all-team defaults, grouping dimensions, previous-period comparison, export scope and explicit empty trend/breakdown states. Verify organization-zone presets and filter/range retention during refresh or failed reads.
- Shared work: F1/F2; owners unchanged.

<a id="r006"></a>

### R006 — /analytics/team-performance

- Task and scope: Let managers and workforce admins compare organization teams during a selected date range.
- Primary action: Review the comparison or export its existing team performance data.
- Composition: Keep range/export controls together; lead with the team comparison and detailed hours/employee/status record, with overtime and undertime as supporting comparison.
- Preserve and verify: Retain organization-zone presets, employee counts, per-employee averages, variance/status meaning and authoritative totals. Verify empty periods, failed background refresh and export consistency; allow local scrolling where phone comparison requires columns.
- Shared work: F1/F2; owners unchanged.

<a id="r007"></a>

### R007 — /analytics/vacation-trends

- Task and scope: Give managers and workforce admins vacation utilization and employee balance comparisons for the selected organization period.
- Primary action: Inspect the chosen range and export the existing vacation dataset.
- Composition: Lead with period and utilization summary; give employee allocated/taken/remaining records a clear comparison surface, with monthly usage and peak months supporting it.
- Preserve and verify: Keep organization-zone presets, utilization units and existing allowance sources. Verify unavailable configuration, empty periods, failed refresh and exported values; phone comparison may scroll locally without losing employee identity.
- Shared work: F1/F2; owners unchanged.

<a id="r008"></a>

### R008 — /analytics/work-hours

- Task and scope: Let managers and workforce admins analyze organization work hours and variance for a selected period.
- Primary action: Review the range or export existing employee hours analytics.
- Composition: Place period/export controls first, actual-versus-expected and variance trends next, then the employee comparison and hours distribution.
- Preserve and verify: Retain total hours, overtime, undertime, weekly averages and status precision. Keep organization-zone presets and independent empty chart states; verify failed refresh preserves context and the export matches the existing dataset rather than a newly computed display total.
- Shared work: F1/F2; owners unchanged.

<a id="r009"></a>

### R009 — /approvals

- Task and scope: Let managers and workforce admins decide legacy absence and time-correction requests in their authorized organization scope.
- Primary action: Approve or reject an eligible request in its existing queue.
- Composition: Lead with pending work and the Absence Requests/Time Corrections tabs; keep the Unified Inbox destination visible as supporting navigation.
- Preserve and verify: Retain both queues, default-tab behavior, rejection reasons, row/bulk controls and request evidence. Verify current legacy/canonical authority, stale eligibility, partial failures and scoped actors; do not retire this route through the refresh.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r010"></a>

### R010 — /approvals/deputy-decisions/[absenceId]

- Task and scope: Show an authorized employee the decisions their deputy made during the selected absence.
- Primary action: View the decision history or return to the inbox.
- Composition: Lead with absence dates and the return action, then one aligned request/requester/outcome/deciding-person/time record surface.
- Preserve and verify: Retain both the deputy and approver context, approved/rejected meaning, preferred time formatting and the safe not-found boundary. Verify cancelled absences retain their historical summary, unknown labels remain honest, and an empty history says nobody decided during this absence.
- Shared work: F1/F2; owners unchanged.

<a id="r011"></a>

### R011 — /approvals/inbox

- Task and scope: Let authorized approvers decide organization requests under each item's current decision right, including explicit covering sections.
- Primary action: Open a request and decide it; retain eligible bulk actions, fast lanes and approval sprint.
- Composition: Lead with pending count, warnings and type/search controls; give requests the main surface and evidence/decision panels the supporting workspace.
- Preserve and verify: Keep URL type arrivals, search draft, loaded-item selection, covering exclusions, required reasons, pagination and mixed outcomes. Verify held/material-change/evidence-unavailable states and stale rights without fallback.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r012"></a>

### R012 — /approvals/review/[organizationId]/[kind]/[id]

- Task and scope: Bring a signed-in recipient to one approval after rechecking the target organization and current access.
- Primary action: Review its authorized detail, switch organization when offered, or open the inbox.
- Composition: Keep a compact arrival explanation and real next action; ready arrivals open the existing inbox detail panel with a reachable reopen control.
- Preserve and verify: Preserve callback/organization-switch flow and reauthorization after switching. Missing, forbidden, reassigned and removed targets share safe unavailable copy; infrastructure failure remains distinct. Verify decisions return to the inbox.
- Shared work: F1/F3; owners unchanged.

<a id="r013"></a>

### R013 — /billing/suspended

- Task and scope: Explain suspended access for the active organization's member and the available billing recovery path.
- Primary action: Open billing when the existing billing-management ability permits it; otherwise view contact-admin guidance.
- Composition: Use a bounded recovery surface with organization suspension, clear consequence and one role-appropriate next step.
- Preserve and verify: Keep the suspension escape route, authoritative billing gate and current actor distinction. Verify disabled billing, trial/subscription/payment states and billing-enabled actors; do not unify this page's ability check with the shell trial CTA through presentation work.
- Shared work: F1; owners unchanged.

<a id="r014"></a>

### R014 — /calendar

- Task and scope: Let an employee inspect authorized work, absences and holidays in the selected employee's calendar context.
- Primary action: Browse the period and open an eligible record or existing calendar action.
- Composition: Lead with selected person, period and view controls; give day/week/month/year records room, with balance, filters and legend supporting them.
- Preserve and verify: Retain manual range selection, edit/split/delete/on-behalf actions, closed ranges and adjustment history. Verify selected-employee timezone boundaries, endpoint offsets, live/break state, week-start preference and phone filters without changing authorization.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r015"></a>

### R015 — /calendar/[employeeId]

- Task and scope: Open the authorized target employee's calendar in the active organization, including date-linked arrivals.
- Primary action: Inspect the selected employee's records and use only their returned eligible actions.
- Composition: Make target identity and period unmistakable above the existing calendar; keep balance, legend and record-detail support synchronized with selection.
- Preserve and verify: Preserve selected-person and date initialization, shared calendar scope, deep links and denied/missing-employee behavior. Verify target-local query boundaries, manager-on-behalf timezone, cross-zone endpoints and action refusal after access or organization changes.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r016"></a>

### R016 — /compliance

- Task and scope: Give an organization admin a command center for organization compliance risks and coverage.
- Primary action: Open the existing workflow linked from an actionable finding.
- Composition: Lead with risk summary, then ordered compliance sections and recent critical events; place coverage and unavailable-source context after actionable records.
- Preserve and verify: Retain each section's status, counts, source boundaries and real destinations. Verify all-clear differs from unavailable or partial coverage, feature gates remain intact, and refresh does not imply findings were reevaluated under a new policy.
- Shared work: F1; owners unchanged.

<a id="r017"></a>

### R017 — /driving-licence

- Task and scope: Serve the active organization's driver, verifier and operational reader through their capability-granted role tabs.
- Primary action: Report an impediment, open an employee check, or view planning status as currently permitted.
- Composition: Preserve My licence/Checks/Planning separation; lead each with authorization or due work, with class restrictions, evidence/history, responsibility and reminders alongside.
- Preserve and verify: Keep feature-off/not-found behavior, self-check exclusion, retained ended records, searchable worklist and operational view without inspection content. Verify uncertain reminder delivery and explicit reinstatement after suspension.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r018"></a>

### R018 — /driving-licence/checks/[employee]

- Task and scope: Let a scoped driving-licence reader/verifier inspect the selected employee's authorization and original-check evidence.
- Primary action: Record the original check, supplement evidence or reinstate authorization only when existing capabilities allow.
- Composition: Lead with employee/former status and return navigation; place current authorization and check form before evidence and period-filtered history/export.
- Preserve and verify: Keep self-verification prohibited, inspected classes/declaration explicit and supplements separate from originals. Verify UTC history boundaries, retained ended records, missing intended-driver state and fresh permissions after load failure.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r019"></a>

### R019 — /equipment

- Task and scope: Let scoped equipment staff review organization assignments, outstanding returns and items ready to issue.
- Primary action: Issue equipment when setup and capabilities permit; otherwise follow existing setup guidance.
- Composition: Lead with scope and actionable return/readiness summaries; preserve Assignments/Items tabs and adjacent filters, with assignment detail reached from the main record.
- Preserve and verify: Keep URL filters, sorting, paging, setup prerequisites and scoped historical holdings. Verify partial quantities, overdue versus outstanding, damaged-item clearance, feature-off access and separate issue/return authority.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r020"></a>

### R020 — /equipment/assignments/[assignmentId]

- Task and scope: Let an authorized equipment reader/operator inspect one organization's assignment and settle its return obligations.
- Primary action: Record receipt when allowed; retain separate transfer, close-return and correction actions.
- Composition: Lead with item/holder/status, quantities and deadline; group handover history and original/amended evidence beneath the operational controls.
- Preserve and verify: Keep physical receipt, loss, waiver and recovery distinct; never count recovered quantities twice. Verify partial settlement, reasoned amendments, retention/holds, former holders, stale previews and damaged receipt requiring separate clearance before reissue.
- Shared work: F1/F3; owners unchanged.

<a id="r021"></a>

### R021 — /equipment/employees/[employeeId]

- Task and scope: Show authorized equipment staff an employee's holdings and outstanding returns within authorized organization scope.
- Primary action: Issue equipment for an eligible current employee or open an existing assignment for follow-up.
- Composition: Lead with employee identity/former status and outstanding/overdue totals, then filtered assignment records and reachable history/actions.
- Preserve and verify: Former employees retain return/history and existing-holdings paths while new issuance stays unavailable. Verify scoped access, assignment filters, deadlines, partial returns, missing setup and failures; do not let a return imply employment or credential restoration.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r022"></a>

### R022 — /forgot-password

- Task and scope: Request account recovery from the current authentication domain.
- Primary action: Send the password-reset link.
- Composition: Keep a concise branded email form, necessary CAPTCHA and return-to-sign-in link; replace the form with the existing neutral delivery outcome after success.
- Preserve and verify: Retain the non-enumerating success message, domain-resolved Turnstile policy, fresh token on the same request, widget reset after failure and localized reset destination. Preserve entered email and actionable validation during failed attempts.
- Shared work: F1 auth-shell/state presentation; F3 labeled fields, validation and pending feedback.

<a id="r023"></a>

### R023 — /init

- Task and scope: Establish a signed-in user's active organization before entering the requested workspace destination.
- Primary action: Select an available organization when selection is required.
- Composition: Use a purpose-built bounded organization picker and distinct checking/activating/redirecting feedback, with activation errors beside the retained choices.
- Preserve and verify: Keep valid last-organization restoration, requested organization, safe callback, no-organization flow and automatic activation. Verify SSO/MFA handoff, failed-SSO return without a loop, keyboard selection, duplicate prevention and long lists within store-shell safe areas.
- Shared work: F1; owners unchanged.

<a id="r024"></a>

### R024 — /join/[code]

- Task and scope: Validate an invitation code and request membership of its organization.
- Primary action: Join when eligible, with sign-in continuation for unauthenticated visitors.
- Composition: Lead with the code and resolved organization; keep validation, account context and the resulting membership status in one bounded flow.
- Preserve and verify: Retain code editing and normalization, validation loading/errors, sign-in callback, already-member handling and distinct pending versus approved outcomes. Navigation into onboarding must not imply approved access; preserve reactivation and rehire boundaries.
- Shared work: F1 branded flow/states; F3 field validation and action feedback.

<a id="r025"></a>

### R025 — /kiosk

- Task and scope: Let an enrolled organization/location device identify employees and capture their own clocking without account sign-in.
- Primary action: Pair the device when unpaired, then perform the credential-authorized clock action.
- Composition: Preserve a large-target shared-device flow: location/language, employee identification, credential, attribution/action and explicit outcome; keep queue/recovery status visible.
- Preserve and verify: Distinguish online badge proof, fob-plus-PIN and unconfirmed offline PIN commands. Verify revocation, throttling, idle reset and uncertain-outcome lookup before another action; retain capture-time timezone and device evidence.
- Shared work: F1/F3; owners unchanged.

<a id="r026"></a>

### R026 — /licenses

- Task and scope: Read the webapp's open-source dependency license report without signing in.
- Primary action: Search for a package or license; follow its repository or homepage when needed.
- Composition: Use a reading-width public heading, compact package/license totals and one searchable, sortable record surface. On phones keep package identity, license and external links accessible.
- Preserve and verify: Retain package/license sorting, unknown-license wording, empty-search state, safe external-link behavior, locale handling and shell information links. This remains a read-only report.
- Shared work: F1 public shell; F2 table/search presentation.

<a id="r027"></a>

### R027 — /mfa

- Task and scope: Let a signed-in user satisfy organization-specific security requirements while personal recovery and organization selection remain available.
- Primary action: Verify an authenticator for the selected organization.
- Composition: Lead with organization/deadline requirements and verification, followed by enrollment/replacement, recovery consequences, organization selection and sign-out.
- Preserve and verify: Keep password/social alternatives, passkeys and two-factor controls, sanitized callback and five-minute replacement verification. Enrollment is not session proof; verify grace/enforced states, last-factor revocation and the absence of an administrator/support bypass.
- Shared work: F1/F3; owners unchanged.

<a id="r028"></a>

### R028 — /my-documents

- Task and scope: Let an employee access their own organization-shared personnel documents and respond to document requests.
- Primary action: Upload a permitted document or submit documents for a request.
- Composition: Lead with outstanding requests and deadlines, then the shared document record with upload and download actions nearby.
- Preserve and verify: Retain category restrictions, document visibility, file validation, request submission/retry and existing empty states. Uploaded request documents enter the personnel file immediately; return/cancellation never removes them. Verify employee access without exposing HR-only material or implied officer powers.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r029"></a>

### R029 — /my-equipment

- Task and scope: Let an employee read equipment issued to them in the active organization and understand return obligations.
- Primary action: View an item's handover history and amendments, without equipment-operation authority.
- Composition: Lead with To return, then Yours to keep and Returned & closed groups; show item identity, quantity/status and deadline before expandable evidence.
- Preserve and verify: Keep every handover, correction and exception total accessible. Distinguish received, lost, waived and recovered outcomes; verify partial quantities, no-equipment and failed-read states without adding self-service receipt authority.
- Shared work: F1; owners unchanged.

<a id="r030"></a>

### R030 — /my-requests

- Task and scope: Let an employee follow their own absence, time-correction and legacy expense requests in the active organization.
- Primary action: Fix, view or cancel a request only where its existing action permits.
- Composition: Lead with pending/fix/decision counts and filters; order Needs attention, In review and recent decisions before the complete request record.
- Preserve and verify: Retain text/status/type filters, 30-day decision context, cancellation confirmation and destination links. Verify per-source partial failures, unavailable focused arrivals and period-readiness rechecks; do not imply this page includes unsupported request kinds.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r031"></a>

### R031 — /notifications

- Task and scope: Let the signed-in user review their notification timeline and visible unread workload.
- Primary action: Open a notification, mark selected visible items read, or delete them.
- Composition: Lead with unread count and search/read filters, then Today/Yesterday/Earlier records; keep selection actions and notification settings close to the inbox.
- Preserve and verify: Retain all/unread/read distinctions, visible-only selection, real destinations, refresh and per-item actions. Verify no-notifications versus no-match versus load failure, bulk outcome feedback and organization navigation without changing recipient language or channel preferences.
- Shared work: F1/F2; owners unchanged.

<a id="r032"></a>

### R032 — /onboarding/complete

- Task and scope: Finalize personal onboarding and review the resulting workspace context.
- Primary action: Continue through initialization into the workspace.
- Composition: Keep a bounded completion flow with progress, completion outcome and relevant next steps; show organization-specific guidance and the administrator's holiday-setup link only in their existing contexts.
- Preserve and verify: Retain one completion operation, summary loading/errors, conditional guidance and the initialization handoff. Distinguish confirmed completion from failed finalization or unavailable summary; completing onboarding does not establish organization membership or security proof.
- Shared work: F1 onboarding shell, hierarchy and states.

<a id="r033"></a>

### R033 — /onboarding/notifications

- Task and scope: Set the onboarding user's notification preferences and request supported push permission.
- Primary action: Save preferences and continue; preserve skipping as an explicit alternative.
- Composition: Use a full onboarding step with push availability/permission context separated from email and approval/status/team preferences. Keep action feedback beside the affected group.
- Preserve and verify: Retain browser support and denied-permission outcomes, push request behavior, channel-specific values, save/skip destinations and failure recovery. Choosing preferences or skipping must not appear to grant browser permission or organization access.
- Shared work: F1 wizard/states; F3 field and action presentation.

<a id="r034"></a>

### R034 — /onboarding/organization

- Task and scope: Create an organization or continue onboarding with existing membership or an expected invitation.
- Primary action: Create the organization when policy permits; otherwise continue using the existing skip path.
- Composition: Keep a full onboarding step with name, slug, organization timezone and tracking start date; place slug availability and creation-policy guidance near the affected fields.
- Preserve and verify: Retain membership detection/step skipping, creation-disabled guidance, asynchronous slug checks without stale responses, validation and recoverable input. Preserve organization-local tracking-start meaning and current joining rules.
- Shared work: F1 wizard/states; F3 form presentation.

<a id="r035"></a>

### R035 — /onboarding/profile

- Task and scope: Establish the onboarding user's personal profile and display preferences.
- Primary action: Save the profile and continue, retaining the existing skip path.
- Composition: Keep one full onboarding step with identity fields, optional birthday/gender, time-format/week-start preferences and product-improvement choice in meaningful sections. Keep calendar selection usable on phones.
- Preserve and verify: Retain field optionality, validation, saved preferences, skip/save routing and recoverable failure. Birthday remains a calendar date; a display week-start preference must not change compliance boundaries. Preserve the explicit product-improvement choice.
- Shared work: F1 wizard/states; F3 fields/focus.

<a id="r036"></a>

### R036 — /onboarding/vacation-policy

- Task and scope: Configure the organization vacation policy for an eligible onboarding administrator.
- Primary action: Save the policy and continue; retain skip.
- Composition: Keep the onboarding form, grouping policy name and annual allowance, accrual choice and conditional carryover settings. Place explanatory policy context beside the relevant controls.
- Preserve and verify: Retain access checking/loading and non-admin routing, accrual semantics, carryover toggle/limit, validation, save/skip destinations and recoverable failures. These are organization defaults, not an editable personal vacation balance; presentation must not change allowance calculations.
- Shared work: F1 wizard/states; F3 conditional form presentation.

<a id="r037"></a>

### R037 — /onboarding/welcome

- Task and scope: Start or resume the user's onboarding with organization context.
- Primary action: Start setup or continue to profile when membership already exists.
- Composition: Keep a concise welcome heading, progress and existing capability guidance, followed by organization-arrival context and one clear continuation action. Use restrained surfaces instead of competing decorative panels.
- Preserve and verify: Retain onboarding initialization, summary resolution, organization name, step persistence and organization-versus-profile routing. A welcome or joined message must not replace current membership/security checks when entering the workspace.
- Shared work: F1 onboarding shell and state hierarchy.

<a id="r038"></a>

### R038 — /onboarding/wellness

- Task and scope: Configure the onboarding user's water-reminder preferences.
- Primary action: Save preferences and continue, retaining skip.
- Composition: Keep a bounded full onboarding step with the enable switch first, then existing presets, reminder interval and daily goal when applicable. Keep numeric values readable beside their sliders and explain the chosen cadence.
- Preserve and verify: Retain preset/custom relationships, allowed interval/goal values, enabled-state behavior, save/skip progression and failure recovery without losing input. This remains a personal preference step rather than a workspace requirement.
- Shared work: F1 wizard/states; F3 field/slider and action presentation.

<a id="r039"></a>

### R039 — /onboarding/work-schedule

- Task and scope: Set the initial organization weekly work schedule for an eligible onboarding administrator.
- Primary action: Save weekly hours and work classification, then continue; retain skip.
- Composition: Keep a full onboarding step with hours and classification together, supporting explanation and a stable save/skip action area.
- Preserve and verify: Retain asynchronous administrator checks, non-admin skipping, failure fallback, validation and server-returned next steps. Preserve the effective-from boundary and existing work-policy meaning; display reorganization must not alter contractual hours or classify unavailable access as successful setup.
- Shared work: F1 wizard/states; F3 form presentation.

<a id="r040"></a>

### R040 — /onboarding/work-templates

- Task and scope: Create the organization work template for an eligible onboarding administrator.
- Primary action: Save the template and continue; retain skip.
- Composition: Use the full onboarding step with template name, weekly hours, working-day selection and default-template choice; retain derived schedule context beside inputs.
- Preserve and verify: Retain administrator checking/non-admin routing, weekday selection and validation, default selection, save/skip destinations and failed-submit input. Keep work-template configuration distinct from recorded time and from the user's display week preference; do not invent template management controls here.
- Shared work: F1 wizard/states; F3 form presentation.

<a id="r041"></a>

### R041 — /organization

- Task and scope: Let organization readers explore the current roster's teams, direct managers and reporting relationships.
- Primary action: Search or select a person to inspect their relationships; admins retain settings links.
- Composition: Lead with Teams/Reporting Lines view controls, team filtering and employee search; use the relationship canvas/outline or teams as main record and person panel as detail.
- Preserve and verify: Keep URL selection, lazy expansion/loading for large organizations, mobile outline, no-reporting-line groups and current-roster/privacy rules. Verify failed branch loads and deep-linked selections without adding management authority.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r042"></a>

### R042 — /payroll

- Task and scope: Let authorized payroll actors prepare exports for their selected organization period, target and employee/team scope.
- Primary action: Trigger the configured payroll export; retain the separate PDF download.
- Composition: Lead with period/target/scope and readiness summary, then actionable blockers and employee totals; organize run history, baselines and comparison as supporting records.
- Preserve and verify: Keep explicit Apply, closed-month independence, former-employee fallback, connector outcomes and retained evidence unavailable states. Verify comparison never delivers, expense exclusions and uncarried-payout warnings; export is not payment.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r043"></a>

### R043 — /payroll/work-balances

- Task and scope: Give an active payroll-grant holder a directory of covered employees, including former employees, for work-balance operations.
- Primary action: Open an employee's work balance or upload opening balances from CSV.
- Composition: Lead with scope explanation and upload action, followed by employee identity/former-status records and a clear return to payroll.
- Preserve and verify: Keep current-membership grant scope independent of personnel files and expense snapshots. Verify template download, whole-file validation, replacement preview and all-or-nothing upload; an erroneous row must not save other balances.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r044"></a>

### R044 — /payroll/work-balances/[employeeId]

- Task and scope: Let a payroll-grant holder covering this employee inspect their work balance and adjustment ledger, also after employment ends.
- Primary action: Set opening balance or record overtime payout through existing authorized controls.
- Composition: Lead with employee/former identity and balance-through-date, then adjustment history; place reasoned creation/cancellation panels beside that ledger context.
- Preserve and verify: Never turn the balance into an editable total. Verify opening replacement, payout limits, cancellation evidence, unavailable projection, stale results and not-found for uncovered or foreign employees.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r045"></a>

### R045 — /personnel-files

- Task and scope: Give category-scoped personnel-file officers a directory of employees whose documents they manage in the active organization.
- Primary action: Open an employee file or an existing expiry/document-request workflow.
- Composition: Lead with expiring documents needing attention, then employee records; group payslip batches, requests, sick leave, deletion and officer settings as capability-based destinations.
- Preserve and verify: Retain former-employee marking, category/employee scope and empty-scope guidance. Verify expiry links and counts reveal only permitted categories; managers/payroll access alone grant no file access, including an officer's own file.
- Shared work: F1/F2; owners unchanged.

<a id="r046"></a>

### R046 — /personnel-files/[employeeId]

- Task and scope: Let an officer manage only authorized categories of the selected employee's organization personnel file.
- Primary action: Upload a document, with edit/download/delete and linking actions available per capability.
- Composition: Lead with employee/former identity and category-filtered documents; place requests and sick-leave support only where their category access exists.
- Preserve and verify: Keep category deep links, shared versus HR-only visibility, file export and skill/sick-note links. Verify own-file exclusion, former access, failed reads, revision/permission changes and reasoned deletion; document presence never grants content access elsewhere.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r047"></a>

### R047 — /personnel-files/document-requests

- Task and scope: Let authorized officers track certificate/other-document requests across employees and categories they manage.
- Primary action: Create bulk document requests or act on an eligible existing request.
- Composition: Lead with scope/deadline explanation and creation action, then status/overdue filters and paged request records with employee context and officer decisions.
- Preserve and verify: Keep organization-calendar overdue meaning, open/submitted/accepted/returned/cancelled distinctions, required return reason and former-employee markings. Verify category scope, paging and partial outcomes; uploaded documents survive request return/cancellation, and acceptance alone renews the linked document.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r048"></a>

### R048 — /personnel-files/due-for-deletion

- Task and scope: Let authorized officers review former employees' retained documents and confirm irreversible purge within their category scope.
- Primary action: Select documents and confirm purge after reviewing its consequence.
- Composition: Lead with retention explanation, then due documents and selection actions; keep retention-start-unknown records in their separate review section.
- Preserve and verify: Retain document opening, explicit confirmation, retry and skipped/no-longer-due feedback. Verify fresh scope/retention checks, unknown employment-end handling and audit descriptions removed while actor/category/date/pay-period evidence remains; leaving a row keeps it.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r049"></a>

### R049 — /personnel-files/payslip-batches

- Task and scope: Let an authorized payslip officer start a batch for one pay period and inspect their existing batches.
- Primary action: Choose month, year and visibility, then Start batch.
- Composition: Lead with the compact batch-start form and its save/notification consequence, followed by batch history showing pay period, file count and confirmation state.
- Preserve and verify: Keep category scope, shared versus HR-only visibility and current organization-calendar defaults. Verify starting a batch saves no personnel documents, validation retains input, and history links reach the correct authorized batch.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r050"></a>

### R050 — /personnel-files/payslip-batches/[batchId]

- Task and scope: Let an authorized officer match and distribute one pay-period batch's payslip files to covered employees.
- Primary action: Confirm employee matches and Save payslips; retry only failed files when offered.
- Composition: Keep this multistep workspace full-page: batch/visibility summary, PDF-or-ZIP intake, per-file matching/inclusion record, then confirmation and results.
- Preserve and verify: Retain file/ZIP limits, browser unpacking, ambiguous/unmatched/duplicate states, manual matches and dropped files. Verify expired staging, scope loss, partial retry and one batch notification; unconfirmed matches never save documents.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r051"></a>

### R051 — /personnel-files/sick-leave

- Task and scope: Let sick-note-category officers review covered employees' sick-leave absences and linked sick notes for a chosen range.
- Primary action: Open or attach/link sick notes where current file permission permits.
- Composition: Lead with date/employee/team/detail/note/status filters; give the paged absence record its full comparison space, with note detail in the existing panel.
- Preserve and verify: Keep pending/approved meaning, former-employee visibility, certificate-presence distinctions and reset/paging behavior. Verify notes require document permission and this overview sends no reminders or requests; an absent note is not a failed read.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r052"></a>

### R052 — /platform-admin

- Task and scope: Survey platform-wide health and enter global administration workflows as an explicit platform administrator.
- Primary action: Open the relevant users, organizations, diagnostics, templates or billing workspace.
- Composition: Place platform scope in the heading, consolidate operational counts into a summary strip, retain the analytics preview and group destination links by task.
- Preserve and verify: Retain metric deep links and status filters, billing-enabled visibility, authoritative seat/revenue values, loading states, separate admin navigation and exit. Organization administration rights must not grant this shell.
- Shared work: F1 admin shell, summary and state presentation.

<a id="r053"></a>

### R053 — /platform-admin/analytics

- Task and scope: Inspect platform growth, engagement, operational activity and billing trends as a platform administrator.
- Primary action: Select the reporting range and aggregation bucket.
- Composition: Keep scope and range controls together above aligned metrics and readable trend sections; give charts room without nesting every value in another card.
- Preserve and verify: Retain URL-backed range/bucket selection, allowed bucket changes, existing metric definitions and billing-dependent information. Keep pending, absent and unavailable data distinct; verify long labels and chart readability on phones without page overflow.
- Shared work: F1 summaries/states; F2 filter-toolbar presentation.

<a id="r054"></a>

### R054 — /platform-admin/billing

- Task and scope: Review platform subscriptions and seat discrepancies in billing-enabled deployments as a platform administrator.
- Primary action: Synchronize seats for the selected organization when needed.
- Composition: Place revenue/subscription summaries above the existing subscription record surface. Keep organization identity, subscription status, licensed/used seats and row actions together; expose remaining dates and billing details accessibly on phones.
- Preserve and verify: Retain billing-disabled redirect, current result limit/order, demo-user distinction, authoritative revenue calculations and per-organization synchronization outcomes. Avoid implying subscription status is an editable entitlement here.
- Shared work: F1 summaries/states; F2 records.

<a id="r055"></a>

### R055 — /platform-admin/diagnostics

- Task and scope: Inspect deployment configuration and service health under platform-admin authorization.
- Primary action: Refresh diagnostics; run email or encryption tests deliberately from their own sections.
- Composition: Lead with overall status and refresh time, then configuration/health evidence, recommended actions and test forms. Keep temporary SMTP overrides beside the email test.
- Preserve and verify: Retain safe configuration redaction, status announcements, retained snapshots after refresh failure, test outcomes and pending protection. Overrides apply only to the test; secrets must not enter ordinary diagnostic output.
- Shared work: F1 status/refresh presentation; F3 test-form fields.

<a id="r056"></a>

### R056 — /platform-admin/organizations

- Task and scope: Find and manage platform organizations under global administrator authority.
- Primary action: Open the selected organization's appropriate suspension or deletion workflow.
- Composition: Lead with search/status filters and one paginated organization surface, preserving links into organization-filtered users. Keep destructive actions distinct from ordinary record navigation.
- Preserve and verify: Retain suspended/deleted states, suspension reasons, unsuspension, exact-name deletion confirmation, immediate/grace-period and notification choices, pending protection and error recovery. Show the named global target throughout consequential actions; retain every phone field/action.
- Shared work: F1 states; F2 list/toolbar; F3 consequential overlays.

<a id="r057"></a>

### R057 — /platform-admin/settings

- Task and scope: Configure global authentication-page consent behavior and perform privileged approval maintenance as a platform administrator.
- Primary action: Save consent-script changes; keep force deletion a separate consequential operation.
- Composition: Group the editable consent configuration, approval-maintenance target form and read-only Turnstile deployment guidance into sections. Make global reach and deletion scope explicit.
- Preserve and verify: Retain consent disable/save/loading behavior, organization-plus-approval targeting, UUID validation, ambiguity/not-found refusals and deletion results. Maintenance removes linked approval records while preserving source records/statuses; no org decision authority is implied.
- Shared work: F1 states; F3 validation/action presentation.

<a id="r058"></a>

### R058 — /platform-admin/system-email-templates

- Task and scope: Maintain platform-owned billing and system email overrides under global administrator authority.
- Primary action: Save the selected template's override.
- Composition: Keep template selection and default/customized status beside the editor; group subject, rich body/plain text, supported variables, test and reset controls around the active template.
- Preserve and verify: Retain independent template drafts, built-in fallback copy, first-override requirements, test delivery to the current admin, reset confirmation and pending/error feedback. Clearly communicate that saved/reset overrides affect global outgoing system mail.
- Shared work: F1 states; F3 editor/action and confirmation presentation.

<a id="r059"></a>

### R059 — /platform-admin/users

- Task and scope: Find platform accounts and manage bans or sessions with explicit platform-admin authority.
- Primary action: Inspect the selected account's sessions or apply the required ban/unban action.
- Composition: Use search/status and retained organization filtering above a paginated account surface; put session evidence in its panel and the ban form beside named account context.
- Preserve and verify: Retain URL filter arrivals, ban reason/expiry, single/all-session revocation, pending/error outcomes and current protections. Ban effects include existing session invalidation; organization roles never substitute for platform authority.
- Shared work: F1 states; F2 records/filters; F3 panels.

<a id="r060"></a>

### R060 — /platform-admin/worker-queue

- Task and scope: Diagnose background-job reliability and maintain supported schedules as a platform administrator.
- Primary action: Inspect failures or edit an eligible schedule.
- Composition: Lead with queue/reliability status, followed by trends, scheduled jobs, job metrics and filterable recent executions. Open schedule editing in a side panel retaining effective/default patterns and next-run context.
- Preserve and verify: Retain unknown/stale/failing distinctions, job filters, supported presets, read-only defaults, high-risk typed acknowledgment, reset behavior and saved-versus-worker mismatch warnings. Keep wide evidence locally scrollable when comparison requires it.
- Shared work: F1 states; F2 records/filters; F3 schedule editing.

<a id="r061"></a>

### R061 — /reports

- Task and scope: Let an employee generate work, absence and home-office reports for an employee within their authorized report scope.
- Primary action: Select employee/period and Generate Report, then download an existing supported format.
- Composition: Lead with employee/range controls and explicit generation, followed by period-labeled summaries and report preview; keep custom fields, closure context and export beside the result.
- Preserve and verify: Retain staged filters, authoritative totals, redaction and format-specific output. Verify no-report versus generating/error states, historic employees, captured time context and exported scope matching the preview.
- Shared work: F1/F2; owners unchanged.

<a id="r062"></a>

### R062 — /reports/projects

- Task and scope: Let authorized project-report readers inspect organization project/customer results for the selected period and project status.
- Primary action: Generate the report, then open project detail or use permitted export/share actions.
- Composition: Lead with period/status controls; preserve Portfolio Overview, Customers and Project Details with summary, health/budget context and contribution/task records.
- Preserve and verify: Keep explicit generation, drilldown/refresh context and billable visibility. Verify unpriced/unknown margin, missing-task rows, frozen share snapshots, secret-link reveal and trimmed shared content; sharing and downloads must use their existing report scope.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r063"></a>

### R063 — /reports/vehicles

- Task and scope: Let an authorized employee report organization-scoped driven distance by vehicle, employee and month for a selected range.
- Primary action: Generate report, then download supported report formats.
- Composition: Lead with period/generate controls, then total kilometres and the vehicle/employee monthly comparison, with scope and generation metadata beside exports.
- Preserve and verify: Keep whole kilometres from completed work grouped by recorded start-local month, own vehicles, archived vehicle identity and totals. Verify empty versus ungenerated/error states and exact export parity; this is not a tax logbook.
- Shared work: F1/F2; owners unchanged.

<a id="r064"></a>

### R064 — /reset-password

- Task and scope: Replace the account password using the supplied reset token.
- Primary action: Save the replacement password, then continue to sign-in.
- Composition: Keep the new-password and confirmation fields in a bounded authentication flow, with strength/visibility controls and validation close to their fields. Give invalid-link recovery and completion their own clear states.
- Preserve and verify: Retain missing/invalid/expired-token handling, request-new-link destination, password policy, confirmation matching, recoverable errors and duplicate-submit prevention. Successful replacement must retain existing account-security consequences.
- Shared work: F1 auth states; F3 password fields, validation and focus.

<a id="r065"></a>

### R065 — /scheduling

- Task and scope: Give planners organization shift planning and employees their own published schedule, using organization-local shift dates.
- Primary action: Planners create/assign/publish shifts; employees inspect shifts and use existing pickup/swap paths where offered.
- Composition: Preserve planner calendar/templates, coverage, compliance and request review; give employees a focused schedule with the existing phone weekly agenda.
- Preserve and verify: Keep employee/date deep links, draft/published/open distinctions, gestures and non-gesture access. Verify advisory staffing, blockers, reasoned skill overrides and publish acknowledgment bound to its evaluation; planning never writes recorded work.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r066"></a>

### R066 — /settings

- Task and scope: Find configuration available to the signed-in account and active organization through existing settings access.
- Primary action: Open an available settings destination.
- Composition: Lead with organization/account context and searchable task groups; retain the existing destination grid and nested navigation without invented setup actions.
- Preserve and verify: Preserve resolved member, scoped-manager, org-admin and owner access, project-manager exceptions, feature visibility, locale navigation and direct-page guards; test organization changes and empty eligibility.
- Shared work: F1 supplies shell, heading and state presentation; navigation visibility remains domain-owned.

<a id="r068"></a>

### R068 — /settings/approval-policies

- Task and scope: Configure active-organization approval policies as org admin; escalation uses its existing Approval-management capability.
- Primary action: Create/edit an approval policy; save triage or escalation settings in their own task.
- Composition: Keep policies, groups, triage, escalation and history in linkable tabs, with records first and ordinary edits in panels.
- Preserve and verify: Retain distinct capabilities and routing/history; attach R067 `/settings/approval-escalation` to `?tab=escalation`, preserving locale, capability guard and refusal redirect.
- Shared work: F1 presentation, F2 management records, F3 task panels; existing approval owners remain authoritative.

<a id="r069"></a>

### R069 — /settings/audit-export

- Task and scope: Inspect audit activity and configure audit packages for the active organization as org admin.
- Primary action: Generate an audit package; save configuration within its tab.
- Composition: Separate activity, configuration, packages and eligible signing keys; show filters, package status and download actions beside their records.
- Preserve and verify: Keep key availability, package lifecycle and authorized downloads. Attach R070 `/settings/audit-log` and R098 `/settings/enterprise/audit-log` to `?tab=activity`, retaining locale and admin guards.
- Shared work: F1 states, F2 logs/packages, F3 configuration and confirmations; audit actions remain domain-owned.

<a id="r071"></a>

### R071 — /settings/avv

- Task and scope: Review the active organization's AVV details as org admin when deployment billing is enabled.
- Primary action: Download the AVV PDF when the current profile is complete.
- Composition: Put legal identity/registered address beside processor/hosting details, with readiness guidance and the existing profile-edit link near download.
- Preserve and verify: Preserve country-aware validation, billing gate and authorized download. The document uses the current profile and must not imply historical signature or acceptance evidence.
- Shared work: F1 supplies restrained heading, surfaces and feedback; retain the existing download owner.

<a id="r072"></a>

### R072 — /settings/billable-time

- Task and scope: Maintain the active organization's Billable Time currency as org admin through existing module access.
- Primary action: Save the billable currency when it remains changeable.
- Composition: Lead with the currency task, current value and explicit save state; retain sibling navigation for rates, cost rates, accounting and hand-off.
- Preserve and verify: Preserve enabled/currency prerequisites, currency locking and refusal feedback. Distinguish customer-chargeable work from Z8 subscription billing; changing presentation cannot unlock established currency.
- Shared work: F1 settings shell/feedback; F3 accessible configuration fields and submission; module state remains domain-owned.

<a id="r073"></a>

### R073 — /settings/billable-time/accounting

- Task and scope: Connect accounting and prepare customer contact links in the active organization as eligible Billable Time org admin.
- Primary action: Save the accounting connection or edit customer accounting details.
- Composition: Show connection status/default tax treatment, then customer/contact/tax records with edit panels; retain Import customers into reviewed import.
- Preserve and verify: Keep provider availability, secret storage, one active connection and account-specific contact links. Customer imports require review; linking never creates remote contacts.
- Shared work: F1 feedback, F2 customer records and F3 configuration panels; existing accounting actions retain ownership.

<a id="r074"></a>

### R074 — /settings/billable-time/cost-rates

- Task and scope: Maintain effective-dated employee cost rates in the active organization as eligible Billable Time org admin.
- Primary action: Set a cost rate or open an employee's rate history.
- Composition: Lead with employee/current-cost records and currency, then a selected employee panel with dated history and the existing rate form.
- Preserve and verify: Preserve effective dates, inactive/history visibility and unknown-cost states. Cost rates remain distinct from wages and billable rates; existing reads compute applicability and margin.
- Shared work: F1 hierarchy, F2 employee records and F3 rate panels; rate history remains domain-owned.

<a id="r075"></a>

### R075 — /settings/billable-time/hand-off

- Task and scope: Prepare accounting invoice drafts for one customer/period within the active organization as eligible org admin.
- Primary action: Preview hand-off, then confirm creation of the invoice draft.
- Composition: Keep customer/period controls, readiness blockers and work preview together; show draft history, timesheets and changed-after-invoicing reconciliation below.
- Preserve and verify: Preserve held-back work, frozen rates, unknown differences, reasoned resolutions and release history. Z8 creates drafts only; corrections remain possible.
- Shared work: F1 status presentation, F2 work/history comparisons, F3 confirmation/reason tasks; hand-off actions retain their lifecycle.

<a id="r076"></a>

### R076 — /settings/billable-time/rates

- Task and scope: Maintain active-organization billable rates as eligible Billable Time org admin.
- Primary action: Add or edit an effective-dated billable rate.
- Composition: Lead with rate-level/target records, currency and applicable values; use panels for dated series and retain history beside editing context.
- Preserve and verify: Preserve employee-on-project, project, customer and employee precedence; dates, missing-rate states and currency/module gates remain authoritative. New rates cannot rewrite frozen invoice drafts or become employee wages.
- Shared work: F1 hierarchy, F2 rate records and F3 edit panels; pricing resolution stays with Billable Time.

<a id="r077"></a>

### R077 — /settings/billing

- Task and scope: Manage the active organization's Z8 subscription as org admin in billing-enabled deployments; owner-only actions retain their boundary.
- Primary action: Use the existing subscription/billing-portal action appropriate to current status.
- Composition: Lead with subscription/access status and recovery action, followed by seats, payment methods and invoices; keep billing failures explicit.
- Preserve and verify: Preserve trial, active, suspended and unavailable states, authorized recovery routes, seat definitions and kiosk-price availability; the billing evaluator decides entitlement.
- Shared work: F1 shell/status presentation and F3 existing consequential dialogs; Stripe actions and billing state retain ownership.

<a id="r078"></a>

### R078 — /settings/calendar

- Task and scope: Review calendar configuration as scoped manager or higher; org admins retain organization-wide editing.
- Primary action: Save calendar settings when authorized; managers inspect their supported read view.
- Composition: Use a named calendar configuration form with related visibility/sync fields, current values and clear save state; explain read-only sections beside their values.
- Preserve and verify: Keep manager read projection separate from admin configuration, existing sync behavior and server action authorization. Organization/employee timezone semantics and saved display preferences remain distinct.
- Shared work: F1 settings presentation and F3 field/validation behavior; current calendar reads/actions stay owned.

<a id="r080"></a>

### R080 — /settings/clocking

- Task and scope: Configure active-organization clocking as org admin.
- Primary action: Save tracking, automatic clock-out, reminder or period-submission configuration in its existing section.
- Composition: Group four named configuration tasks with current values, explanatory policy context and local save/pending feedback; keep consequential switches beside their effects.
- Preserve and verify: Preserve employee-local reminder/submission interpretation, cadence, grace periods and authorization. Reminders notify rather than change work; clock-out rules and policy calculations keep their existing owners.
- Shared work: F1 hierarchy/feedback; F3 accessible fields/submission without merging independently saved tasks.

<a id="r082"></a>

### R082 — /settings/closed-months

- Task and scope: Close/reopen covered employee months in the active organization with existing administrative authorization.
- Primary action: Close a selected month, or reopen it with the required reason.
- Composition: Lead with month/scope/state records and available actions; place automatic-close configuration and actor/reason history below. Preserve dedicated review panels for consequences.
- Preserve and verify: Keep fixed employee-local coverage, cross-boundary records, automatic-close exceptions and history. A close is independent of payroll export and period submission.
- Shared work: F1 statuses, F2 month/history records, F3 close/reopen tasks; domain freeze checks stay authoritative.

<a id="r083"></a>

### R083 — /settings/compliance

- Task and scope: Review pending working-time exception requests for managed employees as manager/workforce admin with an employee profile.
- Primary action: Approve an exception or reject it with a reason.
- Composition: Lead with pending requests, employee identity, planned duration and supporting reason; keep decisions beside the request and rejection in its focused reason dialog.
- Preserve and verify: Keep employee prerequisites, managed scope, eligibility and pending/retry feedback. This queue cannot become an editor for captured historical violations or the separate compliance command center.
- Shared work: F1 queue/states and F3 reason/focus behavior; exception actions remain authoritative.

<a id="r084"></a>

### R084 — /settings/compliance/works-council

- Task and scope: Configure privacy-safe works council access for the active organization as org admin.
- Primary action: Save works council settings.
- Composition: Lead with portal enablement and its current state, then related review/export settings and their effects; keep validation, pending and success feedback adjacent to save.
- Preserve and verify: Preserve portal feature gates, permitted viewers, privacy thresholds and export enablement as distinct settings. Configuration access does not confer portal data access or invent a new export workflow.
- Shared work: F1 settings hierarchy/feedback and F3 accessible configuration form; current permission/data owners stay intact.

<a id="r086"></a>

### R086 — /settings/custom-fields

- Task and scope: Define employee, project and customer custom fields for the active organization as org admin.
- Primary action: Add/edit a custom field; archive through its existing confirmation.
- Composition: Keep entity selection above field records, with type, requirement, visibility and edit level visible; edit definitions/options in task panels.
- Preserve and verify: Preserve base-role visibility/edit rules, tracked effective dates, required-value validation and option archival. Archived values survive; employees cannot edit their own values through this refresh.
- Shared work: F1 hierarchy, F2 field records and F3 definition panels; custom-field semantics remain domain-owned.

<a id="r087"></a>

### R087 — /settings/customers

- Task and scope: Manage customer contacts/configuration in the active organization through existing scoped-manager-or-higher access and Projects context.
- Primary action: Add or edit a customer.
- Composition: Lead with customer search/records and useful identity/contact fields, then a customer edit panel; retain billable/accounting context only where currently eligible.
- Preserve and verify: Preserve scoped reads, object-level mutation checks, active/archive behavior, custom-field requirements and account-link distinctions. Customer ownership remains Organization's; rate and tax behavior retains Billable Time authorization.
- Shared work: F1 presentation, F2 customer records and F3 edit/confirmation tasks; current read/action owners remain intact.

<a id="r088"></a>

### R088 — /settings/demo

- Task and scope: Generate/clear demonstration data in the active organization as org admin when its demo-data feature is enabled.
- Primary action: Run the existing demo-data generation wizard.
- Composition: Keep the long setup task as a wizard with scope/options, progress and outcome; separate the existing clear-data action and its consequence confirmation.
- Preserve and verify: Preserve feature gate, selected organization, generation options, destructive-clear safeguards and failure/retry states. Demonstration records must not be presented as go-live rehearsal evidence.
- Shared work: F1 feedback and F3 wizard/confirmation accessibility; existing generation/deletion actions retain ownership.

<a id="r090"></a>

### R090 — /settings/driving-licence

- Task and scope: Configure active-organization driving licence control as authorized org admin.
- Primary action: Save policy settings or manage intended-driver/verifier assignments.
- Composition: Retain linkable policy, intended-driver, verifier and retention tasks; show current enablement before records and use ordinary assignment panels.
- Preserve and verify: Preserve first-activation arrival, disabled retention-only presentation, explicit-off assignment precedence and verifier scope. Switching off stops visibility/reminders without deleting evidence/deadlines; authorization and check evidence retain separate lifecycles.
- Shared work: F1 state treatment, F2 assignment records and F3 policy/grant tasks; existing driving controls retain ownership.

<a id="r092"></a>

### R092 — /settings/employees

- Task and scope: Administer employee/member/invitation records in the active organization within existing scoped-manager-or-higher coverage.
- Primary action: Invite/manage an employee using the currently allowed action.
- Composition: Lead with existing record categories, filters and employee identity/status; retain invitation and employee edit panels and clear routes to full detail.
- Preserve and verify: Preserve current/former roster distinctions, invitation state, role/object checks and kiosk-only identities. Retain grant, approval, membership and lifecycle safeguards rather than deriving authority from visible rows.
- Shared work: F1 feedback, F2 directory/toolbars and F3 task panels; employee owners remain authoritative.

<a id="r093"></a>

### R093 — /settings/employees/[employeeId]

- Task and scope: Review/configure one organization-scoped employee within the actor's existing employee-management scope.
- Primary action: Save an authorized employee change or enter its existing lifecycle review.
- Composition: Lead with identity/current employment state and relevant tabs; group profile, team placement, employment terms, grants and history by task. Keep consequential lifecycle review separate from ordinary edit panels.
- Preserve and verify: Retain target checks, SCIM-owned personnel-number restrictions, wage/terms history, birthday privacy, release gates and follow-up/retry evidence.
- Shared work: F1 hierarchy, F2 histories and F3 edit/review tasks; section handoffs: R044 work-balance, R046 personnel-file, R021 employee-equipment.

<a id="r096"></a>

### R096 — /settings/enterprise/api-keys

- Task and scope: Manage organization-owned API keys as org admin; webhook mutations retain existing owner restrictions.
- Primary action: Create an API key or configure a webhook in its tab.
- Composition: Separate keys/webhooks, showing identity/status/scopes and delivery evidence; use edit panels and focused revocation confirmations.
- Preserve and verify: Preserve one-time secret reveal, org-acting scopes, health/restricted-field opt-ins and log access. Attach R148 `/settings/webhooks` to `?tab=webhooks`, retaining locale and admin arrival guard.
- Shared work: F1 presentation, F2 keys/deliveries and F3 credential/confirmation tasks; existing security/webhook actions retain ownership.

<a id="r097"></a>

### R097 — /settings/enterprise/api-keys/[keyId]

- Task and scope: Inspect/configure one API key belonging to the active organization as authorized org admin.
- Primary action: Save key configuration or revoke the key through its existing confirmation.
- Composition: Lead with key identity/status and scoped access, followed by editable configuration and request logs with existing filters/pagination.
- Preserve and verify: Preserve organization-plus-key lookup, expiry/revocation, one-time secret handling and request attribution. Creator departure does not revoke an organization-owned key; scope explanations retain health and restricted-field distinctions.
- Shared work: F1 feedback, F2 logs and F3 edit/confirmation patterns; key authorization remains domain-owned.

<a id="r100"></a>

### R100 — /settings/enterprise/domains

- Task and scope: Configure active-organization domains and branding as org admin.
- Primary action: Add/verify a custom domain or save branding in its existing task.
- Composition: Keep domain verification records and branding controls in separate linkable tabs with current state, assets and task panels.
- Preserve and verify: Retain domain/brand gates and identity-tab forwarding. Attach R095 `/settings/enterprise` to this route and R099 `/settings/enterprise/branding` to `?tab=branding`; preserve locale, admin enforcement and existing query behavior.
- Shared work: F1 shell, F2 domain records and F3 configuration tasks; domain policy remains server-resolved.

<a id="r101"></a>

### R101 — /settings/enterprise/email

- Task and scope: Configure email delivery and organization email overrides as active-organization org admin.
- Primary action: Save delivery configuration or an email override.
- Composition: Separate delivery fields/status from override selection/editor, keeping previews, variables, warnings and explicit save state near editing.
- Preserve and verify: Preserve secret-store availability, stored-secret behavior, test/reset actions and overrides sent as written in one language. Attach R091 `/settings/email-templates` to `?tab=templates`, retaining locale and admin guard.
- Shared work: F1 status presentation and F3 configuration/editor behavior; delivery and recipient-language owners remain intact.

<a id="r102"></a>

### R102 — /settings/enterprise/identity-setup

- Task and scope: Configure organization identity as active-organization org admin through existing provider/provisioning policy boundaries.
- Primary action: Complete identity setup or save the selected SSO, social-login or local-MFA task.
- Composition: Retain the setup wizard and linkable provider/policy tabs; show prerequisites, current configuration, connection state and recovery beside each task.
- Preserve and verify: Preserve session-proof/grace semantics, secrets, provisioning ownership and required-SSO recovery. Attach R103 `/settings/enterprise/sso` to `?tab=sso`, retaining locale and admin guard.
- Shared work: F1 feedback, F2 provider records, F3 wizard/panels; authentication authority remains unchanged.

<a id="r104"></a>

### R104 — /settings/equipment

- Task and scope: Configure active-organization equipment tracking and officer grants as org admin under existing feature availability.
- Primary action: Add/edit an equipment type/item, or update an officer grant.
- Composition: Lead with enablement, then types/identities, retention and scoped officers; retain the operational equipment link and refresh/retry access. Use panels for ordinary edits.
- Preserve and verify: Preserve individually identified versus quantity types, outstanding obligations, finite retention and holds. Switching off preserves records/returns/retention; management does not imply officer authority.
- Shared work: F1 states, F2 configuration records and F3 grant/edit tasks; equipment owners retain lifecycle rules.

<a id="r105"></a>

### R105 — /settings/export

- Task and scope: Request/inspect organization-wide data exports for the active organization as org admin.
- Primary action: Request an organization data export.
- Composition: Retain New Export, History and Storage tasks; show storage prerequisites/current configuration, scoped export options and record-local state, expiry and downloads.
- Preserve and verify: Preserve asynchronous lifecycle, authorization, file expiry and failure/retry behavior. This complete organization export differs from employee personal-data exports, payroll delivery, audit packages and frozen report sharing.
- Shared work: F1 hierarchy/feedback, F2 export history and F3 request configuration; existing export state and downloads retain ownership.

<a id="r106"></a>

### R106 — /settings/export-operations

- Task and scope: Inspect active-organization export health and delivery visibility as org admin.
- Primary action: Open the existing settings destination associated with an alert or run.
- Composition: Lead with actionable alerts and scoped totals; follow with upcoming runs and recent activity in comparable record surfaces, retaining timestamps and useful destination links.
- Preserve and verify: Preserve partial-data warnings and independent read failures. Health totals do not execute exports, confirm reimbursement or replace the source workflow's run/delivery state.
- Shared work: F1 attention/feedback presentation and F2 run/activity records; current health reads and linked workflows retain ownership.

<a id="r107"></a>

### R107 — /settings/export/history/[organizationId]

- Task and scope: Arrive at organization-addressed export history while retaining active-organization and org-admin authorization.
- Primary action: Switch to the addressed organization when the existing arrival card requires it, then use authorized export actions.
- Composition: Keep the switch prerequisite explicit; after validation, reuse export configuration/history opening History, with organization identity and record-local download states.
- Preserve and verify: Preserve membership, active-organization reconciliation, admin checks, refusal behavior and locale. Never display another tenant's history while switching.
- Shared work: F1 prerequisite states, F2 history and F3 requests; R105 owns shared export presentation and precedes arrival integration.

<a id="r109"></a>

### R109 — /settings/implementation-checklist

- Task and scope: Assess/rehearse go-live setup for the active organization as org admin.
- Primary action: Run an existing go-live rehearsal or open the setup task needing attention.
- Composition: Lead with readiness and unresolved checks, followed by go-live group/exclusions and employee-specific rehearsal detail; keep manual confirmations beside their evidence.
- Preserve and verify: Preserve fresh-read checks, configuration fingerprints, scoped candidates and first-workflow evidence. Rehearsal changes nothing, notifies nobody and delivers nothing; it cannot stage successful operational records.
- Shared work: F1 attention states, F2 check/group records and F3 existing review tasks; go-live owners remain authoritative.

<a id="r110"></a>

### R110 — /settings/import

- Task and scope: Select an import source and configure a reviewed import for the active organization as org admin.
- Primary action: Start the selected existing import setup.
- Composition: Lead with source choices and prerequisites, retaining source-specific upload/connection steps and existing batch continuation; long setup remains a wizard.
- Preserve and verify: Preserve source availability, credentials and batch identity. Attach R081 `/settings/clockodo-import` to this destination, retaining locale and destination admin enforcement; starting setup does not commit an import.
- Shared work: F1 states and F3 source-specific setup; current import owners retain parsing and writes.

<a id="r111"></a>

### R111 — /settings/import/[batchId]

- Task and scope: Review one active-organization import batch as org admin, using its existing source-specific workflow.
- Primary action: Resolve review issues and commit eligible rows when the batch permits it.
- Composition: Lead with source, batch state and blockers; retain CSV work, historical vacation or provider-specific review, row evidence, mappings and progress. Keep long review full-page.
- Preserve and verify: Preserve scanning, needs-review, committing, completed, failed and cancelled distinctions, query state and retry/cancel behavior. Blocking issues cannot become committable through presentation changes.
- Shared work: F1 progress/states, F2 review records and F3 controls; import authority remains intact.

<a id="r112"></a>

### R112 — /settings/kiosks

- Task and scope: Administer shared devices enrolled to active-organization locations as org admin.
- Primary action: Create a kiosk or issue its pairing code.
- Composition: Lead with device/location/status records and create action; use edit panels, dedicated pairing-code presentation and focused revoke confirmation.
- Preserve and verify: Preserve location prerequisites, single-use short-lived pairing, revocation and offline-mode eligibility. Distinguish kiosk credentials from employee PIN, badge and fob; enrollment does not grant account sign-in or bypass clock-command proof.
- Shared work: F1 state feedback, F2 device records and F3 edit/credential tasks; existing device actions retain ownership.

<a id="r113"></a>

### R113 — /settings/locations

- Task and scope: Review active-organization locations/subareas as scoped manager or higher; org admins retain management controls.
- Primary action: Add/edit a location when authorized, or open its detail.
- Composition: Lead with searchable location records and subarea context; retain row actions and task panels, with useful read-only information for managers.
- Preserve and verify: Preserve scoped readers, admin mutation checks and location/subarea relationships. Operating locations remain distinct from registered organization address and event-reported position stamps; unavailable and empty states remain separate.
- Shared work: F1 hierarchy, F2 location records and F3 management panels; existing location owners stay authoritative.

<a id="r114"></a>

### R114 — /settings/locations/[locationId]

- Task and scope: Review one active-organization location/subareas within existing manager scope; org admins retain editing.
- Primary action: Edit location details or add/edit a subarea when authorized.
- Composition: Lead with location identity/current configuration, then subarea records and relevant requirements; use ordinary panels while retaining the detail route and back navigation.
- Preserve and verify: Preserve organization-plus-ID resolution, manager read-only behavior, subarea/skill relationships, action refusals and not-found behavior. A location view cannot imply access to personnel evidence.
- Shared work: F1 detail hierarchy, F2 subarea records and F3 edit tasks; location actions retain ownership.

<a id="r115"></a>

### R115 — /settings/my-data

- Task and scope: Request the signed-in employee's personal data held by the active organization through existing member eligibility.
- Primary action: Request an employee personal data export.
- Composition: Lead with whose organization data is included and withheld-data guidance; follow the request with export history, state, expiry and permitted downloads.
- Preserve and verify: Preserve membership, employee prerequisites, withholding categories and asynchronous recovery. This is not the complete admin export or organization-wide export; former employees use the existing admin route.
- Shared work: F1 scope/status presentation and F2 export records; retain the current request/download owner without new controls.

<a id="r116"></a>

### R116 — /settings/notification-channels

- Task and scope: Configure organization notification channels as active-organization org admin.
- Primary action: Save/test the selected channel's existing configuration.
- Composition: Retain Slack, Teams, Telegram and Discord tabs, current connection values and local save feedback.
- Preserve and verify: Preserve credentials and channel-specific controls. Attach R089 `/settings/discord`, R135 `/settings/slack`, R139 `/settings/teams-notifications` and R141 `/settings/telegram` to matching `?tab=discord`, `?tab=slack`, `?tab=teams`, `?tab=telegram`; retain locale and admin guards.
- Shared work: F1 feedback and F3 channel forms; existing delivery/preferences and connection owners remain authoritative.

<a id="r117"></a>

### R117 — /settings/notifications

- Task and scope: Configure the signed-in user's personal notification preferences through existing account/organization boundaries.
- Primary action: Update an existing notification preference.
- Composition: Group preferences by notification/channel task with current values and actual save behavior; keep push/channel prerequisites and pending/failure feedback beside the affected control.
- Preserve and verify: Preserve enabled-channel availability, recipient-language behavior, per-user persistence and browser permission/device state. Personal preferences do not configure organization credentials or turn optional features on.
- Shared work: F1 hierarchy/feedback and F3 accessible preference controls; existing preference and delivery owners retain scope and defaults.

<a id="r118"></a>

### R118 — /settings/organization

- Task and scope: Administer active-organization identity/membership as org admin; owner-reserved changes retain their boundary.
- Primary action: Save authorized organization configuration or use an existing membership action.
- Composition: Separate display identity, legal profile and membership tasks with current values/save states; preserve creation/switching and consequential controls where currently available.
- Preserve and verify: Retain owner checks and legal/registered-address distinctions. Attach R094 `/settings/employees/new` and R119 `/settings/organizations` to this destination, preserving locale and destination admin enforcement.
- Shared work: F1 context, F2 membership records and F3 configuration tasks; organization/account ownership remains intact.

<a id="r120"></a>

### R120 — /settings/payroll-access

- Task and scope: Administer payroll-officer grants in the active organization as org admin with existing payroll-access administration authorization.
- Primary action: Add/update a payroll-access grant.
- Composition: Lead with grant coverage/eligibility, followed by officers and employee/team scope in a clear grant editor; show restricted prerequisites instead of an empty editable form.
- Preserve and verify: Preserve independent administration checks, current-membership scope, eligibility and revocation. Payroll access confers neither expense reimbursement nor personnel-file/payslip access; server refusals remain visible.
- Shared work: F1 restricted states, F2 grant records and F3 scoped grant tasks; payroll-access owners remain authoritative.

<a id="r121"></a>

### R121 — /settings/payroll-export

- Task and scope: Configure payroll targets and prepare exports for the active organization as org admin.
- Primary action: Generate/deliver the selected payroll export, or save its target configuration.
- Composition: Retain export, connector, mappings and history tasks; place period/employee scope, warnings and result records beside the action, with credential/configuration forms separate.
- Preserve and verify: Preserve withdrawn-connector restrictions, secret handling, mixed delivery outcomes and comparison evidence. Export moves no money, closes no month and confirms no reimbursement; previews remain read-only.
- Shared work: F1 feedback, F2 export/history records and F3 configuration; payroll domain actions stay authoritative.

<a id="r122"></a>

### R122 — /settings/payroll-readiness

- Task and scope: Inspect payroll setup/readiness for the active organization and selected period as org admin.
- Primary action: Open the existing remediation destination for a failed check.
- Composition: Lead with period scope, actionable blockers and readiness totals; follow with employee/check detail and useful links, keeping unknown/partial results distinct from passed checks.
- Preserve and verify: Preserve query-period behavior, authoritative checks and supported targets. Readiness must not execute payroll, repair work, freeze a month or imply successful vendor delivery.
- Shared work: F1 attention/state hierarchy and F2 check records; existing readiness reads and remediation owners remain intact.

<a id="r123"></a>

### R123 — /settings/permissions

- Task and scope: Review employee permissions in the active organization as scoped manager or higher; management actions retain existing administrative boundaries.
- Primary action: Inspect/change an employee's permitted role/scope using the existing authorized action.
- Composition: Lead with employee identity, role and effective permissions; retain search/filters and management panels, with read-only differences evident alongside values.
- Preserve and verify: Preserve base/custom-role interpretation, manager object checks, owner-reserved membership changes and direct mutation authorization. A visible capability summary does not grant action authority.
- Shared work: F1 context/feedback, F2 permission records and F3 management tasks; access resolution remains domain-owned.

<a id="r124"></a>

### R124 — /settings/personnel-files

- Task and scope: Configure active-organization personnel files as org admin while the feature is available.
- Primary action: Manage personnel-file officer grants or save reminders/retention in their task.
- Composition: Retain access, reminder and retention tabs; show employee/team/category coverage, current lead times and per-category periods with local save feedback.
- Preserve and verify: Preserve category-scoped grants, own-file exclusion, finite retention and former-employee rules. Neither management nor payroll grants imply document access; changing a reminder does not renew a document.
- Shared work: F1 states, F2 grant records and F3 configuration tasks; personnel-file permissions/retention stay domain-owned.

<a id="r125"></a>

### R125 — /settings/position-capture

- Task and scope: Configure active-organization position capture as org admin.
- Primary action: Save capture settings or its existing assignments/notice task.
- Composition: Separate enablement/purpose/retention, assignments and versioned notice management; show current settings, coverage and save states before supporting records, with ordinary editors in panels.
- Preserve and verify: Preserve purpose prerequisites, explicit assignments, consent and notice versions. Enablement alone applies to nobody; switching off preserves recorded stamps until deletion. No background capture, geofencing or clock-command blocking is introduced.
- Shared work: F1 feedback, F2 assignment/notice records and F3 configuration; consent/evidence owners remain authoritative.

<a id="r126"></a>

### R126 — /settings/position-stamps

- Task and scope: Review one's own clock-event position stamps and consent within the active organization.
- Primary action: Agree to the current position notice or withdraw consent using existing actions.
- Composition: Lead with personal capture/consent state and notice, then immutable stamps and access-log records; keep withdrawal consequences in its confirmation dialog.
- Preserve and verify: Preserve current-user scope, notice versions, consent-dependent deletion and immutable evidence. Device permission and organization assignment remain distinct from consent; clocking remains possible without a stamp.
- Shared work: F1 statuses, F2 evidence records and F3 consent confirmation; current consent owner remains authoritative.

<a id="r127"></a>

### R127 — /settings/profile

- Task and scope: Edit the signed-in account's profile/display preferences; organization-specific custom fields/skills retain their own read boundary.
- Primary action: Save profile changes or update an existing display preference.
- Composition: Lead with profile identity/form, then timezone, week start and time format; retain eligible own custom fields/skills as supporting records with current values.
- Preserve and verify: Preserve account-versus-organization persistence, picture/name behavior and read-only employee custom fields. Display preferences do not change compliance weeks, historical offsets or submission cadence.
- Shared work: F1 hierarchy/feedback and F3 accessible forms; account/preference and organization reads remain owners.

<a id="r128"></a>

### R128 — /settings/projects

- Task and scope: Manage organization projects within existing scope; project managers below manager settings access retain the tasks-only view.
- Primary action: Create/edit a project, or manage tasks where that is the actor's available task.
- Composition: Keep portfolio records, tasks and eligible templates distinct; use panels and preserve navigation, statuses and manager controls.
- Preserve and verify: Preserve booking assignments, flat projects, open/done tasks, template copying, custom-field requirements and feature gates. Templates are not bookable; project-manager access does not become general settings access.
- Shared work: F1 hierarchy, F2 portfolios/tasks and F3 edit panels; project owners remain authoritative.

<a id="r129"></a>

### R129 — /settings/report-share-links

- Task and scope: Manage frozen report share links belonging to the active organization as org admin.
- Primary action: Revoke an existing report share link using its current action.
- Composition: Lead with report/link identity, creator, expiry/status and useful actions; keep report context and link details available through accessible phone records.
- Preserve and verify: Preserve snapshot freezing, trimmed content, creator-access revocation and secret-link handling. These links grant snapshot viewing without sign-in and differ from scheduled-export downloads requiring a mailbox code.
- Shared work: F1 states and F2 link records/actions; retain existing share-link lifecycle and authorization owners.

<a id="r130"></a>

### R130 — /settings/roles

- Task and scope: Manage custom organization roles in the active organization as org admin.
- Primary action: Create/edit a custom role.
- Composition: Lead with role/base-role records and usage, followed by a task panel for name, base role and existing permission controls; retain deletion consequences and supported scope detail.
- Preserve and verify: Preserve protected roles, base-role semantics, authorization and required confirmations. Custom roles cannot bypass custom-field visibility/edit levels or replace distinct officer/verifier grants; settings access is not inferred solely from labels.
- Shared work: F1 hierarchy, F2 roles and F3 edit/confirmation tasks; access owners retain authority.

<a id="r131"></a>

### R131 — /settings/scheduled-exports

- Task and scope: Schedule payroll, data or audit exports for the active organization as org admin.
- Primary action: Create/edit a scheduled export through its existing multistep setup.
- Composition: Lead with schedules, enabled/paused state and next run; retain wizard type, filters, cadence, recipients and review, plus run history and approved recipients.
- Preserve and verify: Preserve schedule-owner pause, recipient approval, connector availability and per-run outcomes. External downloads require a one-time mailbox code; execution does not imply reimbursement.
- Shared work: F1 status, F2 schedules/runs and F3 wizard; scheduled-export owners retain operational semantics.

<a id="r132"></a>

### R132 — /settings/security

- Task and scope: Manage signed-in account security; organization-specific kiosk credentials and MFA requirements retain existing scope.
- Primary action: Change password, enroll a factor/passkey or revoke a session using the selected existing task.
- Composition: Group password, MFA/passkeys, kiosk PIN/fob, social accounts and sessions; keep warnings/current state beside controls, using panels or short confirmations appropriately.
- Preserve and verify: Preserve verification challenges, secret/recovery reveals, last-factor consequences and session proof. Fobs select identity but still require PIN; kiosk credentials do not grant account sign-in.
- Shared work: F1 feedback, F2 sessions and F3 security tasks; authentication owners remain authoritative.

<a id="r133"></a>

### R133 — /settings/shifts

- Task and scope: Configure shift templates/coverage within existing scheduling-settings team/subarea capabilities.
- Primary action: Create/edit a shift template or coverage rule when authorized.
- Composition: Retain templates/coverage tabs with scoped records and edit panels; make read-only values useful and keep time/required-skill context beside fields.
- Preserve and verify: Preserve separate read/manage capabilities and organization-local planning. Attach R085 `/settings/coverage-rules` to `?tab=coverage`, retaining locale and scheduling scope; planned shifts are not recorded work.
- Shared work: F1 states, F2 settings records and F3 task panels; scheduling permission/calculation owners remain intact.

<a id="r134"></a>

### R134 — /settings/skills

- Task and scope: Review the active organization's skill catalog as scoped manager or higher; org admins retain catalog/reminder management.
- Primary action: Add/edit a catalog skill when authorized or inspect qualifications.
- Composition: Lead with searchable skill records/current requirements, with reminders grouped separately; use ordinary catalog edit panels and retain read-only detail for managers.
- Preserve and verify: Preserve catalog rights, employee-skill scope, organization-calendar expiry and certificate-driven read-only dates. Knowing a certificate exists never grants access to personnel-file contents.
- Shared work: F1 hierarchy, F2 skill records and F3 editors; scheduling/personnel-file owners retain boundaries.

<a id="r136"></a>

### R136 — /settings/statistics

- Task and scope: Inspect organization statistics or existing managed-scope statistics as scoped manager or higher.
- Primary action: Read available statistics; retain shared refresh without adding a settings save.
- Composition: Lead with explicit organization/managed scope, then aligned workforce, work/absence and other available metric groups; keep units, periods and comparison context beside values.
- Preserve and verify: Preserve scoped reads, optional metric eligibility, authoritative totals, loading and read errors. Unknown/failed values remain distinct from zero; reorganization cannot broaden employee visibility.
- Shared work: F1 summary hierarchy and feedback; statistics reads retain calculations and scope.

<a id="r137"></a>

### R137 — /settings/surcharges

- Task and scope: Review surcharge models/assignments for the active organization as scoped manager or higher; org admins retain management.
- Primary action: Create/edit a surcharge model or permitted assignment.
- Composition: Lead with model records/current rates/rules, then organization/team/employee assignment sections and effective context; use ordinary task panels and retain read-only assigned records.
- Preserve and verify: Preserve assignment precedence, effective periods, manager scope and captured surcharge evidence. Restyling current configuration cannot recompute historical work or change payroll calculation sources.
- Shared work: F1 hierarchy, F2 models/assignments and F3 editors; surcharge owners remain authoritative.

<a id="r138"></a>

### R138 — /settings/teams

- Task and scope: Review/administer active-organization teams within existing scoped-manager-or-higher team-management coverage.
- Primary action: Create a team when authorized or open/manage an existing team.
- Composition: Lead with searchable team identity, lead and membership counts; retain scoped actions, detail links and create/edit panels, keeping empty/restricted states distinct.
- Preserve and verify: Preserve management coverage, current-roster selection, team-lead rules and multi-team membership/primary-team invariants. Team presentation cannot create officer/verifier authority.
- Shared work: F1 states, F2 directory and F3 team forms; touched native forms follow TanStack conventions; current team actions retain ownership.

<a id="r140"></a>

### R140 — /settings/teams/[teamId]

- Task and scope: Review one active-organization team's members/configuration as authorized team reader/operator.
- Primary action: Save an authorized team change or manage members using existing actions.
- Composition: Lead with team identity/lead, then membership and configuration tasks; keep primary-team context, scoped member selection and supporting records near controls.
- Preserve and verify: Preserve team-specific read/manage checks, cross-tenant refusal, current-roster candidates and primary-team membership invariants. Distinguish team lead from reporting lines and preserve effective assignment behavior.
- Shared work: F1 detail hierarchy, F2 members and F3 edit/member panels; current team owners remain authoritative.

<a id="r142"></a>

### R142 — /settings/travel-expenses

- Task and scope: Configure expense policy/officer coverage for the active organization as org admin.
- Primary action: Save the selected existing expense-policy, currency, reimbursement or officer task.
- Composition: Retain task tabs for review/receipts, currency/conversions, mileage/per-diem policies and finance coverage; show current values/effective dates and local save feedback, with grant/policy editors in panels.
- Preserve and verify: Preserve separate approval/export/reimbursement powers, approval-time team snapshots, coverage gaps, currency locking and historical rates. Export moves no money; payroll inclusion is not reimbursement.
- Shared work: F1 hierarchy, F2 policy/grant records and F3 forms; expense owners retain calculation/action authority.

<a id="r143"></a>

### R143 — /settings/vacation

- Task and scope: Review absence categories, vacation policies/assignments and holidays in the active organization within existing manager access; org admins manage policies.
- Primary action: Create/edit an authorized category, policy or assignment.
- Composition: Retain task tabs, policy/holiday records, assignment levels and calculation-review notices; ordinary edits use panels.
- Preserve and verify: Preserve scoped assignments, dated policy gaps/conflicts, posting gates, committed carryover/accrual and sick-note permissions. Attach R108 `/settings/holidays` to `?tab=holidays`, retaining locale and manager guard.
- Shared work: F1 feedback, F2 policies/holidays and F3 editors; Absences retains authoritative calculations.

<a id="r144"></a>

### R144 — /settings/vacation/employees

- Task and scope: Review active-organization employee vacation allowances as org admin.
- Primary action: Open an employee's allowance editor for the selected year.
- Composition: Lead with year/scope controls and employee allowance/balance records, then policy assignment and proration/working-week notices explaining review needs; preserve complete employee detail access.
- Preserve and verify: Preserve organization-calendar year, current/former visibility, applicable policy periods and unknown/conflicting results. Custom allowance, carryover, adjustments and taken/pending days remain distinct; totals come from the shared balance owner.
- Shared work: F1 hierarchy/state presentation and F2 allowance records; retain existing year/selection persistence.

<a id="r145"></a>

### R145 — /settings/vacation/employees/[employeeId]

- Task and scope: Edit one organization-scoped employee's annual vacation allowance under existing allowance-administration authorization.
- Primary action: Save allowance changes or record an authorized vacation adjustment.
- Composition: Keep the full-page employee/year editor, calculation context, custom allowance fields and adjustment/carryover/accrual history together; preserve back navigation and local validation.
- Preserve and verify: Preserve employee scope, final unprorated custom allowance, reason/history requirements, committed postings and reviewed corrections. Accrual history remains visible after policy changes; unavailable allowance never becomes zero.
- Shared work: F1 detail presentation, F2 histories and F3 accessible form; Absences remains calculation owner.

<a id="r147"></a>

### R147 — /settings/vehicles

- Task and scope: Configure active-organization vehicles and vehicle-use assignments as org admin.
- Primary action: Add/edit a vehicle or save vehicle-use configuration.
- Composition: Separate vehicle records from use enablement/driver assignments; show identity, plate and active/archive state with ordinary edit panels.
- Preserve and verify: Preserve archived vehicles on historical work and assignment precedence; assigned drivers provide defaults rather than exclusive selection. Attach R146 `/settings/vehicle-use` to `?tab=use`, retaining locale and admin guard. Driving authorization remains separate.
- Shared work: F1 states, F2 vehicles/assignments and F3 editors; organization/work-attribution owners remain intact.

<a id="r149"></a>

### R149 — /settings/wellness

- Task and scope: Configure the signed-in user's water reminders/hydration preferences through existing personal-settings persistence.
- Primary action: Save wellness settings.
- Composition: Lead with current reminder enablement and goal/schedule fields, grouped by the hydration task; keep units, prerequisites and explicit save/pending feedback close to the form.
- Preserve and verify: Preserve defaults, notification availability, timing interpretation and user scope. Personal preferences cannot change organization clocking rules or introduce new health tracking; retain values when saving fails.
- Shared work: F1 settings hierarchy/feedback and F3 accessible configuration fields; existing wellness owner remains authoritative.

<a id="r150"></a>

### R150 — /settings/work-categories

- Task and scope: Review work categories/sets in the active organization as scoped manager or higher; org admins retain management.
- Primary action: Create/edit a category, category set or authorized assignment.
- Composition: Lead with category records/counting meaning, followed by sets and organization/team/employee assignment sections; retain ordinary edit panels and read-only assignment detail.
- Preserve and verify: Preserve assignment precedence/effective periods, eligibility, archive behavior and historical attribution. Work categories describe how time counts; they remain distinct from project tasks.
- Shared work: F1 hierarchy, F2 categories/sets and F3 editors; existing category owners retain rules.

<a id="r151"></a>

### R151 — /settings/work-diagnostics

- Task and scope: Inspect missing/conflicting active-organization work records as org admin, within selected employee/period.
- Primary action: Review/apply an eligible existing repair or work proposal.
- Composition: Lead with query-backed scope and findings; retain repair-plan evidence, proposed changes, blockers and proposal history beside review controls. Keep consequential review explicit.
- Preserve and verify: Preserve organization/employee validation, month/range parameters, admission gates, record agreement and closed-month refusals. Read diagnostics never silently repair records; proposals are not committed work.
- Shared work: F1 states, F2 findings/history and F3 review tasks; time-workflow owners retain authority.

<a id="r152"></a>

### R152 — /settings/work-policies

- Task and scope: Review work schedules, limits, breaks and change policies in the active organization within existing manager scope; org admins retain policy management.
- Primary action: Create/edit an authorized work or change policy/assignment.
- Composition: Keep work/change tasks distinct, with policy records, effective assignment levels and ordinary editor panels.
- Preserve and verify: Preserve captured compliance evidence, employee-local change windows, inheritance and read-only assignments. Attach R079 `/settings/change-policies` to `?tab=changes`, retaining locale and manager guard; changes cannot rewrite historical violations.
- Shared work: F1 hierarchy, F2 policies/assignments and F3 editors; current domain owners remain authoritative.

<a id="r153"></a>

### R153 — /setup

- Task and scope: Bootstrap the first platform administrator using temporary operator authorization.
- Primary action: Create the administrator, then continue to sign-in.
- Composition: Retain a purpose-built setup flow with name, email, password/confirmation, creation progress and completion. Authorization-required guidance takes precedence when the temporary cookie is absent or expired.
- Preserve and verify: Retain one-use code exchange, credential-free address, one-hour/ten-minute expiry guidance, retry while authorized, configured-instance redirect and fail-closed infrastructure behavior. Keep no-referrer/no-index metadata and prevent duplicate creation; this boundary remains separate from public signup.
- Shared work: F1 setup states; F3 validation/focus.

<a id="r154"></a>

### R154 — /share/[token]

- Task and scope: Read a frozen, redacted project-report snapshot through its secret share URL.
- Primary action: Read or download that same snapshot as PDF, CSV or Excel.
- Composition: Lead with organization/report identity, sharer, snapshot time and link expiry; follow with report facts, comparison tables, notes and the read-only explanation. Allow local table scrolling on phones.
- Preserve and verify: Retain snapshot/download agreement, cost/margin exclusion, organization timezone, access logging, expiry/revocation and creator-access-loss checks. Keep generic unavailable outcomes and no-referrer/no-index behavior; never expose live source data.
- Shared work: F1 public states; F2 report tables.

<a id="r155"></a>

### R155 — /sign-in

- Task and scope: Authenticate on the current domain and continue to the intended destination.
- Primary action: Use an allowed sign-in method; store-shell visitors continue through the system-browser handoff.
- Composition: Lead with organization branding and the applicable sign-in form; group enabled SSO, password, social and passkey choices without obscuring recovery or signup.
- Preserve and verify: Retain domain policy, callbacks, Turnstile retry tokens, second-factor challenges, required-SSO session proof, browser/native return behavior and all error recovery. Keep shell preferences and information links reachable.
- Shared work: F1 auth shell/states; F3 fields and focus.

<a id="r156"></a>

### R156 — /sign-up

- Task and scope: Create an account under the deployment and domain signup policy, including invitation arrivals.
- Primary action: Create the account using the existing form.
- Composition: Keep a purpose-built branded signup flow with personal/account fields, password guidance and the invited organization/email context where supplied; place sign-in nearby.
- Preserve and verify: Retain signup restrictions, invitation/code and callback continuity, password validation, enabled authentication options, same-request Turnstile verification and fresh-token retries. Preserve verification-required outcomes and recoverable input; account creation must not imply approved organization access.
- Shared work: F1 shell/states; F3 form validation and focus.

<a id="r157"></a>

### R157 — /team

- Task and scope: Let managers and workforce admins inspect the employees their management scope covers in the active organization.
- Primary action: Open an employee's existing destination or inspect balance-adjustment history.
- Composition: Lead with scoped member count, search, former-employee switch and card/table controls; make identity, team, role, current activity and balance the main record.
- Preserve and verify: Retain sorting, paging, view choice, primary-manager/You indicators and settings entry when offered. Verify current/former distinction, unknown balance, empty scope versus no-match and authorized employee destinations; do not infer officer access.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r158"></a>

### R158 — /team/absences

- Task and scope: Let managers and workforce admins review managed employees' annual absence allowances and absence calendar.
- Primary action: Record an approved absence for an eligible employee through the existing flow.
- Composition: Lead with selected year/team/search scope, then calendar and comparable allowance/used/pending/left/sick records with employee actions nearby.
- Preserve and verify: Keep sorting/paging, deputy-filter deep links, show-all recovery, policy-configuration explanations and recorded-absence permissions. Verify half days, overdrawn vacation, allowance evidence and sick-note access separately; calendar failure must not erase usable employee records.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r159"></a>

### R159 — /team/driving

- Task and scope: Let organization owners/admins or scoped managers find recorded work missing expected driving details.
- Primary action: Open that employee's calendar to complete the existing work-period attribution.
- Composition: Lead with team/employee filters and missing-period count, then employee, recorded-local date/time and specific missing evidence, with calendar action on each record.
- Preserve and verify: Retain newest-result limit disclosure, filter access to remaining records and former-employee marking. Verify captured start-local display, no-vehicle versus missing-reading distinctions and scoped links; missing details never block clocking or confer driving authorization.
- Shared work: F1/F2; owners unchanged.

<a id="r160"></a>

### R160 — /team/period-submissions

- Task and scope: Let organization owners/admins or scoped managers inspect expected employee submissions for a selected organization cadence period.
- Primary action: Open an employee calendar or the approval inbox; decisions stay in the inbox.
- Composition: Lead with submission-period choice and running-period context, then status counts and employee/period/status records with calendar links.
- Preserve and verify: Keep cadence-disabled guidance, employee-local frozen ranges and awaiting/submitted/approved/rejected/sent-back distinctions. Verify employment clipping and no-expected-employees state; submissions confirm records without freezing them, and changed records require resubmission.
- Shared work: F1/F2; owners unchanged.

<a id="r161"></a>

### R161 — /team/presence

- Task and scope: Let an authorized organization presence reader choose among active locations to inspect current clocked-in or break presence.
- Primary action: Open a location's existing presence view.
- Composition: Lead with the location-selection task and simple location identity/count records; keep the no-active-locations state explicit.
- Preserve and verify: Retain authorized location scope and navigation, distinguish working from break presence in counts where shown, and verify refreshed results after organization changes. An empty location count is not an all-clear compliance assessment or proof that nobody is employed there.
- Shared work: F1; owners unchanged.

<a id="r162"></a>

### R162 — /team/presence/[locationId]

- Task and scope: Show an authorized reader employees assigned to this organization location who are currently clocked in or on break.
- Primary action: View presence and follow existing employee links; return to All locations when needed.
- Composition: Lead with selected location and reader-scope explanation, then name/state/since records with working and break labels.
- Preserve and verify: Keep manager-limited visibility, authorized location/not-found boundary and current-roster rules. Verify live/break synchronization, time-format context, refreshed absence of ended work and truthful empty scope; assignment to a location is not device-position evidence.
- Shared work: F1/F2; owners unchanged.

<a id="r163"></a>

### R163 — /time-tracking

- Task and scope: Let an employee clock and review their own organization work in the selected employee-local day/week.
- Primary action: Use the current clock action or existing manual-entry/correction flow.
- Composition: Preserve the approved clock/workplace band, summary strip, week/day context, day-grouped records and calendar/policy support; this is reference conformance.
- Preserve and verify: Close applicable mismatch/DST/cross-zone, offline replay, failure, permission and organization-switch verification gaps. Retain endpoint offsets, break state, task/project/billable/vehicle attribution, recovery identity, pagination and calendar access; never reset drafts on refresh.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r164"></a>

### R164 — /today

- Task and scope: Give managers and workforce admins today's briefing for the employees and organization they may oversee.
- Primary action: Follow an urgent item's workflow link or use its approval action where authorized.
- Composition: Lead with briefing date/update time and Needs Action, then aligned summary and supporting operational sections; keep approval work close to its evidence.
- Preserve and verify: Keep severity order, real destinations, section-level failures and supporting results. Verify all-clear does not assert presence, counts match scope, approval rights recheck and stale refresh remains understandable.
- Shared work: F1/F3; owners unchanged.

<a id="r165"></a>

### R165 — /travel-expenses

- Task and scope: Let an employee collect personal trip/standalone expenses and follow their review and reimbursement in their organization.
- Primary action: Create a receipt expense, mileage expense or trip report through existing controls.
- Composition: Lead with these distinct creation actions and personal expense history; keep approval and finance destinations separate and capability-based.
- Preserve and verify: Retain legacy and current report links, history filtering/status and no-report/error states. Verify optional finance/approval access does not imply the other, drafts survive failure, and exported or payroll-included does not appear reimbursed.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r166"></a>

### R166 — /travel-expenses/[claimId]

- Task and scope: Let an authorized employee or legacy-claim reader inspect one claim's retained organization evidence.
- Primary action: View/download receipts; use legacy-draft conversion or settlement only when currently offered.
- Composition: Lead with claim identity/status, amount and travel context, followed by receipts, decision timeline and capability-specific conversion/settlement support.
- Preserve and verify: Keep original amount, notes, missing destinations and checksum-unavailable disclosure. Verify UTC decision history, partial approvals, retry/refetch, legacy conversion provenance and scoped settlement; do not replace historical claims with a new report presentation that loses evidence.
- Shared work: F1/F3; owners unchanged.

<a id="r167"></a>

### R167 — /travel-expenses/finance

- Task and scope: Let expense finance actors handle approved reports within approval-time employee/team snapshot scope, with separate read/settle/export capabilities.
- Primary action: Record actual reimbursement where permitted; retain exports and payroll-payment confirmation as distinct workflows.
- Composition: Lead with open approved expenses and employee/team-at-approval/currency/export filters; keep bulk selection, settlement detail, coverage gaps, payroll confirmations and export history grouped.
- Preserve and verify: Verify page-only selection, partial settlement, recoveries, included-payroll restrictions, immutable export evidence and mixed outcomes. Export moves no money; payroll grants alone confer no reimbursement authority.
- Shared work: F1/F2/F3; owners unchanged.

<a id="r168"></a>

### R168 — /travel-expenses/reports/[reportId]

- Task and scope: Let the authorized owner edit a current expense draft, while reviewers/finance and earlier cycles read the appropriate frozen submission.
- Primary action: Save/submit the editable report; otherwise view evidence or use only returned lifecycle/settlement actions.
- Composition: Retain the full-page report workspace: trip details or standalone item, item editors, still-needed guidance, totals and submission; frozen views lead with cycle/status and evidence/history.
- Preserve and verify: Keep drafts/future plans, plain dates/trip zones, receipt provenance, withdrawals/returns/reopen, late receipts and correct return destination. Verify permissions and old-cycle immutability.
- Shared work: F1/F3; owners unchanged.

<a id="r169"></a>

### R169 — /verify-2fa

- Task and scope: Complete the second factor for a pending sign-in using its temporary authentication state.
- Primary action: Verify an authenticator code or backup code.
- Composition: Use a compact branded challenge with one code input, explicit method switching and adjacent pending/error feedback. Keep both reachable with the phone keyboard open.
- Preserve and verify: Retain six-digit authenticator validation, backup-code validation, failure recovery, duplicate-submit prevention and successful continuation. Existing full sessions redirect away; do not conflate this challenge with organization MFA enrollment.
- Shared work: F1 states; F3 input/focus presentation.

<a id="r170"></a>

### R170 — /verify-email

- Task and scope: Verify the current email token and resolve the appropriate next step.
- Primary action: Continue to onboarding, the pending invitation or sign-in after successful verification.
- Composition: Present one bounded status flow: verification progress, result and relevant membership/invitation context, followed by the existing destination action.
- Preserve and verify: Retain missing-token and verification errors, pending versus approved join outcomes, invitation processing, manual continuation and timed redirect. Token changes must cancel stale results/redirects; error states retain sign-in/signup recovery.
- Shared work: F1 auth shell and accessible state presentation.

<a id="r171"></a>

### R171 — /verify-email-pending

- Task and scope: Explain the pending verification step and help the account holder obtain another email.
- Primary action: Resend the verification email.
- Composition: Use a concise instruction surface with inbox/spam guidance, resend feedback beside its action and a clearly available return to sign-in.
- Preserve and verify: Retain email resolution from the supported query/session context, missing-email guidance, resend pending/failure/success distinctions and callback-preserving sign-in navigation. Verification remains a separate step; a resend must not communicate that the account is already verified.
- Shared work: F1 shell/states; F3 pending-action and focus treatment.

<a id="r172"></a>

### R172 — /works-council

- Task and scope: Let an authorized works-council reader review privacy-filtered organization workforce changes for the selected UTC date range.
- Primary action: Update the range or export the existing review pack.
- Composition: Lead with period/privacy context and policy/schedule/compliance summary, then change log and schedule records; retain position-capture and vehicle-use review sections.
- Preserve and verify: Keep feature/ability gates, per-view access audit, hidden identities and insufficient-data states. Verify export redaction and range parity, invalid-range fallback and scoped review data; presentation must not reveal evidence withheld by privacy thresholds.
- Shared work: F1/F2; owners unchanged.

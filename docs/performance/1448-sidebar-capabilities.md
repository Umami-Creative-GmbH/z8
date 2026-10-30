# #1455: independent sidebar capabilities

## Authorized render and navigation

The authenticated layout mounts `ServerSidebarRegion` only after its session/MFA/SSO gate, preference redirect and fresh billing decision finish. The region owns a sidebar-only Suspense boundary. The page and header retain their existing sibling positions and keys.

The fallback uses the same Sidebar primitive, inset/side/collapsible options, width and header/content/footer skeleton dimensions as the application shell. It announces Loading navigation with a status and busy label, without identity or destination links. Desktop/sidebar-frame dimensions remain independent of the page. Mobile uses the same existing off-canvas primitive. Exact browser geometry remains part of the parent deployment gate.

Once render identity, organization flags and settings tier are known, works-council ability, payroll grant, finance access, personnel-file access, period submission settings, presence existence, driving-licence visibility and project-manager capability are started together. Dependencies inside each domain retain their current ordering, including public transaction-capable driving readers. No employee means no payroll/finance/team-presence/submission read; disabled personnel/project/works-council features retain their short circuits. A no-employee organization owner still gets the personnel-file access allowed by the existing resolver.

Each secondary capability failure resolves conservatively for that family and marks the local sidebar notice. Other successful navigation remains. Retry navigation requests a server refresh in a transition, with pending/busy feedback; it does not create a new application tree or a separate client capability-fetch owner. Authoritative identity failures are not treated as successful capability results. No raw database error is sent through the notice.

`hasWhoIsInLocations` now answers the presence boolean with an organization-and-active scoped SELECT 1 / LIMIT 1. Navigation no longer retrieves or sorts location names and IDs just to check collection length. The full manager location chooser is unchanged.

## Identity and domain semantics

The internal server-only render interface adds `getRenderOrganizationIdentity` and `getRenderAbility`. It shares the installed React RSC request cache from #1453; there is no process-wide identity cache. The identity includes approved membership and distinguishes absent employee profiles from ineligible/departed profiles. The CASL principal loads permission/custom-role/manager evidence against those already authorized facts.

Small shared resolver tails let the sidebar reuse that actor/ability for finance, personnel files, driving visibility and project-task management. Their public entry points continue to load current authentication, membership, employment, feature and permission evidence as before; none accepts browser-provided authorization. Navigation is presentation and never grants destination access. Finance custom roles remain excluded; expense, payroll and category-scoped personnel-file grants retain separate meanings. Driving intended-driver, verifier, planner, retained-evidence and retention-only settings meanings remain owned by the same resolver.

No command, timekeeping, billing enforcement or public mutation guard was rewritten. No cross-request cache or TTL was added.

## SSO emission correction

A failing actual layout test established that a session with `ssoRequired: true` could previously emit protected children, even though the display reader declined its context. The central layout now redirects that held identity to the existing locale-aware `/init` workspace activation/SSO flow, carrying the current path as callback and an organization ID when the session still knows one. The enforcement plugin normally clears the active organization for an SSO-held session; workspace initialization already handles restoring/selecting it and starting SSO.

The gate executes before preferences, organization reads, billing, sidebar and protected children. Existing invalid-session, MFA and billing/recovery paths retain their behavior. This is the required protected-emission correction for #1455, not a change to the SSO authentication protocol.

## Evidence

`server-app-sidebar.integration.test.ts` runs the real ServerAppSidebar/ServerSidebarRegion and canonical current clock-status reader with the installed production React server build/RSC renderer and PostgreSQL. React.cache and its dispatcher are not replaced. The test substitutes only session/request transport, the established integration database adapter, and client rendering transport. A worker-owned external pool query gate holds or fails the payroll query; all completed reads still execute real SQL. No shared table lock or fixture reset is used.

Twelve cases cover one shared render identity, organization/active location existence, independent capability starts while payroll is held, streamed sidebar fallback with permitted content and fresh known clock status, local failure retaining successful links, fresh retry, restricted custom roles versus distinct grants, grant/permission revocation, no-employee owner, disabled features, inactive/unapproved employees, and simultaneous distinct user/organization renders.

The first identity test was red at four session evaluations and is green at one; the membership/organization identity and employee-profile query each run once in that sidebar render. The existence test was red because SQL selected/sorted location names. The held-query test was red because driving/presence queries had not started before payroll release. The failed-query test was red because the complete sidebar result errored instead of retaining successful capabilities. These are supporting seam results, not full-HTTP query or latency claims.

The RSC client adapters expose actual sidebar props as navigation and display the canonical clock reader's result as a control. They do not substitute for a production browser test of SiteHeader/TimeClockPopover, hydration, focus, scroll or geometry. Existing real clock transport tests run separately; parent browser gates remain open.

The existing sidebar suite retains its public navigation cases; adapters now point at the render entry points, and request-cache correctness is proved by the separate real RSC suite. `sidebar-feedback.test.tsx` renders the real loading frame and retry UI. Actual layout tests cover SSO denial before protected children/loaders alongside existing MFA, billing denial/outage and recovery cases.

Focused verification: 12 new RSC/PostgreSQL cases; four existing PostgreSQL regression suites / 49 cases for render identity, driving visibility, finance queue and personnel-file officer grants; 11 focused unit files / 242 cases; Phase all-project typechecks; Biome on 19 changed source/test files; React Doctor 100/100 with no diagnostics. No app build or live fixture/runtime probe was run here.

## Parent production gates

Measure first documents and explicit server/router refresh separately from Link navigation inside the persistent layout. The latter normally reuses sidebar state, so its timing cannot establish an improvement to initial capability reads. Keep authentication, MFA/SSO and fresh billing denial before protected emission in actual proxy/browser tests.

Hold and fail a secondary capability through the integrated app, using the parent-owned fixture/proxy. Observe the Loading navigation status/busy sidebar, usable page region and known-ready `[data-clock-status="ready"]` controls. On failure, successful navigation should remain beside Some navigation is unavailable and Retry navigation; release the failure and retry. Verify draft/scroll preservation, keyboard activation, disabled/busy feedback and real destination guards after grant reduction. Confirm matching sidebar frame width/height and no page/header replacement in desktop/mobile viewports.

Record actual first-document/server-refresh SQL families, timings, compressed resources and main-thread/readiness budgets with the original/head parity fixtures. No numerical whole-page performance gain is claimed before those measurements. The parent owns all original/candidate services, collectors and build windows; none was changed by this ticket.

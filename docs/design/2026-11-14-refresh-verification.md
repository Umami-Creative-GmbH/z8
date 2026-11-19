# Dashboard and time-tracking refresh verification

Verified on 14 November 2026 in the actual Next.js 16.4.6 Turbopack application. The repository's guarded disposable performance fixture supplied PostgreSQL 16, Valkey, RustFS, two synthetic organizations and real Better Auth employee/manager accounts. No Phase configuration, production records or production credentials were used. Fixture history is in 2025; current-period summaries can therefore be empty. Clocking checks created a few short synthetic records on the verification date.

Compare the implementation against the [shared shell capability inventory](2026-11-14-shell-capabilities.md), [dashboard capability inventory](2026-11-14-dashboard-capabilities.md), and [time-tracking capability inventory](2026-11-14-time-tracking-capabilities.md).

## Before and after evidence

The before application was rendered from an unmodified historical export of handoff commit `ed14720a0428e3658f9bdcec6ccb3e788c8d9be8`, with its own offline-installed locked dependencies and development output. It used the same disposable database and manager account as the refreshed application. The export did not replace files in the implementation worktree. Captures show actual application data and actions, rather than the approved HTML prototype.

| Surface | Before | Refreshed |
| --- | --- | --- |
| Manager dashboard, 1600 × 1000 | [Before](assets/2026-11-14-dashboard-time-tracking/implementation/before-dashboard-manager-desktop.png) | [After](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-manager-desktop.png) |
| Time tracking, 1600 × 1000 | [Before](assets/2026-11-14-dashboard-time-tracking/implementation/before-time-tracking-desktop.png) | [After](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-desktop.png) |
| Time tracking, 390 × 844 | [Before](assets/2026-11-14-dashboard-time-tracking/implementation/before-time-tracking-phone.png) | [Populated daily records](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-phone-records.png) |

Additional evidence:

- [Team records, leave and approvals](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-team-and-leave.png).
- [Desktop daily records and captured endpoint offsets](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-daily-records.png), selecting the real employee-local week of 3 March 2025.
- [Manager dashboard in dark mode](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-manager-dark.png) and [phone dark dashboard](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-phone-dark.png).
- [Collapsed sidebar and released content width](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-collapsed-sidebar.png), plus [final dark desktop time tracking](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-desktop-dark.png).
- [Dark active clock on phone](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-phone-dark-active.png) and [synchronized desktop break state](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-desktop-dark-break.png).
- [Ordinary employee dashboard](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-employee-desktop.png), [employee phone dashboard with Large text](assets/2026-11-14-dashboard-time-tracking/implementation/after-dashboard-employee-phone-large-font.png), and [employee time tracking with Large text](assets/2026-11-14-dashboard-time-tracking/implementation/after-time-tracking-employee-phone-large-font.png).

## Runtime matrix

| Area | Observed result |
| --- | --- |
| Manager and ordinary employee | Both routes render. Employee navigation omits team/manager destinations, and dashboard omits Manager Today, managed employees and organization summaries. Existing authorized personal widgets remain available. |
| Sidebar | Expanded navigation and collapsed icon rail render. Collapse writes `sidebar_state=false`, survives reload, and releases content width. Control+B toggles navigation after hydration. Control+K opens the real search dialog. |
| Widget preferences | Hid the Organization widget through Customize, reloaded, and verified it remained absent and its menu item unchecked. Restored that selection, reloaded again, and verified the organization summary returned. Other selections and ordering were preserved. |
| Mobile navigation | Drawer opens with search, organization selector, account control and existing destinations. Escape closes the drawer after focus is placed on a navigation link. The final runtime check confirms no remaining dialog, `aria-expanded=false`, and focus returned to the header's Toggle Sidebar button. Dedicated regression coverage also passes. |
| Layout and themes | Checked 1600-pixel desktop, 390-pixel phone and 2560-pixel wide layouts. No document-level horizontal overflow observed on either refreshed route. Real theme control exercised light and dark modes. |
| Enlarged text | Account menu → Font size → Large applies `data-font-size=large` and an 18px computed root font; employee dashboard and time tracking remain usable at 390px without document overflow. |
| Clock and workplace | Selected Home, clocked in, started a break, resumed and clocked out using real actions. Header and page agree on working/break/stopped states. The day band and summary settle without a persistent Updating message after the synchronization fix. |
| Description | Saved a post-clock description through the existing control; the description remains in its actual daily record after reload. |
| Manual validation and recovery | Submitted 09:00 → 08:00 with a reason in the real manual-entry form. The application rejected it with “Clock out time must be after clock in time”; both entered times and the reason remained intact. Canceled afterward. No invalid record was created. The final visible Add Manual Time Entry trigger also opens the same date/time/reason/workplace form and closes successfully. |
| Calendar and history | Selecting `?date=2025-03-03` loads the corresponding employee-local week and calendar. Five daily groups retain 09:00/17:00 endpoints, their captured UTC+01:00 labels, authoritative eight-hour durations and correction controls. Current empty-day context and active/incomplete records also render. |
| Loading and unavailable data | Observed the application shell, clock-status loading, streamed widget loading, empty history/absence/approval states, unavailable work-balance projection, and missing vacation-policy state. Unavailable balances are labeled separately from zero. |
| Accessibility | Axe 4.12.1 reports zero violations and zero incomplete checks for employee dashboard desktop/phone, employee time tracking with Large text, and manager time tracking light desktop/dark active phone after fixes. Earlier progress-label, heading, separator, navigation-landmark and dark-link findings were reported to the owning implementation agents and fixed. |
| Next.js diagnostics | `/_next/mcp` exposes compilation diagnostics and route metadata. Runtime `get_errors` returned no configuration or session errors after fixes. Generated license metadata was required before the all-route compilation probe. React DevTools confirms the existing shared SidebarProvider, organization providers, streamed widget slots and clock consumers remain in the real component tree. |

T3 preview snapshots timed out twice for the running app (`Preview automation snapshot timed out after 15000ms.`), so runtime interaction and capture used a separate worktree-scoped agent-browser 0.39.1 session with React DevTools enabled. The approved prototype was inspected separately by the primary agent.

## Automated checks and production build

The primary agent ran the affected component suite: 76 suites and 702 tests passed, along with repository type checks and changed-file Biome checks. React Doctor reports 93, with no errors and one remaining component-complexity warning. The capability inventories describe retained data/action owners and preference behavior.

A full production build ran in the stopped historical export overlaid with implementation sources, using `CI=true` and only generated local fixture configuration. Its optimized compilation succeeded in 60 seconds and its TypeScript stage succeeded in 36.7 seconds. Static generation remained at 0 of 3,380 pages for approximately nine minutes, with the build process active at about 7.6GB memory. Its own diagnostics still reported `static-generation` and `success: false`; no worker timeout or external dependency error was emitted. Only that verified owned build process tree was stopped. The full production build therefore did not complete and is not counted as passed.

The isolated export was then overlaid with the latest committed and uncommitted application sources. `CI=true next build --experimental-build-mode compile` passed with exit code 0: optimized compilation completed in 59 seconds, route-data collection used two workers, and optimization finalized. This snapshot includes the final shared clock synchronization and visible manual-entry trigger; the last loading-account accessibility label was added afterward and verified separately through runtime compilation and the parent agent's checks. Compile mode deliberately leaves static generation unfinished; it is distinct from a passed full production build. The export needed a local Biome root boundary because an unrelated `Temp/biome.json` report would otherwise be treated as an ancestor configuration. No repository configuration was changed for this.

## Remaining verification limits

- No production environment, deployed ingress, billing-enabled organization or real customer data was exercised.
- Browser checks did not exhaustively drive timezone-mismatch choices, cross-zone/DST travel records, network-offline queue replay, server/network failure injection, restricted custom-role actors, organization-switch mutation, every permission combination, or all export/bulk/pagination flows. Existing regression tests and retained owners cover these paths; they are not claimed as completed browser acceptance checks.
- Manual-entry rejection and description saving were exercised; correction submission/approval, leave submission, manager approval decisions and policy edits were not submitted during this browser pass.
- New translation keys use English defaults through the existing Tolgee translation calls. Configured Tolgee synchronization credentials were unavailable, so catalog synchronization and translated copy in every supported locale remain unverified.
- Captures are distinct observations at different times. Small elapsed-time/record-count changes reflect the real synthetic clock sessions, rather than hardcoded screenshot figures.

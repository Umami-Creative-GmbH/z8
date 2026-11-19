# Shared shell capability inventory (#1689)

Mapped before implementation against `app-layout-content`, `AppSidebar`, navigation builders, `SiteHeader` and the sidebar primitives. The approved handoff and assets remain unchanged.

| Capability / owner | Refreshed location and preservation |
| --- | --- |
| Sidebar / `SidebarProvider` | Existing localStorage `sidebar_state`, cross-tab updates and Ctrl/Cmd+B remain authoritative. Desktop collapse uses the existing icon rail; header toggle exposes expanded state. Mobile remains the Sheet drawer with Escape, focus containment/return, safe areas and automatic close after navigation. |
| Destinations / `app-sidebar-nav` | Same capability-filtered destination builders and relative ordering; workplace and team labels identify scope. No destinations or access checks removed. |
| Search / `AppSearch` | Sidebar search button with collapsed accessible name and tooltip; same Ctrl/Cmd+K, command results, organization-authorized live records, errors and debounce. |
| Organization / `OrganizationSwitcher` | Existing real logo and switching menu in expanded header or collapsed logo button; membership labels, creation permissions, switching state, failure notices and persistence unchanged. |
| Account / `NavUser` | Footer avatar opens the same preferences, account/security, theme and sign-out workflows, including pending/error feedback. Explicit accessible name in the rail. |
| Navigation accessibility | Active-page indication and text alternatives for every icon; focus/hover tooltips include secondary destinations. Collapsed content scrolls so no destinations become unreachable on short screens or with larger text. |
| Route identity / `SiteHeader` | Existing most-specific translated route title in a compact header. Workplace scope is secondary text on larger screens; phone title truncates without hiding controls. |
| Clock / `TimeClockPopover` | Same global clock query, synchronization and operational popover beside notifications. Page clocks continue to use their existing state owners. |
| Refresh / `HeaderRefreshButton` | Desktop action retained; existing labeled mobile overflow action retains invalidation, pending/error feedback and retry. |
| Timezone / `HeaderTimezoneControl` | Existing desktop control and mobile overflow; saved timezone workflow unchanged. |
| Dashboard customization | Existing header trigger and mobile overflow retained, alongside page customization. Same preference owner and events. |
| Offline / policy / billing status | Existing in-flow banners, position-consent host and get-the-app controls remain outside page composition. |
| Shared consumers | Authenticated shell and its loading skeleton use the same sidebar/header dimensions and edge-to-edge treatment. Page content and authorization remain owned by each route. |

No navigation ordering preference currently exists in these navigation components; widget ordering belongs to the dashboard inventory. Theme tokens, the app font and user font-size preferences remain in force.

# Settings Sticky Category Headers Design

## Goal

Keep the current settings landing page and settings navbar layouts while making category headers stay visible during vertical scrolling on both mobile and desktop.

## Design

`SettingsGrid` already renders settings by visible group in order. Each group's existing heading becomes sticky with a top offset so it remains pinned until the next group reaches the same position and replaces it naturally.

The sticky heading keeps the existing text hierarchy, adds a background matching the app surface, and uses z-index/padding to stay readable while cards scroll underneath. No new state, scroll listeners, or duplicated navigation components are needed.

`SettingsNav` also renders groups in order using `SidebarGroupLabel`, but it sits inside the settings layout sidebar, not the app sidebar. The settings-specific label usage becomes sticky inside that settings navbar scroll area. The label keeps the existing sidebar typography, uses the settings navbar `bg-card` surface for readability, removes the rounded pill treatment while sticky, and removes the settings aside padding so the sticky label sits flush at the top and sides of the scroll area. The change remains scoped to the settings navbar so other sidebar labels in the app are unchanged.

## Scope

- Applies to the settings landing page category headers such as Account, Notifications, Organization, Administration, Enterprise, and Data.
- Applies to the settings navbar group labels for the same categories.
- Applies on mobile and desktop.
- Does not change settings visibility, ordering, routing, permissions, card behavior, or global sidebar primitives.

## Testing

Add focused render assertions for sticky header classes on the settings grid and settings navbar. Run the targeted settings grid/nav tests and adjacent settings visibility tests.

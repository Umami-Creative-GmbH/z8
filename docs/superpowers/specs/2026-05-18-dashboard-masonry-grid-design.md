# Dashboard Masonry Grid Design

## Goal

Reduce empty vertical space between dashboard widgets by changing the dashboard widget area from a row-based responsive grid to a masonry-style layout, while preserving widget visibility, reset, and reliable saved-order behavior.

## Scope

- Replace the dashboard widget display layout with responsive masonry-style columns.
- Keep a single-column layout on mobile, two columns at medium dashboard widths, and three columns at wide dashboard widths.
- Preserve the dashboard customization menu, hidden widget handling, empty state, reset behavior, and saved widget order data model.
- Move the dashboard customization trigger into the site header and show it only on the dashboard route.
- Add reliable widget reordering inside the dashboard customization menu.
- Disable direct card drag handles in the masonry grid because CSS column packing makes direct card sorting misleading.
- Update the loading skeleton so it resembles the new packed dashboard layout.

## Out Of Scope

- Database or settings schema changes.
- Organization-wide dashboard templates.
- A measured JavaScript masonry engine.
- A complete drag-and-drop rewrite for masonry placement.
- Direct card drag-and-drop sorting in the masonry grid.
- New widget functionality or changes to widget content.

## User Experience

The dashboard should feel denser and more balanced. Widgets keep their natural heights, and the layout should pack each widget below the previous item in its visual column instead of reserving a full grid row height based on the tallest item in that row.

The saved widget order remains the source order for rendering. The visual layout prioritizes packed columns over strict left-to-right row placement, so users may see widgets fill vertical space in column order rather than row order. This is acceptable because the primary objective is to remove unused gaps.

The dashboard customization control moves out of the widget area and into the site header. It should render only when the normalized route is the dashboard route (`/` after stripping the locale prefix). In the header action group, it should appear before the notification bell, followed by the time clock control. Removing the above-grid customization row eliminates the extra empty space currently visible at the top of the dashboard.

The customization menu remains the dashboard control surface. Users can still hide widgets, re-show widgets, and reset the dashboard layout. The same menu also provides compact reorder controls for visible widgets, using explicit move up and move down actions. First visible widgets cannot move up, last visible widgets cannot move down, and hidden widgets remain toggleable without active reorder controls. If all widgets are hidden or no widgets self-render, the existing empty-state behavior remains intact.

## Architecture

The change should stay inside the existing dashboard component boundary:

- `section-cards.tsx` continues to orchestrate widget order, visibility, loading, and empty-state rendering.
- `site-header.tsx` renders the dashboard customization trigger only on the dashboard route, beside the existing notification bell.
- `dashboard-customize-menu.tsx` owns visibility toggles, reset, and visible-widget reorder controls.
- `sortable-widget-grid.tsx` owns the display container and should switch from row-based CSS grid classes to responsive masonry-style column classes.
- `dashboard-widget.tsx` may add wrapper classes needed for masonry, such as avoiding column breaks and applying vertical spacing between items.
- `use-widget-order.ts` and `widget-registry.ts` remain unchanged unless a test exposes a current ordering bug.

The preferred masonry implementation is CSS columns because it is small, responsive, and avoids introducing measurement logic. The column container should use responsive column counts matching the current dashboard breakpoints. Each widget wrapper should avoid being split across columns.

## Reordering

Direct card drag-and-drop must not ship in the masonry grid. CSS column packing changes visual placement in ways that can make `@dnd-kit` grid sorting confusing, inaccurate, or inaccessible. Dashboard cards should not expose active drag handles in masonry mode.

Reordering remains available through the dashboard customization menu. The menu receives the current visible widget order and an `onReorder` callback. Visible widget rows expose move up and move down controls. Each move creates a new visible widget order and calls the existing reorder flow. `useWidgetOrder` already merges visible order back into the full persisted layout, so hidden widgets keep stable restore positions.

The dashboard still renders widgets from the saved source order. Masonry may distribute widgets into visual columns, but the source order remains persisted and adjustable through the menu.

## Data Flow

No data model changes are required. The dashboard continues to load `dashboardWidgetOrder` from user settings, normalize the saved order and hidden widget IDs, render only visible widget IDs, and persist order or visibility changes through the existing actions.

The masonry layout is purely presentational. It does not change how hidden widgets restore, how invalid widget IDs are normalized, or how the layout reset works. Header placement should pass the same layout state and callbacks currently used by `section-cards.tsx`; no new persistence path is required.

## Error Handling

No new server-side error path is introduced. Existing save failure rollback and toast behavior remains unchanged.

Inactive drag controls must not be visible or focusable in the masonry grid. Reorder menu controls should use disabled states for invalid moves, such as moving the first visible widget up or the last visible widget down.

## Testing

- Update component tests where they assert grid layout classes so they reflect the masonry container and widget wrapper classes.
- Keep existing widget visibility tests passing: hidden widgets should not render, reset should restore widgets, and the empty state should still appear when appropriate.
- Add focused coverage if drag handles become conditional so disabled masonry drag controls are not visible or focusable.
- Test that the site header renders the customization trigger only on the dashboard route.
- Test that `section-cards.tsx` no longer renders an above-grid customization row.
- Test that the customization menu exposes reorder controls for visible widgets, calls `onReorder` with the correct visible order, disables invalid first/last moves, and keeps hidden widgets toggleable without active reorder controls.
- Manually verify desktop three-column packing, medium two-column packing, mobile one-column stacking, loading skeleton shape, hidden-widget empty state, header placement, menu visibility toggles, and menu reorder behavior.

## Implementation Notes

Prefer the smallest change that achieves packed columns and reliable ordering. Do not introduce a masonry library or JavaScript measurement unless CSS columns cannot satisfy the no-gap objective. Keep the visual language restrained and consistent with the existing dashboard surfaces.

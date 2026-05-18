# Dashboard Masonry Grid Design

## Goal

Reduce empty vertical space between dashboard widgets by changing the dashboard widget area from a row-based responsive grid to a masonry-style layout, while preserving existing widget visibility, reset, and saved-order behavior.

## Scope

- Replace the dashboard widget display layout with responsive masonry-style columns.
- Keep a single-column layout on mobile, two columns at medium dashboard widths, and three columns at wide dashboard widths.
- Preserve the dashboard customization menu, hidden widget handling, empty state, reset behavior, and saved widget order data model.
- Treat drag-and-drop reordering as a progressive enhancement: keep it only if it remains predictable in the masonry layout.
- Update the loading skeleton so it resembles the new packed dashboard layout.

## Out Of Scope

- Database or settings schema changes.
- Organization-wide dashboard templates.
- A measured JavaScript masonry engine.
- A complete drag-and-drop rewrite for masonry placement.
- New widget functionality or changes to widget content.

## User Experience

The dashboard should feel denser and more balanced. Widgets keep their natural heights, and the layout should pack each widget below the previous item in its visual column instead of reserving a full grid row height based on the tallest item in that row.

The saved widget order remains the source order for rendering. The visual layout prioritizes packed columns over strict left-to-right row placement, so users may see widgets fill vertical space in column order rather than row order. This is acceptable because the primary objective is to remove unused gaps.

The existing dashboard customization control remains available. Users can still hide widgets, re-show widgets, and reset the dashboard layout. If all widgets are hidden or no widgets self-render, the existing empty-state behavior remains intact.

## Architecture

The change should stay inside the existing dashboard component boundary:

- `section-cards.tsx` continues to orchestrate widget order, visibility, loading, and empty-state rendering.
- `sortable-widget-grid.tsx` owns the display container and should switch from row-based CSS grid classes to responsive masonry-style column classes.
- `dashboard-widget.tsx` may add wrapper classes needed for masonry, such as avoiding column breaks and applying vertical spacing between items.
- `use-widget-order.ts` and `widget-registry.ts` remain unchanged unless a test exposes a current ordering bug.

The preferred masonry implementation is CSS columns because it is small, responsive, and avoids introducing measurement logic. The column container should use responsive column counts matching the current dashboard breakpoints. Each widget wrapper should avoid being split across columns.

## Drag And Reordering

Drag-and-drop must not ship in a confusing or unreliable state. The implementation should first try to preserve the current `@dnd-kit` setup inside the masonry container. If sorting remains predictable, the existing drag handles can stay.

If CSS column packing causes inaccurate drop targets, surprising item movement, or inaccessible keyboard sorting, drag handles should be disabled or hidden in masonry mode. In that fallback, the dashboard still keeps all core functionality through visibility controls, reset behavior, and saved rendering order. A future measured masonry sorter can reintroduce drag support if needed.

## Data Flow

No data model changes are required. The dashboard continues to load `dashboardWidgetOrder` from user settings, normalize the saved order and hidden widget IDs, render only visible widget IDs, and persist order or visibility changes through the existing actions.

The masonry layout is purely presentational. It does not change how hidden widgets restore, how invalid widget IDs are normalized, or how the layout reset works.

## Error Handling

No new server-side error path is introduced. Existing save failure rollback and toast behavior remains unchanged.

If drag is disabled for masonry, inactive drag controls must not be visible or focusable. This avoids presenting an affordance that cannot complete successfully.

## Testing

- Update component tests where they assert grid layout classes so they reflect the masonry container and widget wrapper classes.
- Keep existing widget visibility tests passing: hidden widgets should not render, reset should restore widgets, and the empty state should still appear when appropriate.
- Add focused coverage if drag handles become conditional so disabled masonry drag controls are not visible or focusable.
- Manually verify desktop three-column packing, medium two-column packing, mobile one-column stacking, loading skeleton shape, hidden-widget empty state, and drag behavior.

## Implementation Notes

Prefer the smallest change that achieves packed columns. Do not introduce a masonry library or JavaScript measurement unless CSS columns cannot satisfy the no-gap objective. Keep the visual language restrained and consistent with the existing dashboard surfaces.

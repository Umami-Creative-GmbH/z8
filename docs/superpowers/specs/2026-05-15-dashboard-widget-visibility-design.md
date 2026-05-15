# Dashboard Widget Visibility Design

## Goal

Add a dashboard customization option that lets users hide and re-show specific dashboard widgets in addition to the existing widget reordering behavior. The customization entry point must be icon-only, with an accessible label, and must not use a visible "Customize" button label.

## Scope

- Add an icon-only dashboard layout control near the widget grid.
- Let users toggle individual dashboard widgets between visible and hidden.
- Persist hidden widgets in the existing dashboard layout preference.
- Preserve existing drag-and-drop reordering for visible widgets.
- Provide a reset action that restores the default widget order and shows all widgets.
- Show an empty state if the user hides every widget.

## Out Of Scope

- Organization-wide dashboard templates.
- Role-based widget visibility rules beyond existing widget self-rendering behavior.
- A separate settings page for dashboard layout preferences.
- A database migration for a new visibility column.

## User Experience

The dashboard gains a small icon-only trigger using a settings or sliders-style icon. It should have an accessible name such as `Customize dashboard`, but no visible text label. Activating the trigger opens a compact menu or popover with a row for each registered dashboard widget.

Each row shows a human-readable widget name and a checkbox or switch representing whether that widget is visible. Toggling a widget off hides it immediately from the grid. Toggling it on restores it according to the saved widget order. A reset action in the same surface restores `DEFAULT_WIDGET_ORDER` and clears all hidden widget IDs.

If all widgets are hidden, the dashboard should render a small empty state in the grid area that explains widgets are hidden and directs the user to the icon control to re-enable them.

## Architecture

The current dashboard stores per-user layout preferences in the `user_settings.dashboard_widget_order` JSONB column. Extend the existing JSON object instead of adding a new column:

```ts
type DashboardWidgetOrder = {
	order: string[];
	hidden?: string[];
	version: 1;
};
```

Existing saved objects without `hidden` normalize to an empty hidden list. Unknown widget IDs and duplicates should be removed from both `order` and `hidden`. New widgets remain visible by default unless a user explicitly hides them later.

## Components

- `widget-registry.ts` owns valid widget IDs, default order, normalization, and widget display metadata for the customization list.
- `use-widget-order.ts` continues to fetch and save dashboard layout preferences, but also exposes `hiddenWidgets`, `visibleWidgetOrder`, `onVisibilityChange`, and reset behavior.
- `section-cards.tsx` renders the icon-only customization control and maps only visible widget IDs to widget components.
- `sortable-widget-grid.tsx` keeps drag-and-drop focused on visible widgets and passes reordered visible IDs back to the hook.
- `dashboard-widget.tsx` keeps the existing drag handle behavior inside each widget.

## Data Flow

On load, user settings are fetched through the existing `getUserSettings` action. The client normalizes the saved order and hidden IDs. The dashboard renders only IDs that are not hidden, while the customization surface lists all valid widget IDs.

When a user hides or shows a widget, the client optimistically saves the full layout object: normalized order, hidden IDs, and version. When a user reorders visible widgets, the visible order is merged with hidden IDs still present in the full saved order so hidden widgets keep a stable restore position.

## Error Handling

Saving failures should roll back the optimistic query cache and show the existing dashboard layout save error toast pattern. Invalid or stale IDs from old preferences are silently ignored during normalization. If a widget component self-renders `null` because the user lacks relevant data or permissions, that conditional rendering remains separate from the user's explicit hidden list.

## Testing

- Unit-test layout normalization: unknown IDs are ignored, duplicates are removed, missing `hidden` becomes `[]`, new widgets are visible by default, and saved order is preserved.
- Unit-test visibility behavior where practical: hiding adds a valid ID to `hidden`, showing removes it, and reset restores default order with no hidden IDs.
- Component-test the customization control where practical: the trigger is icon-only but accessible, hidden widgets are not rendered, and the empty state appears when all widgets are hidden.

## Implementation Notes

Prefer the smallest change that fits the existing dashboard structure. Do not add a database migration. Keep strings localizable in the same style as existing dashboard copy when adding visible user-facing text.

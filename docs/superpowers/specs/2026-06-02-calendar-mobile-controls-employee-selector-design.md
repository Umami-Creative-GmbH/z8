# Calendar Mobile Controls And Employee Selector Sheet Design

## Goal

Make the `/calendar` view usable on mobile by moving bulky filter and legend controls out of the stacked page flow. Also make the shared employee selector use the available sheet height instead of leaving a large blank area below the list.

## Scope

- Mobile calendar layout for non-year calendar views.
- Existing `CalendarFiltersComponent` and `CalendarLegend` presentation only.
- Shared `EmployeeSelectModal` list sizing across mobile and desktop.

## Non-Goals

- No changes to calendar event fetching, filters state semantics, permissions, or employee scoping.
- No redesign of desktop calendar sidebar behavior.
- No changes to employee search, filtering, pagination, or selection behavior.

## Calendar Mobile Controls

On desktop, the current sidebar remains unchanged: employee selector, balance, filters, and legend stay in the left column.

On mobile, the employee selector and work balance remain visible in the page because they are primary context. `Filter` and `Legende` move into a mobile-only bottom sheet opened from a compact control button. The bottom sheet contains the existing filter switches and legend content, preserving current labels, translations, and toggle behavior.

The mobile control should be available only outside year view, matching the current sidebar visibility. The sheet should use the existing design system primitives and maintain dark/light theme support.

## Employee Selector Sheet Height

`EmployeeSelectModal` currently renders inside a full-height right-side action panel, but its employee list is capped at `max-h-[320px]`. Remove that fixed cap and make the command layout flex through the available height: header/search and footer keep their natural height, while the employee list gets `flex-1 min-h-0 overflow-y-auto`.

This makes the list fill the sheet on mobile and desktop while keeping pagination, loading, empty states, and multi-select footer controls unchanged.

## Testing

- Add or update component tests where practical to assert the mobile controls render separately from desktop sidebar content.
- Add a source-level or component-level regression test for the employee selector list layout class if existing tests support it.
- Run targeted calendar and employee selector tests, then lint/type checks as needed.

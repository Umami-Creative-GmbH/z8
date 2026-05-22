# Sidebar Calendar Order and Time Tracking Calendar Link Design

## Goal

Make calendar navigation easier to find from the primary sidebar and the time tracking page.

## Scope

- Reorder personal sidebar navigation so `Calendar` appears immediately after `Time Tracking`, followed by `My Requests`.
- Add a `View Calendar` link in the `Time Entries` table card header on `/time-tracking`.
- Keep existing routes, permissions, data loading, and table behavior unchanged.

## UI Behavior

- The sidebar personal navigation order starts with `Dashboard`, `Time Tracking`, `Calendar`, `My Requests`, then the existing remaining items.
- The `Time Entries` card header includes a secondary navigation action linking to `/calendar` alongside the existing manual time entry action.
- The link should follow existing app navigation conventions and be accessible by name.

## Testing

- Update sidebar tests to assert the personal navigation order around `Time Tracking`, `Calendar`, and `My Requests`.
- Add or update time tracking table coverage to assert the `View Calendar` link points to `/calendar`.

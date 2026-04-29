# Settings Teams Split Design

## Goal

Split the combined `Organization & Teams` settings entry into two focused settings panels. Organization management should be reserved for organization admins, while team management should remain available to managers with scoped team permissions. Team create, edit, and delete actions should refresh the visible settings panel so users immediately see the canonical server state, and the panel should include an explicit Refresh action.

## Current State

The settings menu exposes one `organizations` entry titled `Organization & Teams`. The `/settings/organizations` page loads organization details, invitations, members, and team data, then renders tabbed `OrganizationTab` and `TeamsTab` content. A dedicated `/settings/teams` page already exists and reuses `TeamsTab`, but it is not exposed as its own settings entry.

`TeamsTab` keeps a local `teams` state seeded from server props. Create and edit append or replace local state, and delete removes local state optimistically. The component invalidates TanStack Query team keys, but the settings list itself is server-prop driven, so invalidation does not reliably refresh the visible UI after mutations.

## Proposed Approach

Use the smallest split that matches the current architecture.

1. Rename the existing settings menu entry from `Organization & Teams` to `Organization`, keep its href as `/settings/organizations`, and raise its minimum tier to `orgAdmin`.
2. Add a separate `teams` settings entry pointing at `/settings/teams`, with minimum tier `manager`.
3. Simplify `/settings/organizations/page.tsx` so it only loads and renders organization/member/invitation data. It should no longer load team settings data or render the teams tab.
4. Keep `/settings/teams/page.tsx` as the canonical teams settings panel for both managers and org admins.
5. Update `TeamsTab` mutation success handling to call `router.refresh()` after create, edit, and delete, while retaining local updates for immediate feedback.
6. Add a Refresh button to the Teams card header that calls `router.refresh()` so users can manually reload the server-backed list.

## Access Rules

Organization settings are org-admin-only because they include organization details, invitations, and member administration. Teams settings remain manager-visible and continue to rely on the existing scoped team surface so managers only see and manage permitted teams.

Managers should see `/settings/teams` in settings navigation and should no longer see `/settings/organizations`. Org admins should see both entries.

## UI Behavior

The Teams page keeps its existing card layout. The card header includes Create Team when permitted and a secondary Refresh button. On create, edit, or delete success, the component shows the existing success toast, updates local UI immediately, and triggers a route refresh so server-rendered props catch up with the database and permission scope.

If delete fails through either a rejected mutation or an unsuccessful server-action result, the optimistic local deletion should be rolled back and an error toast should be shown.

## Testing

Update settings visibility tests to assert that managers see `teams` and do not see `organizations`, while org admins see both. Update settings route access tests so managers can access `/settings/teams` separately from org-admin-only `/settings/organizations`.

Run the targeted settings tests after implementation. Run broader checks if local changes affect shared settings config or route access behavior.

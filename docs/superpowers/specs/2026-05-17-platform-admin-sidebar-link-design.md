# Platform Admin Sidebar Link Design

## Goal

Show a `Platform Admin` link in the webapp left sidebar for users who are platform admins, directly below the existing `Feedback` link. Org-admin access and platform-admin access must remain separate concepts.

## Current Context

- `AppSidebar` builds the left sidebar navigation in `apps/webapp/src/components/app-sidebar.tsx`.
- `ServerAppSidebar` passes server-derived organization and settings state into `AppSidebar` from `apps/webapp/src/components/server-app-sidebar.tsx`.
- Org-admin sidebar behavior currently uses `settingsAccessTier === "orgAdmin"` to show compliance navigation.
- Platform-admin access is checked elsewhere with `session.user.role === "admin"`, including the `/platform-admin` layout.

## Design

Add a dedicated `showPlatformAdminNav` boolean prop to `AppSidebar`. `ServerAppSidebar` will derive this value from `authContext?.user.role === "admin"` and pass it through.

When `showPlatformAdminNav` is true, append a secondary navigation item immediately after `Feedback`:

- Title: `Platform Admin`
- URL: `/platform-admin`
- Icon: `IconServerCog`, matching existing sidebar icon style
- Translation key: `nav.platform-admin`

The link must not depend on `employeeRole`, `settingsAccessTier`, `showComplianceNav`, or organization membership. Org admins who are not platform admins must not see the platform-admin link.

## Data Flow

1. `ServerAppSidebar` loads `authContext` with `getAuthContext()`.
2. It computes `showPlatformAdminNav` from the platform user role: `authContext?.user.role === "admin"`.
3. `AppSidebar` receives the boolean and conditionally adds the `/platform-admin` secondary nav item after `Feedback`.

## Error Handling

No new runtime error handling is needed. If auth context is missing or the role is not `admin`, the link is hidden. The `/platform-admin` route continues to enforce authorization server-side.

## Testing

Update sidebar tests to verify:

- The `Platform Admin` link appears when `showPlatformAdminNav` is true.
- The link is absent by default.
- `ServerAppSidebar` passes `showPlatformAdminNav: false` for org-admin-only users.
- `ServerAppSidebar` passes `showPlatformAdminNav: true` when the authenticated user's platform role is `admin`.

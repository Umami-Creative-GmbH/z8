# Platform Admin Organization Users Design

## Goal

Platform admins need to see which organizations each user belongs to, and they need a fast way to open an organization and review its users with membership roles such as owner, admin, manager, or member.

## Scope

This change updates the existing platform admin users and organizations pages. It does not add organization detail pages, edit membership roles, or change tenant-level permissions.

## Recommended Approach

Use the existing `/platform-admin/users` page as the organization member view by adding an optional `organizationId` URL filter.

This is the smallest durable approach because it keeps pagination, search, user status filtering, session actions, and ban actions in one users table. It also makes filtered views shareable through the URL.

## Data Model

The existing Better Auth tables already contain the required relationships:

- `user` stores platform users.
- `organization` stores organizations.
- `member` links users to organizations through `userId` and `organizationId`, with `role` and `status` fields.

`PlatformAdminService.listUsers` will accept an optional `organizationId` filter and return each user with an `organizations` array containing `id`, `name`, `slug`, `role`, and `status`.

When `organizationId` is present, `listUsers` will only return users that have a membership row for that organization. The returned `organizations` array may be limited to the matching organization so the role shown in the table is unambiguous.

When no `organizationId` is present, the users table will show all users and summarize all known organization memberships for each user.

## User Interface

On `/platform-admin/users`, add an `Organizations` column. Each membership will render as a compact badge or text chip with the organization name and membership role, for example `Acme Corp · owner`.

If the users page is filtered by `organizationId`, show a small filter context near the page header so the admin can see they are viewing users for a specific organization. Existing search and user status filters remain available and continue to combine with the organization filter.

On `/platform-admin/organizations`, make both the organization row's primary organization label and member count navigate to `/platform-admin/users?organizationId=<org.id>`. This gives admins a direct path from an organization to its member list without adding a separate drawer or detail route.

## Access Control

All new data access remains behind the existing `requirePlatformAdmin()` check in the platform admin server actions. This feature is for platform admins only and does not expose cross-organization membership data to tenant users.

## Error Handling

If listing users fails, the existing users page query error behavior should continue to apply. If an `organizationId` does not match any memberships, the users table should show the existing empty state rather than a special error.

## Testing

Update the users page test to verify that organization membership labels and roles render while the redacted user label behavior remains intact.

Update the organizations page test to verify that organization rows expose links to `/platform-admin/users?organizationId=<org.id>`.

Add service-level coverage if existing service tests are available for platform admin listing behavior; otherwise keep coverage at the page/action boundary to match the current platform-admin tests.

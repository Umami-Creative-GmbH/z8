# Disable Organization Creation Env Design

## Purpose

Dedicated and private deployments may need to keep Z8 limited to one pre-created organization. Add a system-level environment variable that disables all new organization creation without affecting normal organization membership, invitations, or access to the existing organization.

## Environment Variable

Add `DISABLE_ORGANIZATION_CREATION` as a server-only environment variable in `apps/webapp/src/env.ts`.

The variable accepts `"true"` or `"false"` and defaults to `"false"`. When unset, existing multi-organization behavior remains unchanged.

## Enforcement

When `DISABLE_ORGANIZATION_CREATION=true`, organization creation is blocked for every user, including system admins and users in onboarding.

The Better Auth organization plugin should check the flag before checking user role or `canCreateOrganizations`. If the flag is enabled, `allowUserToCreateOrganization` returns `false` immediately.

The onboarding organization creation server action should also fail before temporarily setting `canCreateOrganizations=true`. This prevents transient permission changes and gives the onboarding flow a predictable server-side failure path.

## UI Behavior

Server-rendered UI should treat organization creation as unavailable when the flag is enabled. Sidebar and organization settings props that currently allow creation for system admins or permitted users should include the env guard so create-entry UI is hidden or disabled.

Client code should not read this env var directly. The server should pass the effective `canCreateOrganizations` value to existing client components.

## Data Flow

1. Deployment sets `DISABLE_ORGANIZATION_CREATION=true`.
2. `env.ts` validates and exposes the server-only value.
3. Shared server-side creation checks read the effective disabled state.
4. Better Auth rejects organization creation for all users.
5. Onboarding creation rejects before permission mutation.
6. Server-rendered pages pass `canCreateOrganizations=false` to client UI.

## Error Handling

Onboarding creation should return a normal server action validation failure with a clear message such as `Organization creation is disabled for this deployment.` Better Auth client creation from hidden or stale UI can use the existing auth error path.

## Testing

Add or update tests to cover:

- `DISABLE_ORGANIZATION_CREATION` defaults to `"false"`.
- `DISABLE_ORGANIZATION_CREATION=true` is accepted by env validation.
- The organization creation guard denies creation for all users when enabled.
- UI permission calculation returns false when creation is disabled, where practical.

## Out Of Scope

This does not add an organization count limit, an admin override, or automatic first-organization provisioning. Operators can temporarily set the variable to `"false"` if they need to create another organization intentionally.

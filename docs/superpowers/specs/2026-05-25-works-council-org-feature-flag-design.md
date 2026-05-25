# Works Council Org Feature Flag Design

## Goal

Works Council access should be activated by a single organization-level feature flag, matching the existing optional feature toggles. When the flag is disabled, Works Council navigation and access should be unavailable for the organization. When enabled, access is limited to organization owners/admins and users who have the explicit Works Council permission.

## Scope

- Add `worksCouncilEnabled` to the organization feature flags with a default of `false`.
- Surface the flag in the Organization Features card alongside Shifts, Projects, Surcharges, and Demo Data.
- Use the organization flag as the feature activation source of truth for Works Council sidebar visibility.
- Do not use `works_council_settings.enabled` as an additional activation gate for sidebar visibility or feature availability.

## Data Model

Add a boolean `works_council_enabled` column to the Better Auth organization table schema and auth organization plugin configuration. The field defaults to `false` and participates in the same server action toggle path as the other organization feature flags.

The existing `works_council_settings` table remains for Works Council configuration details, not feature availability.

## Access Rules

The Works Council sidebar entry is visible only when all conditions are true:

1. The active organization has `worksCouncilEnabled` enabled.
2. The current user is allowed to access Works Council, either because they are an organization owner/admin or because their permissions include the explicit Works Council access permission.

If the organization flag is disabled, the entry is hidden for every user regardless of permissions.

## UI Changes

The Organization Features card gets a new Works Council row with a gavel icon, short description, and owner-only switch behavior consistent with the existing feature rows. Toggling uses the existing optimistic update and `toggleOrganizationFeature` server action pattern.

## Server Flow

`getUserOrganizations` includes `worksCouncilEnabled` so `ServerAppSidebar` can derive the active organization's feature state. The app layout should only request/show Works Council navigation when the organization feature flag is enabled and the current user has the required access.

## Testing

Add or update tests to cover:

- Works Council feature flag is included in organization feature state.
- Organization owners/admins see Works Council navigation when the org flag is enabled.
- Users with explicit Works Council permission see navigation when the org flag is enabled.
- Users without sufficient access do not see navigation even when the flag is enabled.
- No user sees navigation when the org flag is disabled.

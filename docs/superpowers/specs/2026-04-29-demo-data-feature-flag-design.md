# Demo Data Feature Flag Design

## Goal

Allow organization owners to disable the Demo Data settings area the same way they can disable optional features such as shifts, projects, and surcharges.

The feature should preserve current behavior for existing organizations by defaulting Demo Data access to enabled.

## Current State

- Optional organization features are represented as organization-level booleans: `shiftsEnabled`, `projectsEnabled`, and `surchargesEnabled`.
- Owners toggle these booleans in the organization features card.
- Settings entries can declare `requiredFeature`, which hides entries when the matching organization feature is disabled.
- The Demo Data settings entry currently has no required feature, so `/settings/demo` is always visible to org admins.
- `src/db/auth-schema.ts` is generated and must not be edited directly.

## Chosen Approach

Add a new organization-level boolean feature flag named `demoDataEnabled`, defaulting to `true`.

This mirrors the existing feature model while keeping current access intact until an owner explicitly disables Demo Data.

## Behavior

- Organization owners see a Demo Data switch in the existing Features card.
- When enabled, Demo Data remains visible and accessible through the settings list.
- When disabled, the Demo Data settings entry is hidden by `requiredFeature: "demoDataEnabled"`.
- Non-owners keep the existing read-only behavior for feature switches.
- Existing organizations should continue to have Demo Data enabled after migration/schema update.

## Implementation Notes

- Extend organization settings types, state, and hydration with `demoDataEnabled`.
- Extend the feature toggle server action union to accept `demoDataEnabled`.
- Add the Demo Data switch to `OrganizationFeaturesCard`, following the existing optimistic update and rollback pattern.
- Mark the Demo Data settings entry with `requiredFeature: "demoDataEnabled"`.
- Update tests that construct feature-flag state to include the new flag where needed.
- Do not edit `src/db/auth-schema.ts` directly; update the source schema/migration path used by this project instead.

## Testing

- Settings config tests should verify Demo Data is visible when `demoDataEnabled` is true and hidden when false.
- Existing visibility tests for shifts, projects, and surcharges should continue to pass.
- Organization feature UI should preserve optimistic updates and rollback behavior for the new switch.

## Out Of Scope

- Changing the Demo Data wizard internals.
- Adding per-role Demo Data permissions beyond the existing settings access tiers.
- Changing generated demo-data content or destructive cleanup behavior.

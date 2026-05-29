# Work Policy Presets Design

## Context

The webapp already has a Work Policies settings page at `/settings/work-policies` with a Presets tab, seeded system preset data, an import component, and server actions for listing and importing active presets. The current flow is too limited: presets are treated mainly as one-click imports, there is no organization-owned custom preset management, and admins cannot review or rename preset-derived data before saving.

This design turns the Presets tab into a preset library for org admins. System presets remain read-only defaults seeded by Z8. Organization presets are reusable templates owned by a single organization and editable only by that organization's admins.

## Goals

- Let org admins browse, search, filter, and preview system and custom work policy presets.
- Let org admins use any visible preset as the starting point for a real work policy.
- Let org admins copy a system preset into an organization-owned custom preset and then edit it.
- Let org admins create, edit, and archive custom organization presets.
- Require reviewed, organization-unique names before creating policies or custom presets.
- Preserve tenant isolation and org-admin authorization for all mutations.

## Non-Goals

- Do not let organization admins edit seeded system presets.
- Do not promote organization presets to global/system presets.
- Do not make presets live-linked to policies created from them.
- Do not assign presets directly to employees, teams, or organizations.
- Do not change compliance calculations as part of this feature.

## Data Model

The existing `work_policy_preset` table becomes the source for both system and organization presets.

Preset rows are classified by ownership:

- System preset: `organizationId = null`. These are seeded, active by default, and read-only to org admins.
- Custom preset: `organizationId = current organization`. These are created and managed by org admins.

The preset stores template values only: name, description, country, schedule defaults, regulation limits, and break rules. A preset does not affect work balances, policy assignments, or compliance until it is used to create an actual `work_policy`.

Uniqueness rules:

- System preset names remain unique among system presets.
- Custom preset names are unique within the same organization.
- Work policy names remain unique within the same organization.

Visibility rules:

- Reads return active system presets plus active custom presets for the requested organization.
- Mutations on custom presets always filter by `organizationId`.
- Mutations on system presets are rejected for org admins except copying or using them as a policy source.

## Server Actions

Preset functionality should use explicit preset actions rather than overloading policy actions.

- `getWorkPolicyPresets(organizationId)` returns active system presets and active custom presets for the organization.
- `createWorkPolicyPreset(organizationId, input)` creates an organization-scoped custom preset.
- `updateWorkPolicyPreset(organizationId, presetId, input)` updates only an organization-owned custom preset.
- `archiveWorkPolicyPreset(organizationId, presetId)` soft-deletes only an organization-owned custom preset.
- `copySystemWorkPolicyPreset(organizationId, presetId, input)` creates an organization-owned editable copy from a system preset.
- `createWorkPolicyFromPreset(organizationId, presetId, input, setAsDefault)` creates a real work policy from reviewed values.

All mutations require org-admin access. Reads must verify the actor can access the organization. Duplicate-name validation happens server-side and returns field-specific validation errors the UI can show inline.

When a real work policy is created or set as default, the existing work-balance dirty marking behavior applies. Creating, editing, copying, or archiving a preset template does not mark work balances dirty.

## UI Flow

Replace the current simple import grid with a preset library in the Presets tab.

The tab includes:

- Search by name and description.
- Filters for all presets, system presets, custom presets, and country.
- Cards or rows showing name, source badge, country, description, key limits, schedule hours, and break rule summary.
- System preset actions: `Use as policy` and `Copy to custom preset`.
- Custom preset actions: `Use as policy`, `Edit preset`, and `Archive`.
- A `Create custom preset` action for org admins.

Every create/copy/use action opens a review dialog before saving. The review dialog includes name, description, schedule fields, regulation fields, and break rules. The dialog must require a unique name in the relevant target scope before saving.

The review dialog can save to one of two targets:

- `Use as policy`: creates a new active work policy from the reviewed values, with an option to set it as the organization default.
- `Save as custom preset`: creates or updates an organization-owned reusable preset.

## Behavior

- System presets are read-only templates.
- Copying a system preset creates an editable custom preset owned by the current organization.
- Editing a custom preset does not update work policies previously created from it.
- Archiving a custom preset hides it from the library but does not affect policies previously created from it.
- Using any preset as a policy creates a new `work_policy`; it does not mutate the source preset.
- Duplicate names are handled in the review dialog by asking the admin to provide a unique name.
- If a preset contains invalid template data, the save action fails with a validation error rather than creating a partial policy or preset.

## Components

Expected component boundaries:

- `WorkPolicyPresetLibrary`: owns query state, filters, empty/error/loading states, and action dispatch.
- `WorkPolicyPresetCard` or table row component: renders a single preset summary and allowed actions.
- `WorkPolicyPresetReviewDialog`: handles create, copy, edit, and use-as-policy review flows.
- Small formatter utilities for minutes, schedule summaries, and break rule summaries.

The review dialog can reuse existing work policy form patterns where practical, but it should keep the concept of a preset template separate from an active work policy.

## Testing

Server action tests should cover:

- Org-admin authorization for create, update, archive, copy, and use-as-policy mutations.
- Organization-scoped visibility for system and custom presets.
- Rejection when editing or archiving system presets.
- Rejection when editing or archiving another organization's custom preset.
- Duplicate-name validation for organization presets and created work policies.
- Reviewed input being used when copying a system preset or creating a work policy.

UI tests should cover:

- Loading, empty, and error states.
- Search and source/country filtering.
- System presets hiding edit/archive actions.
- Custom presets showing edit/archive actions.
- Review dialog opening from create, copy, edit, and use-as-policy actions.
- Inline validation when the server reports a duplicate name.
- Query invalidation after successful preset and policy mutations.

## Migration Notes

The implementation needs a schema migration to add nullable `organization_id` ownership to `work_policy_preset`, remove the current global unique-name constraint, and add indexes that enforce system and organization uniqueness separately. Existing seeded rows become system presets by leaving `organization_id` null.

The seed process should continue to maintain system presets without deleting organization-owned custom presets.

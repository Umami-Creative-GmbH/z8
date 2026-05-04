# Email Template Default Prefill Design

## Purpose

Make organization email template customization clearer by removing the system-default/custom toggle. Admins should always see an editable template prefilled with the system template. Saving turns that draft into the organization's custom template. Resetting removes the customization and restores the system template.

## Current Behavior

The email template settings UI currently exposes a toggle between `System default` and `Custom template`. The stored `organization_email_template.isEnabled` value controls whether an existing override is used at runtime. When no override exists, the UI shows starter draft content rather than the actual system email content.

This creates two UX problems:

- Admins must understand a mode switch before editing.
- The first editing experience does not clearly start from the real system template they are replacing.

## Approved Approach

Use **editor-only prefill**.

For each organization and template, the editor should load with the real system default subject and body when no organization override exists. The editable draft should preserve template variables as `{{variableName}}` tokens, not replace them with preview sample values. No database row is created until an admin saves changes. This keeps persistence clean while making the UI feel like every organization already has a ready-to-edit template.

Alternative approaches were rejected:

- Eagerly creating rows for every organization/template would add unnecessary data and blur the distinction between default and customized templates.
- Creating rows when the settings page is visited would persist templates for admins who only viewed the page.

## UX Design

Remove the toggle from the selected template header.

Show the selected template as editable in all cases:

- If no override exists, subject and body are prefilled from the system template.
- If an override exists, subject and body are loaded from the override.
- The status badge reads `Default` when no override exists.
- The status badge reads `Customized` when an override exists.

Replace the existing `Reset` button with `Reset to system template`.

Reset behavior:

- Available for all templates.
- Deletes the organization override for the selected template.
- Refreshes the settings data.
- Replaces the local editor draft with the system template subject and body.
- Shows success copy that explicitly says the template was reset to the system template.

Copy should avoid mode language like `use custom template`, `disabled`, or `system default toggle`. Preferred language is `Default`, `Customized`, `System template`, and `Reset to system template`.

## Data Flow

Listing templates should return editor-ready draft content for every template:

1. Load organization overrides scoped by the active `organizationId`.
2. For each registry template, compute the system editor draft from the default renderer and default subject while preserving allowed variables as `{{variableName}}` tokens.
3. If an override exists, return the override content.
4. If no override exists, return the computed system draft content.

Saving keeps the current organization-scoped upsert model. The saved row represents customization. The UI no longer needs to send an admin-controlled enabled/disabled state; saved custom templates should be stored as enabled.

Reset keeps the current organization-scoped delete model. Deleting the row is the canonical way to return to the system template.

The existing `isEnabled` column can remain in the schema for compatibility. The new UI should not expose it as a toggle. Runtime lookup may continue to require `isEnabled = true` so older disabled rows remain ignored until they are overwritten by a save.

## Rendering Behavior

Runtime rendering remains fallback-first and organization-scoped:

1. If no `organizationId` is provided, render the system template.
2. If an enabled organization override exists, validate and render the override.
3. If no override exists, the override is disabled, or validation fails, render the system template.

This design changes the admin editing experience, not the outbound email safety model.

## Validation And Security

Authorization stays unchanged:

- Only organization admins/owners with settings access can list, save, test, or reset templates.
- Every query and mutation must filter by the active `organizationId`.

Validation stays unchanged:

- Validate subject, HTML, plain text, editor document shape, and allowed variables before save or test send.
- Treat saved HTML as user input and sanitize it before storage or send.
- Test sends remain limited to the current admin's own email address.

## Testing Plan

Update tests to cover:

- The toggle is no longer rendered.
- Templates without overrides open with system default subject and body.
- Saving a template without an existing override creates an enabled organization override.
- Existing overrides still load as customized drafts.
- Reset deletes the override and restores the system template draft locally.
- The reset button label reads `Reset to system template`.
- Runtime rendering still falls back to the system template when no enabled override exists.

## Implementation Notes

- Keep the change minimal and focused on the existing email template feature.
- Do not add eager backfill jobs or migrations for default template rows.
- Do not remove `isEnabled` from the database in this change.
- Reuse existing server actions and tests where possible.
- Do not add new environment variables.

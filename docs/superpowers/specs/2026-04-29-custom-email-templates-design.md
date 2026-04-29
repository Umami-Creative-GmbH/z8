# Custom Email Templates Design

## Purpose

Allow organization admins to customize every email template Z8 sends for their organization while keeping the current system templates as the reliable fallback. Customization covers both subject and body, uses `@react-email/editor` for a full visual editing experience, and only allows variables that Z8 exposes for each template.

## Scope

This feature covers all current system email templates:

- Email verification
- Password reset
- Organization invitation
- Absence request submitted
- Absence request pending approval
- Absence request approved
- Absence request rejected
- Time correction pending approval
- Time correction approved
- Time correction rejected
- Team member added
- Team member removed
- Security alert
- Export ready
- Export failed

Templates are organization-scoped. If an organization has no enabled override for a template, or if the override fails runtime validation, Z8 renders and sends the system default template.

Out of scope for the first version:

- Admin-defined custom variables
- Dynamic variables mapped from arbitrary employee or organization fields
- Executing custom React or JavaScript from admins
- Per-language template variants
- A full notification workflow builder

## Architecture

Add an organization-scoped template override layer above the existing React Email renderers.

Core modules:

- Template registry: defines every supported template key, label, description, category, default subject, allowed variables, preview sample data, and system default renderer.
- Persistence service: reads and writes organization template overrides, always scoped by `organizationId`.
- Validation service: extracts `{{variableName}}` placeholders from subject and editor output, rejects unknown variables, checks required fields, and enforces content size limits.
- Render service: resolves an org override when `organizationId` is present, validates it, interpolates allowed variables, and falls back to the system renderer when needed.
- Settings UI: provides the org-admin editing experience using `@react-email/editor`.

The existing email transport service remains responsible for choosing the system or organization email provider. Template customization only changes the subject/body passed into the transport.

## Data Model

Add `organization_email_template` with one row per organization and template key:

- `id`: UUID primary key
- `organizationId`: organization foreign key, cascade delete
- `templateKey`: known system template key
- `subject`: customized subject with allowed `{{variableName}}` placeholders
- `editorDocument`: JSON document saved by `@react-email/editor`
- `html`: rendered/editor HTML output used for runtime interpolation
- `plainText`: optional plain-text output, if the editor exposes it cleanly
- `isEnabled`: whether the override participates in runtime rendering
- `createdByUserId`: admin who created the override
- `updatedByUserId`: admin who last updated it
- `createdAt`, `updatedAt`

Indexes and constraints:

- Unique index on `organizationId + templateKey`
- Index on `organizationId`
- Optional index on `isEnabled` if query patterns justify it later

The table stores no secrets. It stores admin-authored content and must be treated as user input.

## Template Registry

The registry is the contract between system renderers, runtime template data, and the admin UI.

Each entry includes:

- `key`: stable template key, such as `absence-request-approved`
- `category`: Auth, Absences, Time Corrections, Teams, Security, or Exports
- `label` and `description`
- `defaultSubject`
- `variables`: fixed allowlist with name, label, description, and example value
- `previewData`: safe sample data for editor previews
- `renderDefault`: existing React Email renderer for fallback

Variables are system-defined only. Admins cannot add variables in the first version. This keeps outbound emails predictable and prevents accidental exposure of tenant or employee data that the template was not meant to receive.

## Admin UI

Add an `Email Templates` settings entry for organization admins. The entry should be visible only to the `orgAdmin` access tier and hidden from managers and members.

The settings page includes:

- Header explaining organization scope and fallback behavior
- Template list grouped by category
- Status badges for Default, Customized, Disabled, and Validation issue
- Last updated metadata where available
- Quick actions for Edit, Preview, Test send, Disable, and Reset

The editor view includes:

- Embedded `@react-email/editor` as the primary body editor
- Subject editor beside the visual editor
- Variable palette for the selected template
- One-click variable insertion as `{{variableName}}` into the focused subject/body field when supported by the editor integration
- Live validation summary
- Preview with registry sample data
- Test send to the current admin's own email
- Save, Reset to default, and Enable/disable controls

The UI should follow existing settings page patterns, use restrained product-first styling, and avoid making the editor feel like a separate third-party app. The editor integration should be wrapped in a local component so future API changes in `@react-email/editor` are isolated.

## Rendering Flow

Outbound email rendering follows this sequence:

1. Caller requests a known template key with typed template data and optional `organizationId`.
2. Render service checks the registry for the key.
3. If no `organizationId` is present, render the system default.
4. If `organizationId` is present, load the enabled override for that organization and template key.
5. If no override exists or it is disabled, render the system default.
6. Validate the stored subject/body placeholders against the registry allowlist.
7. If validation fails, log the organization id and template key, then render the system default.
8. Interpolate variables into the customized subject/body using escaped string values from the system-provided template data.
9. Pass the final subject and HTML to the existing email transport service.

Runtime failures in custom templates must not prevent critical emails such as password reset, verification, invitations, or security alerts. Fallback is mandatory.

## Validation And Security

Authorization:

- Only organization admins can read, create, update, disable, reset, or test custom templates.
- Every query and mutation must filter by the active `organizationId`.
- Server actions must re-check organization membership and role; the client cannot be trusted.

Input validation:

- Validate subject length and non-empty content.
- Validate editor document shape before saving.
- Validate rendered HTML size to prevent oversized emails.
- Extract placeholders from subject and body and reject unknown names.
- Reject malformed placeholder syntax instead of trying to guess intent.

XSS and content safety:

- Treat editor output as user input.
- Sanitize or constrain the saved/rendered HTML before storage and before runtime send.
- Interpolate variable values as escaped strings.
- Do not allow custom scripts, event handlers, arbitrary iframes, or executable content.
- Do not execute custom React, JavaScript, or server-side code supplied by admins.

Sensitive data:

- The registry exposes only variables already required by each system template.
- Auth templates remain customizable, but their variables stay limited to existing safe values such as verification/reset/invitation URLs and recipient names.
- Logs should include template key and organization id, not rendered email bodies or sensitive URLs.

## Error Handling

Save-time errors:

- Unknown variable
- Empty subject or body
- Malformed editor document
- Oversized generated HTML
- Missing `orgAdmin` authorization

Test-send errors:

- Show clear validation errors before sending.
- Show provider failures generically in the UI while logging safe diagnostic metadata server-side.
- Send tests only to the current admin's own email in the first version.

Runtime errors:

- Never block email delivery because of a bad custom override.
- Log a warning with organization id and template key.
- Fall back to the system default renderer.

## Testing Plan

Add tests for:

- Registry completeness: all current system templates are registered with default subjects, allowed variables, preview data, and renderers.
- Placeholder validation: allowed variables pass; unknown or malformed variables fail.
- Tenant isolation: org admins can manage only templates for their active organization.
- Access control: managers and members cannot access template actions.
- Fallback rendering: missing, disabled, or invalid overrides render the system default.
- Custom rendering: enabled valid overrides interpolate subject and body correctly.
- Settings visibility: `Email Templates` appears for org admins and is hidden from lower tiers.
- UI behavior: template list status, variable palette, validation messages, save, reset, and test-send affordances.
- Email sender integration: auth, absence, time-correction, team, security, and export emails route through the override-aware renderer.

## Implementation Notes

- Keep the first implementation minimal but complete: one override per template per organization, no version history.
- Prefer a wrapper component around `@react-email/editor` to isolate its API and make tests easier.
- Migrate rendering call sites toward a single typed template-rendering entry point instead of expanding switch statements in multiple places.
- Use existing Drizzle schema patterns and settings action patterns.
- Use existing translation namespace conventions for settings copy.
- Do not require new environment variables.

## Open Decisions Resolved

- All current system templates are customizable.
- Template overrides are scoped by organization.
- System templates remain the fallback.
- Admins can customize subject and body.
- Variables are system-defined per template only.
- Visual companion is not used for this design process.

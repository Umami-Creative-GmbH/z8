# Invited Employee Drafts Design

## Summary

Admins and owners need to prepare employee details for invited users before those users complete registration. `/settings/employees` will include invited users as draft rows for every invitation status, and the existing employee detail experience will support editing those drafts while hiding sections that require a real employee record.

The design keeps Better Auth invitation acceptance as the source of truth for registration and organization membership. App-specific employee preparation data is stored separately and applied during employee provisioning after invitation acceptance.

## Goals

- Show invited users in `/settings/employees` as `Draft` rows, regardless of invitation status.
- Let organization admins and owners edit employee details before registration, including role, team, manager-relevant role choice, contract type, position, employee number, start/end dates, and personal profile fields.
- Reuse the current employee detail route and edit form where practical.
- Preserve the existing Better Auth invitation flow, onboarding flow, and billing seat sync.
- Keep all data organization-scoped and permission-checked.

## Non-Goals

- Do not create placeholder Better Auth users for invitees.
- Do not create real `employee` rows before an invitee becomes an organization member.
- Do not make managers see or edit invitation drafts.
- Do not redesign the organization invitation management page.
- Do not add draft support to sections that need a real employee ID, such as skills, custom roles, manager assignments, employment history, work-balance recalculation, or rate history.

## Data Model

Add an app-owned `employee_invitation_draft` table under the webapp schema. It is keyed to the Better Auth invitation but stores employee-specific preparation fields outside the generated auth schema.

Fields:

- `id` UUID primary key.
- `invitationId` text, unique, referencing Better Auth `invitation.id` with cascade delete.
- `organizationId` text, indexed, referencing `organization.id` with cascade delete.
- `teamId` UUID nullable, referencing `team.id` with set-null on delete.
- `role` using the existing employee role enum, default `employee`.
- `firstName`, `lastName`, `position`, `employeeNumber`, `pronouns` as nullable text fields.
- `gender` using the existing gender enum, nullable.
- `birthday`, `startDate`, `endDate` as nullable timestamps.
- `contractType` using the existing contract type enum, default `fixed`.
- `currentHourlyRate` decimal nullable, matching the employee table precision.
- `createdAt`, `updatedAt`, and `updatedBy` metadata.

The draft does not duplicate invitation email or invitation status. Those remain on the Better Auth `invitation` row and are joined when rendering list/detail views.

## Invitation Creation

When `sendInvitation` successfully creates a Better Auth invitation, create or upsert the matching `employee_invitation_draft` row.

Initial values:

- `invitationId` and `organizationId` from the created invitation.
- `teamId` from the invitation `targetTeamId`.
- `role` from the selected employee/system role where available; otherwise `employee`.
- `contractType` as `fixed`.
- metadata from the acting user.

If draft creation fails after the invitation is created, the action should return an error and log enough context to repair, but it must not directly mutate generated auth schema. During implementation, prefer making invitation creation and draft creation part of one database transaction if the existing Better Auth call path supports it safely; otherwise add an idempotent recovery path in the employee list query or a targeted helper.

## Employee List

`/settings/employees` will return a discriminated union:

- `kind: "employee"` for real employees.
- `kind: "invitationDraft"` for invitation drafts.

Real employees keep current behavior.

Draft rows are built by joining `employee_invitation_draft` to Better Auth `invitation` and optional `team`. They are included for all invitation statuses, including pending, accepted, canceled, and expired.

Draft display rules:

- Employee name uses draft `firstName` and `lastName` when present.
- If no draft name is set, use invitation email as the primary display label.
- Email always comes from the invitation.
- Role, team, position, employee number, and contract type come from the draft.
- Employee status displays as `Draft` for all invitation draft rows.
- Invitation status may be shown as secondary context, such as a small badge or muted text, so admins can distinguish pending, accepted, canceled, and expired invitations without changing the requested `Draft` status.

Filtering and searching:

- Search should match draft name fields, invitation email, and draft position.
- Role and team filters should apply to draft values.
- Existing active/inactive status filters should not accidentally hide all drafts. A practical implementation can treat drafts as their own status value and include drafts when the status filter is `all`; if adding a visible `Draft` filter is small and consistent with the UI, include it.

Managers continue to receive only real managed employees. Draft rows are only returned for `orgAdmin` access.

## Detail Route And Editing

The existing `/settings/employees/[employeeId]` route will support both real employee IDs and draft IDs. The implementation should choose a route-safe draft identifier strategy, such as a prefixed identifier (`draft:<id>`) or a lookup fallback where a missing employee ID is checked against `employee_invitation_draft.id`.

The detail data shape is discriminated:

- `kind: "employee"` uses the current `EmployeeWithRelations` path.
- `kind: "invitationDraft"` exposes draft fields plus invitation email/status.

The existing `EmployeeEditFormCard` should be reused for drafts where possible. Draft save actions update `employee_invitation_draft`, not `employee`, `user`, or `member`. If the invitation has already produced a real employee, the draft detail page remains visible as a historical invitation draft but should direct admins to edit the real employee record for current employee details.

Sections hidden for drafts:

- Manager assignment.
- Custom roles.
- Skills.
- Employment history.
- Work-balance recalculation.
- Rate history.

The overview/header should clearly label draft records and show invitation email/status. Draft detail pages should not render actions that require a real employee ID.

## Applying Drafts On Invitation Acceptance

Extend employee provisioning so `afterAcceptInvitation` passes the invitation ID to `ensureEmployeeForOrganizationMember`.

Provisioning behavior:

- Look up the draft by `organizationId` and `invitationId`.
- Validate the draft belongs to the same organization.
- Resolve `teamId` only if the team still belongs to the same organization; otherwise ignore it.
- When creating a new employee, apply draft employee fields.
- When reactivating an inactive employee, apply draft fields where safe, including team, role, contract type, and profile/job fields.
- If no draft exists, keep current provisioning behavior unchanged.
- Keep billing seat sync and member creation behavior unchanged.

After acceptance, the accepted invitation draft remains visible because invited users should appear for all invitation statuses and display as `Draft`. If a real employee exists for the accepted invitation, the draft row stays separate from the employee row, shows the invitation status, and links or directs admins to the real employee record for current employee edits. Draft edits after acceptance must not silently diverge from the real employee.

## Permissions And Scoping

All draft queries and mutations must filter by `organizationId`.

Only `orgAdmin` access tier can list, read, or mutate draft records. This maps to owners/admins in the existing settings access model. Managers do not see draft invited users because manager scoping depends on real employee-manager relationships.

Draft updates must validate:

- The invitation exists and belongs to the active organization.
- The draft exists and belongs to the active organization.
- The selected `teamId`, if present, belongs to the active organization.
- The actor has org admin settings access.

## Error Handling

- Missing draft or invitation returns the same user-facing not-found behavior as missing employees.
- Invalid team selection returns a validation error on `teamId`.
- Failed draft save shows the existing employee update error pattern.
- Invitation acceptance should not fail only because no draft exists.
- If a draft references a deleted team, provisioning ignores that team and continues.

## Testing

Add tests around these behaviors:

- Invitation creation creates an employee invitation draft with organization-scoped defaults.
- Draft list rows appear for pending, accepted, canceled, and expired invitations as `Draft`.
- Org admins can read and update draft details.
- Managers cannot list or edit draft rows.
- Draft update rejects teams outside the organization.
- Invitation acceptance applies draft fields to the created employee.
- Invitation acceptance without a draft keeps current provisioning behavior.
- The draft detail page hides sections requiring real employee IDs.

## Implementation Notes

- Do not edit `apps/webapp/src/db/auth-schema.ts` manually.
- Add the schema in `apps/webapp/src/db/schema/` and an explicit Drizzle migration.
- Keep the current `ensureEmployeeProfilesForOrganizationMembers` reconciliation limited to approved members; draft invitations should not be converted into employees there.
- Prefer small changes to existing employee query/action files by adding draft-specific helpers where it keeps real employee behavior clear.

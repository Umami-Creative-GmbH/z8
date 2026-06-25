# Employees Invite And Member Tabs Design

## Summary

Move all member and invite management currently shown in `/settings/organizations` into `/settings/employees`. The Employees settings page becomes the people-management hub: the current employee directory remains the default experience, and organization admins get additional tabs for accepted members, direct invitations, and invite codes.

This is a UI and page-composition move. Better Auth remains the source of truth for organization members and invitations, existing invite-code behavior stays intact, and all data access remains scoped to the active `organizationId`.

## Goals

- Keep the current employee list as the first/default view in `/settings/employees`.
- Move direct member invites, pending invitations, pending members, accepted member management, target-team editing, and invite codes from `/settings/organizations` to `/settings/employees`.
- Keep `/settings/organizations` focused on organization identity and configuration.
- Preserve current permissions, server actions, data ownership, and invite acceptance behavior.
- Keep managers limited to their current scoped employee management surface.

## Non-Goals

- Do not redesign the employee table or merge employees, members, invitations, and invite codes into one unified table.
- Do not change Better Auth member or invitation schema.
- Do not change invite-code data shape or acceptance behavior.
- Do not broaden manager access to member or invitation administration.
- Do not move generated auth schema files manually.

## Current State

`/settings/organizations` currently loads organization details, current member role, accepted members, pending invitations, organization notification language, and target-team data for invitations. `OrganizationTab` renders organization details/configuration plus `InviteCodeManagement`, `PendingMembersCard`, `MembersTable`, and `InviteMemberDialog`.

`/settings/employees` currently renders `EmployeesPageClient` for managers and organization admins. Previous invited-employee draft work already made invited users part of the employee directory concept, but the actual invitation and member administration controls still live under organization settings.

## Proposed Approach

Use a tabbed people-management surface in `/settings/employees`.

The default tab is `Employees` and keeps the existing employee directory behavior. Organization admins and owners see additional tabs:

- `Members`: accepted organization members, role management, removal, and employee activation/suspension actions through the existing member table behavior.
- `Invitations`: direct email invitation flow, pending invitations, resend/cancel behavior, and target-team editing.
- `Invite Codes`: reusable invite-code management moved from organization settings.

Managers continue to see only the current employee list and scoped employee data. They do not see the tabbed member/invite management surface.

`/settings/organizations` keeps only organization-level cards: create organization when allowed, organization details, features, timezone, language, and danger zone. Its title can remain `Organization`, but its description should change from member/invite wording to organization configuration wording.

## Data And Actions

The data model does not change.

- Better Auth `member` remains the source of truth for accepted organization members.
- Better Auth `invitation` remains the source of truth for direct email invitations.
- Existing invite-code tables and actions continue to own invite-code behavior.
- `employee_invitation_draft` continues to support invited users inside the employee directory.

The first implementation should prefer moving page composition over moving server action ownership. Existing actions may remain in `settings/organizations/actions.ts` if moving them would create unnecessary churn. If action files are renamed or moved later, behavior and tests must remain unchanged.

`/settings/employees/page.tsx` should load the current employee page for managers and organization admins. For organization admins, it also loads the data needed by the moved member and invite tabs:

- active organization members joined to users and employee rows
- pending direct invitations
- target teams for invitation display/editing
- current member role
- current user ID
- invite-code data if required by the existing invite-code component

Every query and mutation must continue to filter by the active `organizationId`. Client-provided organization IDs, member IDs, invitation IDs, team IDs, and invite-code IDs must be validated against the active organization before reads or writes.

## Access Rules

The existing settings access model stays in place.

- Members cannot access `/settings/employees`.
- Managers can access `/settings/employees` but only see the existing scoped employee directory and employee management controls.
- Organization admins and owners can access all people-management tabs.
- Existing owner/admin distinctions are preserved. Owners keep member role and removal powers where currently required. Admins keep invitation and employee activation/suspension powers where currently allowed.

The moved UI must not imply manager access to organization-wide member or invite administration.

## UI Behavior

For managers, `/settings/employees` should look and behave as it does today.

For organization admins and owners, `/settings/employees` becomes a tabbed page. The page header should still identify the section as Employees or People Management. A practical copy update is: "Manage employees, members, and invites."

Tabs:

- `Employees`: current employee directory, filters, status handling, and employee create/detail flows.
- `Members`: accepted workspace members and their access.
- `Invitations`: direct invitations and pending access.
- `Invite Codes`: reusable invite links for onboarding.

Primary actions should remain contextual:

- Employee creation stays with the `Employees` tab.
- `Invite Member` appears with the `Invitations` tab.
- Invite-code creation stays inside the invite-code management tab using the existing component behavior.

`/settings/organizations` should remove the member and invite cards completely:

- no `Members & Invitations` card
- no `InviteMemberDialog`
- no `InviteCodeManagement`
- no `PendingMembersCard`

The organization page description should no longer mention members or invitations.

## Component Boundaries

Prefer small, reversible moves.

The current organization components can be reused from the employees page during the first implementation. If names become misleading, move or rename them only when it reduces confusion without causing broad import churn. A good boundary is a dedicated employees-page people tabs component that composes existing pieces and keeps `/settings/employees/page.tsx` readable.

The organization page should pass only organization-configuration props to its client component after the move.

## Error Handling

Existing error behavior should be preserved.

- Failed invitation creation, cancellation, resend, or target-team updates show the current toast/error patterns.
- Failed member role updates or removals show the current member table errors.
- Missing organization context redirects to `/settings` as today.
- Missing or unauthorized member/invitation/invite-code records should fail as not found or unauthorized without leaking cross-organization data.

## Testing

Update or add targeted tests for the route split and role-aware UI.

Settings tests:

- `organizations` description no longer mentions members or invitations.
- `employees` remains visible to managers and organization admins.

Organization page tests:

- member and invitation components are no longer rendered or loaded there.
- organization details/configuration still render for organization admins.

Employee page tests:

- managers see the existing employee list only.
- organization admins see the tabbed people-management surface.
- `Members`, `Invitations`, and `Invite Codes` tabs render the moved controls.

Existing action tests should continue to pass because server behavior does not change. Run targeted tests around settings config, route access, organization actions, employee page components, and invite/member components.

## Rollout Notes

No database migration is required. This can ship as a focused UI/page-composition change. Existing links to `/settings/organizations` still work for organization configuration, while users manage employees, members, and invites from `/settings/employees`.

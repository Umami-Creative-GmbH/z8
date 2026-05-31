# Invite Target Teams Design

## Context

Z8 has two invite paths:

- Direct email invitations, created through Better Auth organization invitations.
- Invite codes, managed by Z8 app tables and services.

Invite codes already support `defaultTeamId`, which can be used as a team assignment default. Direct email invitations do not have an equivalent field today. The goal is to make target team assignment consistent across both invite paths without expanding the first iteration into broader onboarding policy management.

## Goals

- Let admins and owners set an optional target team on direct email invitations.
- Present invite-code `defaultTeamId` as the same product concept: target team.
- Apply target team assignment automatically when it is safe, and prefill it when approval is required.
- Keep all team validation organization-scoped.
- Preserve successful signup if the target team is removed before the invite is accepted.

## Non-Goals

- Default position, employment type, location, manager, or policy assignment.
- Welcome messages or onboarding checklists.
- Bulk invite CSV import.
- A generalized invite policy abstraction.
- Renaming the invite-code database column from `defaultTeamId`.

## Recommended Approach

Use a unified target-team intent across direct email invites and invite codes, but keep storage aligned with each existing mechanism.

Direct email invitations get a persisted optional `targetTeamId` field on the Better Auth invitation table. Invite codes keep using `defaultTeamId` internally, while UI copy, actions, and user-facing labels call it “Target team”. This avoids a disruptive migration for invite codes and keeps the first implementation focused.

## Data Model

Direct email invitations need a nullable `targetTeamId` field. Because the invitation table is generated through Better Auth, this field must be added through `apps/webapp/src/lib/auth.ts` Better Auth configuration and regenerated through the project’s auth schema workflow. `apps/webapp/src/db/auth-schema.ts` must not be edited manually.

`targetTeamId` is a logical organization-scoped reference to a team. Server-side writes must verify that the selected team belongs to the invite’s `organizationId`. If no team is selected, the field is null.

Invite codes keep the existing `defaultTeamId` database column. The app should describe it as target team in the admin UI and implementation plan, while leaving persistence unchanged.

## Permissions

The same organization admins and owners who can create, resend, cancel, or manage invites can set or clear target teams. Server actions must not trust team IDs from the client.

Every write path must verify:

- The actor is a member of the organization.
- The actor is an admin or owner for invite management.
- The invite or invite code belongs to the organization being modified.
- The selected team belongs to that same organization, when a team is selected.

## Direct Email Invite Workflow

The direct invite panel adds a “Target team” select below the role field. It loads organization teams through the existing team listing action, includes a “No team” option, and explains that the new employee will join this team after accepting the invitation.

Because the invite dialog is being modified, it should be migrated from local `useState` form state to `@tanstack/react-form` in the implementation.

Pending invitations should show the selected target team as a column or compact badge. Pending direct email invitations are editable while pending for target team only. This keeps the first iteration small and avoids a broader edit-invite feature for email, role, or organization-creation permission. Resending an invitation should preserve the current target team.

## Invite Code Workflow

Invite-code management keeps its existing team selector but labels it “Target team”.

For invite codes that require approval, the approval flow preselects the invite code’s target team and lets the approver override or clear it before approving. The selected approval team remains recorded as `assignedTeamId` on the approval.

For invite codes that do not require approval, target team assignment applies during redemption when the employee profile is provisioned, after validating that the team still belongs to the organization.

## Provisioning Behavior

For direct email invitations, the Better Auth `afterAcceptInvitation` hook should load the full invitation record, read `targetTeamId`, validate that the team still belongs to the invitation organization, and pass the valid team ID into employee provisioning.

If the target team no longer exists or no longer belongs to the organization, invitation acceptance should still succeed and the employee should be provisioned with no team assignment.

If an employee profile already exists, target team assignment should be conservative. The provisioning path should set the target team for a newly created employee, or for an inactive/reactivated employee that has no current team. It should not unexpectedly move an existing active employee to a different team because of a stale or replayed invite flow.

For invite-code approvals, the existing approval path already creates or updates the employee with `assignedTeamId`. The implementation should ensure the approval UI/action defaults to the invite code target team unless the approver overrides it.

## Edge Cases

- No target team selected: invite acceptance or code redemption proceeds with no team assignment.
- Target team deleted before acceptance: acceptance proceeds with no team assignment.
- Target team from another organization: server-side validation rejects the create or update request.
- Pending invitation target team edited before acceptance: the most recent pending invite value is applied.
- Resent invitation: the target team from the pending invitation is preserved.
- Existing active employee: do not move them to a new team automatically.

## Testing

Server-side tests should cover:

- Direct invitation creation rejects a target team from another organization.
- Pending invitation target team updates require admin or owner permissions.
- Invitation acceptance applies a valid target team to newly provisioned employees.
- Deleted or invalid target teams fall back to no team without blocking acceptance.
- Resending a direct invitation preserves target team assignment.

Invite-code tests should cover:

- Approval flows prefill from the invite code target team.
- Approver overrides are respected.
- No-approval redemption applies the validated target team.
- Invalid invite-code target teams fall back safely instead of assigning cross-organization teams.

UI tests should stay focused:

- Direct invite dialog submits `targetTeamId`.
- Pending invitations display the target team badge or column.
- Invite-code UI uses “Target team” copy consistently.

## Rollout

This can ship as an additive feature. Existing invitations and invite codes have no target team by default. Existing invite codes with `defaultTeamId` keep their current behavior, but the admin experience becomes clearer and consistent with direct email invitations.

The implementation should run the focused organization invite, invite code, and team provisioning test subsets before broader verification.

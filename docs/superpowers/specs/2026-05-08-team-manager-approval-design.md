# Team Manager Approval Design

## Summary

Add true multi-team membership and optional primary managers per team, then use those team managers as approval fallback when an employee has no direct manager. Any one eligible manager can approve or reject a request.

## Context

- Employees currently have a single `employee.teamId` field.
- Direct manager assignments already use the `employee_managers` table and support multiple managers per employee.
- Teams currently do not expose a primary manager relationship.
- Approval requests are currently represented by one inbox-facing `approvalRequest.approverId`.
- Custom approval policies already support `direct_manager` and `manager_manager` stage resolution, but direct manager resolution currently picks one manager.
- Z8 is a multi-tenant SaaS application, so all new team membership and approval resolution logic must be organization-scoped.

## Goals

- Let managers manage employees and other managers through existing direct manager assignments.
- Let each team optionally define one primary manager.
- Allow employees to belong to multiple teams.
- If an employee has active direct managers, use those direct managers as eligible approvers.
- If an employee has no active direct managers, use the primary managers from all of the employee's teams as eligible approvers.
- Allow any one eligible manager to approve or reject a request.
- Keep current admin approval override behavior.
- Preserve existing no-manager fallback behavior when no direct or team manager resolves.

## Non-Goals

- No all-managers-must-approve workflow.
- No per-policy configuration for any-one versus all-manager approval.
- No requirement that every team has a primary manager.
- No replacement of the whole unified approvals system.
- No tenant-specific environment variable configuration.

## Approved Direction

Use a full model update: add true team memberships and optional team primary managers, migrate current `employee.teamId` values into memberships, and keep `employee.teamId` temporarily as a compatibility primary-team field for existing code paths.

Approval resolution uses a direct-manager-first rule. Direct managers take precedence. Team primary managers are used only when no active direct manager is assigned to the requester.

## Data Model

Add `team.primaryManagerId` as a nullable reference to `employee`.

Rules for `primaryManagerId`:

- The primary manager must belong to the same organization as the team.
- The primary manager must be active.
- The primary manager must have role `manager` or `admin`.
- A team may have no primary manager.

Constraints and indexes for `primaryManagerId`:

- Index `team_primaryManagerId_idx`.
- Composite foreign key from `(primaryManagerId, organizationId)` to `(employee.id, employee.organizationId)`.
- Runtime validation enforces active status and role because those attributes are not static foreign-key constraints.

Add `team_membership` with:

- `id`
- `organizationId`
- `teamId`
- `employeeId`
- `createdAt`
- `createdBy`, nullable so migration-created rows can be represented without inventing a user actor

Constraints and indexes:

- Unique `(teamId, employeeId)` to prevent duplicate memberships.
- Index `teamMembership_organizationId_idx`.
- Index `teamMembership_teamId_idx`.
- Index `teamMembership_employeeId_idx`.
- Composite foreign key from `(teamId, organizationId)` to `(team.id, team.organizationId)`.
- Composite foreign key from `(employeeId, organizationId)` to `(employee.id, employee.organizationId)`.

Keep `employee.teamId` as a compatibility primary-team field during this implementation. Existing code can continue reading it until later migrations move those callers to `team_membership`.

Compatibility update rules:

- When an employee with no `teamId` is added to a team, set `employee.teamId` to that team.
- When removing the membership matching `employee.teamId`, set `employee.teamId` to another remaining membership if one exists, otherwise set it to `null`.
- Adding an employee to an additional team must not remove them from existing teams.

## Approval Resolution

Approval eligibility resolves a set of eligible employee IDs.

Direct manager phase:

- Load active direct manager links from `employee_managers` for the requester.
- Keep only active managers in the same organization.
- Direct managers may be employees with role `manager` or `admin`; existing manager assignment validation should continue to prevent invalid assignments where applicable.
- If at least one active direct manager exists, return that direct-manager set and do not include team managers.

Team manager fallback phase:

- If no active direct manager exists, load all team memberships for the requester in the organization.
- Resolve each team's `primaryManagerId`.
- Keep only active primary managers in the same organization with role `manager` or `admin`.
- Dedupe managers that appear through multiple teams.
- Return the deduped team-manager set.

No eligible manager:

- If no direct manager or team primary manager resolves, preserve the existing request-type behavior.
- Existing no-manager auto-approval or validation errors should remain unchanged unless the request type already defines different behavior.

Any-one approval semantics:

- Any eligible manager can approve or reject.
- The first successful approve or reject action decides the request.
- Later actions against the same request should receive the existing already-decided conflict.

Custom approval policies:

- `direct_manager` stages should use the same direct-then-team fallback resolver.
- `manager_manager` stages should continue to resolve through the selected direct manager path. If a request only resolves through team fallback, `manager_manager` should fail with an actionable validation message unless a later design defines team-manager hierarchy semantics.

## Approval Inbox And Authorization

Keep `approvalRequest.approverId` as the display/default assignee. It should be the primary direct manager when one exists, otherwise a deterministic first eligible team manager.

Inbox queries should include:

- Requests directly assigned to the current employee through `approvalRequest.approverId`.
- Requests where the current employee is an active direct manager of the requester.
- Requests where the requester has no active direct manager and the current employee is the active primary manager of at least one of the requester's teams.

Approve and reject authorization should allow:

- The stored `approvalRequest.approverId`.
- Any currently eligible manager from the resolver.
- Existing CASL `manage Approval` admin override.

Authorization must stay organization-scoped. A manager from another organization must not see or action the request even if IDs are reused or stale relationships exist.

The design intentionally avoids creating duplicate `approvalRequest` rows for each eligible manager.

## Team Settings UI And Behavior

Team detail should add a primary manager control in the Team Information card.

Primary manager selector behavior:

- List active employees in the organization with role `manager` or `admin`.
- Allow clearing the primary manager.
- Show `No primary manager assigned` when unset.
- Validate on the server before saving.

Team member behavior:

- Adding a member creates a `team_membership` row.
- Adding a member to one team does not remove them from other teams.
- Removing a member deletes only that team's membership row.
- Team member lists and member counts read from `team_membership`.

The team settings UI should continue to use existing access controls. Managers can only manage teams within their scoped permissions; organization admins can manage all teams.

## Migration And Backfill

Add a migration/backfill that creates one `team_membership` row for each employee with an existing non-null `employee.teamId`.

Backfill behavior:

- Use the employee's `organizationId`.
- Use the existing `employee.teamId` as `teamId`.
- Use the employee `id` as `employeeId`.
- Set `createdBy` to `null` for backfilled rows.
- Avoid duplicate membership rows if rerun.
- Preserve `employee.teamId` after backfill.

No environment variables are required.

## Testing

Add schema coverage for:

- `team_membership` columns and indexes.
- Unique `(teamId, employeeId)` membership constraint.
- Organization-scoped team and employee foreign keys.
- Nullable `team.primaryManagerId`.

Add resolver tests for:

- Direct managers taking precedence over team managers.
- Team primary manager fallback when no direct manager exists.
- Multiple team memberships allowing any listed team manager.
- Dedupe when multiple teams share the same primary manager.
- Inactive team managers being ignored.
- Non-manager and non-admin team primary managers being rejected or ignored according to validation path.
- No eligible manager preserving existing fallback behavior.

Add inbox and action tests for:

- A fallback team manager can see a pending approval even when not stored in `approvalRequest.approverId`.
- A fallback team manager can approve or reject the request.
- Direct managers suppress team-manager fallback visibility.
- Admin approval override continues to work.
- Cross-organization relationships do not grant visibility or action rights.

Add team settings action tests for:

- Adding a team membership without removing existing memberships.
- Removing only the selected team membership.
- Updating `employee.teamId` compatibility behavior when needed.
- Setting and clearing a valid primary manager.
- Rejecting inactive, cross-organization, employee-role, or missing primary manager assignments.

Verification should run targeted tests first, then broader `pnpm test` if feasible.

## Risks

- Many existing features still read `employee.teamId`. Keeping it as a compatibility field reduces immediate breakage but leaves follow-up migration work.
- Inbox query complexity will increase because current eligibility can differ from the stored `approvalRequest.approverId`.
- Approval policy `manager_manager` semantics remain direct-manager-oriented and should not infer hierarchy from team fallback in this iteration.

## Rollout Notes

- Ship schema, backfill, resolver, and settings updates together so team fallback can work immediately.
- Keep existing direct manager assignments as the primary approval control.
- After this change is stable, audit remaining `employee.teamId` callers and migrate them to multi-team membership where the product needs multi-team semantics.

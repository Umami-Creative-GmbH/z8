# Custom Approval Policy Builder Design

## Summary

Add an organization-scoped approval policy builder that lets admins define sequential approval chains for absences, travel expenses, overtime-risk workflows, and employee cohorts. The builder should give larger organizations configurable controls without replacing the existing unified approvals inbox or domain-owned approval side effects.

## Context

- Z8 already has a unified approval layer with `approvalRequest`, approval type handlers, a shared inbox query service, bulk action handling, and domain-owned approval behavior.
- Existing approval domains include absence requests, time corrections or overtime-sensitive time workflows, and travel expense claims.
- The current model is effectively single-current-approver. Larger organizations need configurable routing by operational attributes before they trust approval-heavy workflows.
- Z8 is a multi-tenant SaaS application, so all policy data, policy evaluation, and chain progression must be scoped by `organizationId`.

## Goals

- Let organization admins define active approval policies ordered by priority.
- Support sequential approval chains as the first policy output model.
- Match policies by approval source, team, location, absence category, travel expense amount, overtime risk, and employee group.
- Introduce configurable organization-scoped employee groups with employee membership.
- Preserve the existing unified approvals inbox and domain-specific approve/reject side effects.
- Fall back to existing default approver behavior when no custom policy matches.
- Provide an admin preview tool that explains which policy would match and which approvers would be resolved.

## Non-Goals

- No parallel approval stages in the first version.
- No mixed sequential and parallel chains.
- No merging of multiple matching policies into one combined chain.
- No full workflow-engine rewrite of existing approval handlers.
- No tenant-specific environment variables for policy configuration.
- No cross-organization policy matching, approver resolution, or reporting.

## Approved Direction

Use a policy resolver that feeds the existing approval system.

Source domains will build a normalized approval context when a request is submitted. The policy resolver picks the first active matching policy by organization-local priority. If a policy matches, it creates a chain instance and only emits an `approvalRequest` for the current stage. The existing inbox and approval action flow continue to operate on `approvalRequest`, while chain progression creates the next stage request after each successful stage approval.

This approach avoids rewriting the unified inbox or domain handlers while adding enough runtime state to support sequential chains.

## Data Model

Add policy and chain tables beside the existing approval schema.

### Policy Configuration

`approval_policy` stores organization-scoped policy metadata:

- `id`
- `organizationId`
- `name`
- `description`
- `isActive`
- `priority`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`

`approval_policy_condition` stores one condition per row:

- `id`
- `organizationId`
- `policyId`
- `conditionType`
- `operator`
- typed value columns or a validated JSON payload for condition-specific values
- timestamps

Supported condition types for the first version:

- `approval_type`
- `team`
- `location`
- `absence_category`
- `travel_expense_amount`
- `overtime_risk`
- `employee_group`

`approval_policy_stage` stores ordered sequential stages:

- `id`
- `organizationId`
- `policyId`
- `stepOrder`
- `label`
- `approverType`
- `approverEmployeeId` when `approverType` is a specific employee
- `fallbackBehavior`
- timestamps

Initial approver types:

- `direct_manager`
- `manager_manager`
- `org_admin`
- `specific_employee`

`employee_group` stores configurable group metadata:

- `id`
- `organizationId`
- `name`
- `description`
- `isActive`
- timestamps

`employee_group_member` stores group membership:

- `id`
- `organizationId`
- `groupId`
- `employeeId`
- `createdBy`
- `createdAt`

### Runtime Chain State

`approval_chain_instance` stores one runtime chain per matched source request:

- `id`
- `organizationId`
- `policyId`
- `policyNameSnapshot`
- `entityType`
- `entityId`
- `requesterEmployeeId`
- `currentStageOrder`
- `status`
- `createdAt`
- `updatedAt`
- `completedAt`

`approval_chain_stage_instance` stores resolved stage state:

- `id`
- `organizationId`
- `chainInstanceId`
- `policyStageId`
- `stepOrder`
- `labelSnapshot`
- `approverTypeSnapshot`
- `resolvedApproverEmployeeId`
- `approvalRequestId`
- `status`
- `decidedBy`
- `decidedAt`
- timestamps

The existing `approvalRequest` table remains the inbox-facing work item. The first implementation should not add chain columns to `approvalRequest`; `approval_chain_stage_instance.approvalRequestId` links runtime chain state to the inbox item. This keeps current approval inbox queries compatible while giving chain progression a stable lookup from stage state to request state.

## Policy Evaluation

Each source domain builds an `ApprovalPolicyContext` before creating approval work:

- `organizationId`
- `approvalType`
- `requesterEmployeeId`
- `teamId`
- `locationId`
- `absenceCategoryId`
- `travelExpenseAmount`
- `overtimeRisk`
- `employeeGroupIds`
- `entityType`
- `entityId`

The resolver loads active policies for the organization in ascending priority order. A policy matches when all of its conditions match the context. The first matching active policy wins.

If no active policy matches, the source domain uses the existing default approval behavior. This fallback is required so organizations can adopt custom policies incrementally.

## Approver Resolution

When a policy matches, the resolver creates a chain instance and resolves stage approvers inside the same organization.

Resolution rules:

- `direct_manager` resolves from existing employee-manager data.
- `manager_manager` resolves from the direct manager's manager relationship.
- `org_admin` resolves to a valid organization admin employee according to the existing role model.
- `specific_employee` resolves only if the selected employee belongs to the same organization and is active.
- `team_lead` is not selectable in the first implementation because the currently reviewed organization schema exposes teams and managers but not a reliable team lead relationship. It can be added later as another `approverType` once that relationship exists.

If an active policy stage cannot resolve an approver, request creation fails with an actionable validation error rather than silently bypassing that stage. Admin preview should surface the same failure before the policy is used.

## Chain Progression

Only one stage is pending at a time.

Submission flow:

1. Source domain creates the source request.
2. Source domain builds the approval policy context.
3. Resolver selects the first active matching policy by priority.
4. Resolver creates an `approval_chain_instance` and stage instances.
5. Resolver creates one pending `approvalRequest` for the first stage.
6. The unified inbox lists that request through existing approval handlers.

Approval flow:

1. Current stage approval goes through the existing approval action path.
2. Chain state marks the stage approved.
3. If another stage exists, the resolver creates the next stage's pending `approvalRequest`.
4. If no stages remain, the chain is marked approved and the source domain final approval side effects run.

Rejection flow:

1. Rejection at any stage goes through the existing approval action path.
2. Chain state marks the current stage and chain rejected.
3. The source domain rejection behavior runs with the rejection reason.
4. No further stage requests are created.

Stale-state handling must be conflict-safe. If the stage request is no longer pending, chain progression must not create duplicate next-stage requests.

## Admin UI

Add an approval policies settings page under the administration or enterprise settings area. Follow the existing travel expense policy management pattern: list page, create/edit action panel, TanStack Form, organization-scoped server actions, and active/inactive status display.

Policy builder sections:

- Basic details: name, description, active flag, priority.
- Matching conditions: approval types and optional filters for team, location, absence category, travel expense amount threshold/range, overtime risk, and employee groups.
- Sequential chain: ordered stages with approver type and optional specific employee.
- Preview/test: choose a sample request context and show the matched policy, matched conditions, unresolved conditions, and resolved approver chain.

Validation rules:

- Active policies require at least one stage.
- Policy priority ordering must be deterministic within an organization.
- Specific approvers must be active employees in the same organization.
- Condition references must belong to the same organization.
- Amount and overtime-risk conditions must use valid operator/value combinations.
- A policy cannot be activated if any stage is structurally invalid: unsupported approver type, inactive or cross-organization specific employee, missing stages, or invalid fallback behavior. Dynamic role resolution failures, such as a requester without a direct manager, are handled at request creation and shown in preview for the selected sample context.

## Permissions

- Only organization admins, or the existing role used for administration settings, can manage policies and employee groups.
- Server actions must enforce organization-scoped reads and writes.
- Policy evaluation must never resolve approvers outside the active organization.
- Chain action permissions continue to use the existing approval handlers and `approvalRequest` checks.
- Bulk actions must remain per-item permission checked because mixed approval queues can contain different chain stages and source domains.

## Audit And Traceability

Audit records should cover configuration and runtime events.

Configuration events:

- policy created
- policy updated
- policy activated or deactivated
- policy priority changed
- employee group created or updated
- employee group membership changed

Runtime events:

- policy matched
- no policy matched and fallback used
- chain created
- stage request created
- stage approved
- stage rejected
- chain approved
- chain rejected
- approver resolution failed

Runtime audit records must include organization scope, policy id, chain id, stage id when available, source entity type/id, actor, previous status, new status, and timestamp. Existing domain-specific audit records remain in place for final approve/reject side effects.

## Error Handling

- Missing policy references return validation errors in the admin UI.
- Unresolvable active stage approvers block request creation and explain which stage failed.
- Cross-organization references are treated as forbidden or not found and must never be resolved.
- Stale stage approvals return conflict errors and do not create further approval requests.
- If no policy matches, the system falls back to current default manager/admin approval behavior.

## Testing

Unit tests:

- policy matching across all first-version condition types
- condition operator validation
- priority ordering and first-match-wins behavior
- employee group membership matching
- approver resolution for direct manager, manager's manager, org admin, and specific employee
- unresolvable approver failures
- sequential chain progression
- rejection at any stage
- no-policy fallback behavior

Server action tests:

- policy and group CRUD permission failures
- organization scoping for all policy references
- activation validation failures
- preview output for matched and unmatched policies

UI tests:

- create and edit policy forms
- stage validation and reordering
- condition builder validation
- employee group membership management
- preview/test output

Regression tests:

- existing absence approvals still work when no policy matches
- existing travel expense approvals still work when no policy matches
- existing unified inbox queries continue to list current-stage approval requests
- stale approval requests do not create duplicate next-stage requests

## Open Implementation Notes

- The first implementation should keep `team_lead` unavailable until the organization model has a reliable team lead relationship.
- The first implementation should link chain stage instances to existing approval requests through `approval_chain_stage_instance.approvalRequestId`, not by widening `approvalRequest`.
- Overtime-risk context should reuse existing overtime/compliance calculations if present; otherwise the first implementation must introduce a small normalized risk classification before policy matching.

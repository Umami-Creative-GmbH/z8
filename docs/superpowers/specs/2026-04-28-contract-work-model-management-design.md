# Contract & Work Model Management Design

## Summary

Add employee-level contract and work-model history so Z8 can resolve expected hours, overtime, payroll, and compliance context from a reliable valid-from timeline.

The design makes employment history the source of truth for contract state over time, while syncing effective changes into employee-level work policy assignments so existing scheduling views continue to work.

## Context

Z8 already has basic employee fields such as `contractType`, `startDate`, `endDate`, `isActive`, and `currentHourlyRate`. It also has hourly rate history and work policies with organization, team, and employee assignments.

The current model does not represent a complete employee contract timeline. It cannot reliably answer which weekly hours, work model, probation window, employment status, or work policy applied on a specific date. That weakens expected-hours, overtime, payroll-readiness, payroll export, and compliance calculations.

## Goals

- Track strict non-overlapping contract and work-model history per employee.
- Support future scheduled employment changes with draft, pending, and confirmed review states.
- Restrict create/edit operations to org admins in V1.
- Sync confirmed work-policy changes into employee-level `work_policy_assignment` rows.
- Resolve calculations from the effective confirmed history row by date.
- Preserve existing employee and work-policy UI compatibility during rollout.
- Keep all reads and writes organization-scoped.

## Non-Goals

- No manager editing of contract/work-model history in V1.
- No approval workflow beyond storing draft, pending, and confirmed states.
- No employee self-service contract change requests.
- No new labor-law rule engine in V1.
- No replacement of team or organization default work-policy assignment behavior.
- No direct editing of the generated Better Auth schema.

## Approved Direction

Build an employee employment-history timeline as the source of truth for contract and work-model state. Confirmed history records affect date-based calculations. Confirmed records with a linked work policy also create or update employee-level work-policy assignments.

Existing employee fields remain as denormalized compatibility fields for current state and list/detail display.

## Approaches Considered

### 1. Employment timeline with synced work-policy assignments (selected)

Add a dedicated employment-history table and sync confirmed changes to employee-level work-policy assignments.

Pros:

- Gives payroll and compliance a clear employee-specific history.
- Keeps existing schedule UI compatible.
- Handles future changes cleanly.
- Separates employment facts from reusable work-policy definitions.

Cons:

- Requires careful transactional logic for timeline insertion and assignment sync.
- Requires loosening the current one-active-employee-assignment constraint.

### 2. Work-policy assignment first, with contract metadata

Extend the existing assignment flow to carry contract and work-model metadata.

Pros:

- Smaller schema surface.
- Reuses existing work-policy concepts.

Cons:

- Mixes legal/employment history with scheduling assignment.
- Weak representation for probation, employment status, and contract changes.
- Harder to use as a payroll/compliance source of truth.

### 3. Calculation-only employment timeline

Track employment history and resolve it in calculations without mutating work-policy assignments.

Pros:

- Cleanest domain separation.
- Fewer side effects.

Cons:

- Existing schedule UI can show stale assignment data.
- Does not satisfy the requirement that effective changes update work-policy assignments.

## Domain Model

Add an org-scoped `employee_employment_history` table. Each row belongs to one employee and one organization.

Core fields:

- `id`.
- `employeeId`.
- `organizationId`.
- `validFrom`.
- `validUntil`, nullable, exclusive, and system-maintained.
- `status`: active, inactive, terminated, or leave.
- `contractType`, using the existing fixed/hourly contract enum.
- `weeklyContractMinutes`.
- `probationStartsOn`, nullable.
- `probationEndsOn`, nullable.
- `workModel`: onsite, hybrid, remote, or flexible.
- `workPolicyId`, nullable.
- `hourlyRate`, nullable.
- `currency`, defaulting to EUR when an hourly rate is present.
- `changeReason`, nullable.
- `reviewState`: draft, pending, or confirmed.
- `createdBy`, `createdAt`, `updatedBy`, `updatedAt`.

Confirmed records are strict and non-overlapping per employee. Draft and pending records are visible but do not affect calculations or work-policy assignments.

Creating a confirmed row closes or adjusts neighboring confirmed rows so the employee has at most one confirmed employment record for any date. A future confirmed row is valid and represents a scheduled change. The effective interval is `[validFrom, validUntil)`, so a row with `validUntil` equal to the next row's `validFrom` does not overlap.

## Work-Policy Sync

When an org admin confirms an employment-history row with a `workPolicyId`, the system syncs employee-level work-policy assignments.

For current or past effective changes:

- Close or deactivate the previous employee-level assignment for that employee.
- Create a new employee-level assignment with `assignmentType = "employee"` and `priority = 2`.
- Set assignment `effectiveFrom` from the employment row.
- Set assignment `effectiveUntil` from the employment row when known.
- Leave team and organization default assignments untouched.

For future confirmed changes:

- Create a future employee-level assignment with the row's `effectiveFrom`.
- Keep existing current assignment effective until the future change starts.
- Ensure schedule resolution ignores the future assignment until its effective date.

The current `work_policy_assignment` schema allows only one active assignment per employee. V1 must change that constraint to allow multiple active, non-overlapping employee assignments over time. The application transaction enforces the no-overlap rule.

Schedule resolution must order matching assignments by the most recent `effectiveFrom`, not by arbitrary first match, so the correct current or future-relevant assignment wins.

If a confirmed employment row has no `workPolicyId`, it records contract/work-model state but does not create a new employee-level assignment. Team or organization default assignments can still apply.

## Application Flow

Add a `Contract & Work Model` card to the employee detail page.

Org admins can:

- View current confirmed contract/work-model state.
- View the next scheduled confirmed change.
- View draft and pending changes.
- View the full timeline ordered newest first.
- Add a change.
- Confirm a draft or pending change.
- Cancel a future confirmed, draft, or pending change that has not taken effect.

Managers and non-admins cannot create or edit employment history in V1. If they can access the employee detail page, they may see read-only current contract context where appropriate, but write actions are hidden and server-protected.

The add/edit flow uses TanStack Form and captures:

- Effective date.
- Review state.
- Contract type.
- Weekly contracted hours.
- Work model.
- Probation start and end.
- Work policy.
- Hourly rate for hourly contracts.
- Reason or note.

On submit, server actions validate organization scope, org-admin access, employee ownership, date consistency, probation range, work-policy ownership, and confirmed timeline overlap.

Confirming a change runs in one transaction:

- Adjust neighboring confirmed employment rows.
- Insert or update the target employment row.
- Update current denormalized employee fields if the row is effective now.
- Sync employee-level work-policy assignments when `workPolicyId` is present.
- Revalidate employee, schedule, payroll-readiness, and related query caches.

## Calculation Behavior

Calculations resolve employment state by employee and date range before deriving expected hours, overtime, payroll, and compliance context.

V1 behavior:

- Expected-hours logic uses the effective confirmed employment row and linked work policy for each date.
- Overtime compares actual minutes to expected minutes from the effective contract and work policy.
- Payroll export and payroll readiness can flag employees who lack a confirmed employment row for the selected period.
- Compliance can use probation, work model, and employment status as context, but V1 does not add new legal rules.
- Existing flows fall back to current employee fields and team/org work policies when no employment history exists.

This fallback keeps rollout incremental while allowing new calculations to prefer the employment-history source of truth.

## Error Handling

Expected errors should be explicit and stable:

- Missing employee: not found.
- Cross-organization employee access: access denied or not found.
- Non-admin write attempt: authorization error.
- Invalid probation range: validation error.
- Confirmed overlap after timeline adjustment is impossible: validation error.
- Work policy from another organization: validation or authorization error.
- Future confirmed change: allowed, not an error.

Server actions should return existing `ServerActionResult` shapes and avoid leaking cross-tenant resource details.

## Testing

Unit and behavior tests should cover:

- Creating a confirmed row closes the previous confirmed row and preserves no-overlap history.
- Future confirmed changes do not affect current calculations.
- Current and past confirmed changes sync employee-level work-policy assignments.
- Draft and pending changes do not affect calculations or assignments.
- Work policy sync leaves team and organization assignments untouched.
- Schedule resolution chooses the active employee assignment with the latest effective date.
- Org scope is enforced for all reads and writes.
- Non-admin write attempts fail server-side.
- Employee detail UI shows current and scheduled records.
- Employee detail UI hides write actions for non-org-admins.

## Open Implementation Notes

- The schema should live in the employee/organization domain or a new employment-history domain file, with relations added centrally in `schema/relations.ts` and exports added through `schema/index.ts`.
- Date handling should use Luxon in application logic, with Drizzle timestamp/date adapters kept consistent with existing project patterns.
- The generated auth schema must not be edited.
- Database migration/push requires environment variables and should be handled outside agent execution if Phase CLI secrets are unavailable.

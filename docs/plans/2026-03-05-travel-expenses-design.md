# Travel Expenses Design

## Objective

Add a first-class Travel Expenses module so employees can submit travel claims and managers can approve or reject them. The launch goal is a reliable end-to-end workflow for receipt, mileage, and per-diem claims with organization-safe access controls.

## Scope

V1 includes:

- New sidebar module at `/travel-expenses`.
- Claim types: `receipt`, `mileage`, `per_diem`.
- Single-step manager approval with admin fallback.
- Optional project linkage when `projectsEnabled` is enabled.
- Multi-currency claim submission.
- Policy-based per-diem and mileage calculation.
- Receipt attachment requirement for receipt-type claims.
- Claim status lifecycle and decision history.

V1 excludes:

- Reimbursement payout tracking (`paid` state, payment references, payout exports).
- Finance settlement workflows.
- Multi-step finance approval.

## Confirmed Product Decisions

- **Selected approach:** Dedicated Travel Expenses module.
- **Primary KPI:** End-to-end flow works from submission to manager decision.
- **Claim types:** Receipt + mileage + per diem.
- **Approval model:** Single-step manager approval.
- **Module placement:** New sidebar module.
- **Project tracking:** Optional when projects are enabled.
- **Currency model:** Multi-currency claims.
- **Payout in V1:** Approval only.
- **Evidence rule:** Receipt required for receipt claims.
- **Per-diem logic:** Policy-based auto-calculation.

## Approaches Considered

### A) Dedicated Travel Expenses Module (Selected)

Create a standalone module and domain model for travel claims, policies, and approvals.

Pros:

- Best fit for selected UX and workflow.
- Clear boundaries for future growth (payouts, exports).
- Handles travel-specific rules without overloading existing domains.

Cons:

- Highest initial implementation scope.

### B) Reuse Existing Generic Approval Flow Heavily

Minimize new domain entities and route most logic through current approval primitives.

Pros:

- Lower immediate development effort.

Cons:

- Weaker fit for travel-specific calculations and evidence rules.
- Higher long-term complexity in mixed-purpose approval logic.

### C) Embed Travel Expenses in Time Tracking

Treat travel claims as time-tracking extensions.

Pros:

- Fewer new navigation surfaces.

Cons:

- Conflicts with requested first-class module.
- Couples independent product domains.

## Architecture

- Add `/travel-expenses` as a first-class app area in sidebar navigation.
- Keep travel expenses as an independent bounded context, integrated with existing auth/session/org patterns.
- Introduce dedicated org-scoped schema file for travel-expense tables and relations.
- Keep approval lifecycle domain-native (`draft`, `submitted`, `approved`, `rejected`) with single-step manager decision.
- Resolve approver as employee manager with admin fallback when no manager exists.
- Keep claim and policy computations server-side to ensure deterministic, auditable totals.

## Components

- **Employee claim UI**
  - Claim list with status filters.
  - Create/edit claim dialog or wizard by claim type.
  - Claim detail view with timeline and decision history.
  - Attachment uploader for receipts.
- **Manager/Admin approval UI**
  - Approval queue (pending claims).
  - Decision panel for approve/reject with notes.
  - Filters by employee, date range, status, currency, project.
- **Admin policy UI**
  - Settings page for mileage and per-diem policies.
  - Effective-date-based policy versioning.

## Data Model

- `travel_expense_claim`
  - Organization scoping: `organizationId`.
  - Ownership and routing: `employeeId`, `approverId`.
  - Type and lifecycle: `type`, `status`.
  - Trip context: `tripStart`, `tripEnd`, location metadata, purpose/notes.
  - Accounting linkage: optional `projectId`.
  - Currency and amounts:
    - Original amount and currency entered by employee.
    - Calculated reimbursement amount fields persisted after server-side computation.
  - Audit timestamps for draft, submit, and decision.
- `travel_expense_attachment`
  - Claim reference + org scoping.
  - File metadata: storage key, file name, mime type, size, uploader, created timestamp.
- `travel_expense_policy`
  - Org-scoped policy rows with active/effective windows.
  - Mileage rate config.
  - Per-diem rules by trip conditions (for example date/location bands).
- `travel_expense_decision_log`
  - Immutable decision events for approval/rejection.
  - Actor, action, reason/comment, timestamp.

## Data Flow

1. Employee creates draft claim and selects claim type.
2. Employee enters claim-specific fields:
   - Receipt: amount, currency, receipt attachment(s).
   - Mileage: route/distance; amount calculated from mileage policy.
   - Per diem: trip details; amount calculated from per-diem policy.
3. System validates claim based on type-specific rules and organization permissions.
4. On submit, status changes to `submitted` and approver is resolved (manager, fallback admin).
5. Approver reviews and decides:
   - `submitted -> approved`
   - `submitted -> rejected`
6. Decision is logged in immutable history and reflected in claim timeline/list.

## Error Handling

- Clear validation errors per claim type (missing fields, invalid ranges, missing receipt attachment).
- Business-rule errors for invalid transitions (already decided, unauthorized approver, missing policy coverage).
- Concurrency guard to prevent double-decision conflicts on the same claim.
- Structured server logging for failures without exposing sensitive file storage details.

## Security and Multi-Tenancy

- Every query/mutation enforces `organizationId` boundary checks.
- Employees can access only their own claims (with edit rights limited to draft state).
- Managers/admins can access claims they are authorized to approve within org scope.
- Attachment access is permission-checked against claim authorization, not raw storage key access.
- Audit log entries for create, submit, approve, and reject actions.

## Testing Strategy

### Unit Tests

- Mileage and per-diem calculators.
- Currency and claim-type validation rules.

### Server Action Tests

- Role and ownership authorization matrix (employee/manager/admin).
- Status transition rules and idempotency checks.

### Integration Tests

- End-to-end claim lifecycle from draft to manager decision.
- Receipt attachment requirement for receipt claims.
- Optional project linkage behavior under `projectsEnabled`.

### UI Tests

- Claim form variants per claim type.
- Approval queue filtering and decision actions.

## Success Criteria

- Employees can submit receipt, mileage, and per-diem claims successfully.
- Managers can review and approve/reject claims with reason tracking.
- Claims are fully organization-scoped and permission-safe.
- Multi-currency claim capture and policy-based calculation work end-to-end.
- Status/history views make claim outcomes explicit and auditable.

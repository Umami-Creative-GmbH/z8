# Canonical Time Model Design

## Objective

Establish one normalized relational canonical time model for the whole app domain so all work periods, breaks, overtime, absences, cost center allocation, project allocation, and approvals share a single source of truth, and every connector maps to and from this model.

## Scope

V1 includes:

- Whole-domain cutover to canonical model in a single release.
- Normalized relational schema as the canonical persistence layer.
- Contract redesign for app APIs and UI payloads to canonical resources.
- Connector contract unification (`toCanonical` / `fromCanonical`).
- Canonical approval and overtime models.

V1 excludes:

- Backward-compatible API wrappers for legacy payload shapes after cutover.
- Event-sourcing-first persistence.
- Partial phased migration.

## Confirmed Product Decisions

- **Cutover strategy:** Big-bang one-time cutover.
- **Coverage:** Whole app domain, not connector layer only.
- **Primary KPI:** Connector consistency.
- **Storage model:** Normalized relational tables.
- **Contract posture:** Redesign contracts to canonical shapes.

## Approaches Considered

### A) Canonical Relational Core + Extension Tables (Selected)

Use one shared canonical `time_record` base with normalized extension tables for work, break, absence, allocations, approvals, and overtime.

Pros:

- Best fit for connector consistency KPI.
- Clear invariants and data quality constraints.
- Good queryability for analytics and payroll.

Cons:

- Highest schema and service rewrite scope.

### B) Wide Denormalized Canonical Tables

Use a small number of large tables with many nullable columns across all record types.

Pros:

- Simpler short-term querying and ETL.

Cons:

- Weak invariants and maintainability.
- High risk of rule drift and null-heavy data.

### C) Event Ledger + Snapshot Projections

Use canonical events as source, with relational projections for reads/exports.

Pros:

- Strong replayability and audit semantics.

Cons:

- Unnecessary complexity for current needs.
- Misaligned with selected relational-first strategy.

## Architecture

- Introduce `time_record` as the canonical base entity for labor-relevant intervals.
- Replace split domain semantics currently spread across work, absence, and approval artifacts with canonical resources.
- Redesign server actions/endpoints around canonical commands and queries.
- Redesign frontend payload consumption around a canonical `TimeRecord` resource.
- Keep strict multi-tenancy by requiring `organizationId` on every canonical table and query.
- Make connector code map only to/from canonical model (no connector-specific core logic).

## Canonical Data Model

### Base Table

1. `time_record`
   - identity and scope: `id`, `organization_id`, `employee_id`
   - classification: `record_kind` (`work`, `absence`, `break`, `adjustment`)
   - temporal core: `start_at`, `end_at`, `duration_minutes`
   - state and origin: `approval_state`, `origin`
   - audit: `created_at`, `updated_at`, `created_by`, `updated_by`

### Extension Tables

2. `time_record_work`
   - `record_id` (PK/FK to `time_record`)
   - work-specific attributes (location type, work category, optional computation metadata)

3. `time_record_absence`
   - `record_id` (PK/FK)
   - absence category and day-period semantics
   - vacation-impact and policy flags as needed by existing logic

4. `time_record_break`
   - `record_id` (PK/FK)
   - break-specific attributes (`paid_unpaid`, `auto_insert_reason`)

### Allocation Model

5. `time_record_allocation`
   - `id`, `organization_id`, `record_id`
   - `allocation_kind` (`project`, `cost_center`)
   - `allocation_id`, `weight_percent`

### Approval Model

6. `time_record_approval_decision`
   - immutable decision log entries (`record_id`, actor, decision, reason, timestamp)
   - latest valid decision defines current effective state

### Overtime Model

7. `overtime_ledger`
   - org/employee-scoped overtime balance entity

8. `overtime_ledger_entry`
   - immutable overtime movements per period/policy rule
   - supports consistent connector exports and analytics

## Components and Contracts

### Canonical API Surface

- Commands: `createTimeRecord`, `updateTimeRecord`, `submitTimeRecord`, `decideTimeRecord`
- Queries: `listTimeRecords`, `getTimeRecordTimeline`
- Filter model: kind, date range, employee/team, approval state, project, cost center

### Frontend Composition

- `TimeRecordForm` with kind-specific sections.
- `TimeRecordList` with canonical filters and status semantics.
- `TimeRecordDetailTimeline` for immutable state and decision history.

### Connector Contract

- `toCanonical(externalPayload) => CanonicalTimeRecord[]`
- `fromCanonical(canonicalRecords) => externalPayload`
- All connectors integrate through this contract only.

## Data Flow

1. Client submits canonical intent.
2. Server resolves session actor, role, and `organizationId` scope.
3. Server validates canonical invariants by record kind.
4. Server writes `time_record`, corresponding extension row, allocations, and audit event.
5. Submit/decide flows append immutable approval decisions and update effective record state.
6. Connector import maps external input to canonical records with idempotency keys.
7. Connector export reads canonical rows and maps to connector payload format.

## Invariants and Rules

- Every canonical row is organization-scoped and permission-checked.
- Approval transitions are constrained (`draft -> pending -> approved|rejected`).
- Break interval conflicts are rejected.
- Absence day-period and range validation is enforced.
- Durations cannot be negative; invalid temporal windows fail validation.

## Error Handling

- Field-level validation errors for user-correctable issues.
- State-transition conflict errors for concurrent/invalid decisions.
- Per-record connector error classification (`retryable` vs `non-retryable`).
- Generic user-facing errors; structured diagnostics in server logs.

## Migration and Cutover Plan

1. Freeze writes.
2. Create canonical schema, indexes, and constraints.
3. Backfill canonical tables from legacy work/absence/approval/allocation data.
4. Run reconciliation checks (counts, durations, state parity, export parity fixtures).
5. Switch all runtime reads/writes to canonical model.
6. Remove legacy read paths and legacy contracts in same release.

Rollback strategy:

- Create one-shot DB snapshot at cutover start.
- If reconciliation fails, restore snapshot and abort release.

## Testing Strategy

### Schema and Domain Tests

- Constraint and invariant tests for canonical tables.
- Transition tests for approval state graph and immutability.

### Authorization and Multi-Tenancy Tests

- Organization boundary checks on all commands/queries.
- RBAC matrix tests for employee/manager/admin actions.

### Connector Contract Tests

- Validate each connector exclusively maps through canonical model.
- Verify idempotent imports and deterministic exports.

### Reconciliation and Regression Tests

- Compare pre/post migration datasets for parity.
- Verify export/payroll outputs on fixed golden fixtures.

### End-to-End Tests

- Full lifecycle flows across work, break, absence, overtime, and approvals.

## Acceptance Criteria

- 100% connector flows map through canonical schema.
- No app runtime path reads legacy time/absence/approval tables.
- Canonical APIs and UI payloads fully replace legacy contract shapes.
- Reconciliation and regression suites pass for migration parity.
- Organization isolation and RBAC checks pass across all canonical flows.

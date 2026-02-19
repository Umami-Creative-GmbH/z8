# Overtime Burn-Down Dashboard Design

## Objective

Design a read-only analytics dashboard that shows overtime burn-down by team, cost center, and manager, with weekly trends and role-scoped visibility.

## Scope

V1 includes:

- New analytics subpage for overtime burn-down.
- Weekly overtime trend charts.
- Team, cost center, and manager rollups.
- Date range and dimension filters.
- Export support through existing analytics export patterns.

V1 excludes:

- Target-setting workflows.
- Automated alerting/escalation.
- Snapshot pipeline/background materialization.

## Confirmed Product Decisions

- **Cost center source:** New first-class cost center model.
- **Burn-down definition:** Overtime balance to target over time.
- **Access model:** Admins get org-wide view, managers get only their scope.
- **Default time grain:** Weekly.
- **Success criteria:** Week-over-week downward trend.
- **Negative balances:** Capped at zero (no negative carry).
- **Attribution:** Employee-level cost center assignment.
- **Placement:** New analytics subpage.
- **V1 scope:** Read-only analytics.

## Approaches Considered

### A) Extend Existing Analytics Service (Selected)

Add cost center schema + assignment, extend analytics server actions and `analytics.service.ts` with overtime burn-down aggregations, and render a new page under `/analytics`.

Pros:

- Fastest delivery for V1.
- Reuses established authz, Effect runtime, and UI patterns.
- Minimal operational overhead.

Cons:

- On-demand aggregation cost can grow with larger datasets.

### B) Snapshot Table Pipeline

Precompute weekly overtime balances into snapshot tables via scheduled jobs and read from snapshots in UI.

Pros:

- Scales well for heavy historical queries.
- Strong auditability and deterministic history.

Cons:

- More infrastructure and lifecycle complexity.
- Slower initial delivery.

### C) Hybrid (On-Demand + Snapshots)

Compute recent windows on-demand and persist periodic snapshots for long history.

Pros:

- Balances performance and flexibility.

Cons:

- Highest design and implementation complexity for V1.

## Architecture

- Add route `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`.
- Add analytics tab entry in `apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx`.
- Add new server action in `apps/webapp/src/app/[locale]/(app)/analytics/actions.ts`.
- Add new analytics service method in `apps/webapp/src/lib/effect/services/analytics.service.ts`.
- Keep tenant isolation by deriving `organizationId` from authenticated employee server-side.

## Data Model

### New Tables

1. `cost_center`
   - `id` (uuid PK)
   - `organization_id` (FK, required)
   - `name` (required)
   - `code` (optional)
   - `is_active` (bool, default true)
   - timestamps (`created_at`, `updated_at`)

   Indexing and constraints:

   - index on `organization_id`
   - unique `(organization_id, name)`
   - optional unique `(organization_id, code)` when code is present

2. `employee_cost_center_assignment`
   - `id` (uuid PK)
   - `employee_id` (FK, required)
   - `cost_center_id` (FK, required)
   - `effective_from` (timestamp/date, required)
   - `effective_to` (timestamp/date, nullable)
   - timestamps

   Rules:

   - no overlapping active windows per employee
   - one active assignment per employee at any point in time

## Metric Definitions

### Weekly Burn-Down Point

For each weekly bucket and each dimension slice:

- `weeklyOvertime = max(0, totalActualHours - totalExpectedHours)`

Where:

- `totalActualHours` comes from tracked work periods in the bucket.
- `totalExpectedHours` comes from expected-hour calculations used in existing analytics.

### Trend Success

- Success is measured by week-over-week reduction in overtime hours.
- Hitting zero is not required in V1.

### Negative Handling

- Values below zero are clipped to zero.
- Undertime does not produce negative burn-down values.

## Aggregation Dimensions

- **Team:** roll up by `employee.teamId`.
- **Cost center:** roll up by active `employee_cost_center_assignment` in each week.
- **Manager:** roll up employees managed via `employee_managers`.

## Access Control and Multi-Tenancy

- Admin/owner: full organization view.
- Manager: limited to employees they manage; all rollups derived from that scoped set.
- All queries must include organization filter and role-scoped employee constraints.
- Filters that attempt to escape scope fail closed.

## UI/UX Design

### Page Structure

- Filter bar: date range + dimension filters (team, cost center, manager).
- KPI row:
  - current overtime hours
  - week-over-week delta
  - 4-week trend direction
  - count of improving groups
- Main chart: weekly overtime burn-down trend.
- Breakdown table: grouped by selected dimension, sortable by current overtime and trend.
- Export button: CSV/Excel using existing analytics export mechanics.

### Interaction Model

- Default weekly view.
- Load on page open and reload on filter/date changes.
- Skeleton/spinner during load.
- Empty states for valid no-data cases.
- Generic toast for server errors.

## Data Flow

1. User opens `/analytics/overtime-burn-down`.
2. Client sends selected date range + filters to new server action.
3. Server action resolves session employee, role, and organization scope.
4. Analytics service computes weekly aggregates and grouped rollups.
5. Server returns summary KPIs + trend series + group tables.
6. UI renders chart/table and enables export.

## Error Handling

- Reuse manager/admin access gate pattern.
- Return empty payloads for legitimate no-data scenarios.
- Validate assignment periods and reject inconsistent data at write time.
- Keep user-facing errors generic while logging structured server failures.

## Testing Strategy

### Unit Tests

- Weekly overtime aggregation math.
- `max(0, ...)` clipping behavior.
- Grouping correctness for team/cost center/manager.
- Scope filtering for manager visibility.

### Integration Tests

- Server action authz and organization isolation.
- End-to-end payload shape consistency for chart/table/export.

### UI Tests

- Filter changes trigger reload.
- Empty states and error states display correctly.
- Chart and table reflect returned aggregate data.

## Performance Guardrails

- Default range constrained (for example, last 12 weeks).
- Single aggregated server call per page refresh/filter change.
- Avoid N+1 loops where possible in service queries.

## Future Enhancements (Out of V1)

- Targets and due dates per dimension group.
- Alerting/escalation for sustained non-improving trends.
- Snapshot materialization for very large historical ranges.

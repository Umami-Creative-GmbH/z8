# Approval Performance Analytics Design

## Goal

Replace the hardcoded approval rate on `analytics/page.tsx` with real approval performance analytics. The first version will calculate approval rate, average decision time, bottlenecks by manager/team/type, and SLA warnings for the selected date range.

## Current Context

The analytics overview page currently derives team and absence metrics from server actions, but its approval KPI is hardcoded as `95.0`. A `getManagerEffectivenessData` server action and `AnalyticsService.getManagerEffectiveness` implementation already exist, but the current service query is incomplete for this feature because it does not consistently scope results by organization, uses `updatedAt` as a response-time proxy, and only reads `approval_request` records. Travel expense approvals use `travel_expense_claim.submittedAt` and `travel_expense_claim.decidedAt`, with decision audit data in `travel_expense_decision_log`.

## Data Sources

Approval analytics will include two sources:

- `approval_request` for existing absence, time, and other unified approval requests.
- `travel_expense_claim` for submitted travel expense approvals.

Draft travel expense claims are excluded because they were not submitted for approval.

All data must be filtered by the authenticated employee's `organizationId` on the server. The client must not provide an organization identifier.

## Normalized Analytics Row

Inside `AnalyticsService.getManagerEffectiveness`, records from both sources will be normalized into one internal row shape:

- `source`: `approval_request` or `travel_expense_claim`.
- `type`: the approval type, including `travel_expense_claim`.
- `organizationId`.
- `requesterEmployeeId`.
- `requesterTeamId`.
- `approverEmployeeId`.
- `status`: `pending`, `approved`, or `rejected`.
- `submittedAt`.
- `decidedAt`.
- `slaDeadline`.
- `slaStatus`.

For `approval_request`, `submittedAt` is `createdAt` and `decidedAt` is `approvedAt` when that timestamp is present. Rejected `approval_request` records without a decision timestamp still count as rejected decisions for approval-rate totals, but they are excluded from average decision time because the actual decision time is unknown. For travel expenses, `submittedAt` is `submittedAt` and `decidedAt` is `decidedAt`.

## Calculations

Approval rate is calculated as approved divided by decided requests. Pending requests are excluded from the denominator so the rate describes completed decisions rather than open workload.

Average decision time is calculated from actual decision timestamps: `decidedAt - submittedAt`. It is reported in hours. Records without a decision timestamp are excluded from this average.

SLA warnings count pending records whose SLA status is `approaching` or `overdue`. Existing SLA calculation rules should be reused where possible. If a type is unsupported by the SLA calculator, it is excluded from SLA warning calculations rather than assigned a guessed deadline.

Bottleneck groups will be calculated by:

- Manager: approver employee.
- Team: requester team.
- Type: approval type.

Rows should be sorted by highest SLA warnings first, then by highest pending count or average decision time so the most operationally relevant bottlenecks appear first.

## API Shape

The existing `ManagerEffectivenessData` type will be extended rather than replaced. The current `approvalMetrics`, `byManager`, `responseTimeDistribution`, and `trends` fields remain available, but response-time fields should represent real decision time rather than `updatedAt` drift.

The shape will add fields for:

- `approvalMetrics.avgDecisionTimeHours`.
- `approvalMetrics.pendingSlaWarnings`.
- `byManager[].pendingSlaWarnings`.
- `byManager[].pendingCount`.
- `byTeam` bottleneck rows.
- `byType` bottleneck rows.

This keeps the analytics page simple and leaves aggregation logic server-side.

## UI Behavior

`analytics/page.tsx` will call `getManagerEffectivenessData(dateRange)` alongside the existing team and absence analytics calls.

The Approval Rate KPI card will use `managerEffectiveness.approvalMetrics.approvalRate` instead of the hardcoded `95.0`. Its helper text will describe decided requests, not all submitted requests.

The page will add a compact approval bottlenecks section below the existing charts. It will show the most important manager, team, and type bottlenecks using the returned grouped rows. The UI should stay consistent with the existing restrained analytics layout and avoid introducing a new visual system.

If approval analytics fails while other analytics succeed, the page should still render available data. The approval KPI should show an empty or zero state and must not fall back to fake data.

## Error Handling

Server-side errors should use the existing Effect and `runServerActionSafe` path. Empty datasets should return zero metrics and empty bottleneck arrays.

Records with missing decision timestamps are excluded from average decision time, but they still contribute to pending counts if pending.

Unknown or unsupported approval types are excluded from SLA warning counts. They can still contribute to approval rate and decision-time metrics when their status and timestamps are valid.

## Testing

Tests should cover:

- Approval rate excludes pending requests from the denominator.
- Average decision time uses actual decision timestamps, not `updatedAt`.
- `approval_request` analytics are organization-scoped.
- Submitted travel expense claims are included in approval rate and decision-time metrics.
- Draft travel expense claims are excluded.
- Pending SLA warnings use existing SLA rules and exclude unsupported types.
- The analytics overview page consumes the real approval metric instead of using the hardcoded `95.0`.

## Scope Boundaries

This work does not add organization-specific SLA configuration. It reuses the existing SLA defaults and supported rules.

This work does not add a new analytics database table or background aggregation job. Metrics are computed on demand for the selected date range.

This work does not redesign the analytics page beyond adding the approval KPI data source and a compact bottleneck section.

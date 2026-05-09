# Project Health Alerts And Budget Utilization Dashboard Design

## Context

Z8 already supports project budgets, project deadlines, project managers, budget warning notifications, deadline warning notification state, and a Project Reports page. The existing report page includes portfolio and project detail views with budget progress and deadline indicators.

This MVP adds report/dashboard visibility for project budget and deadline risk without adding new database tables or changing notification delivery. The first surface is the existing Project Reports page.

## Goals

- Show project budget/deadline alerts on the Project Reports page after a report is generated.
- Add a budget utilization summary for the generated portfolio report.
- Include simple forecast risk based on selected report range burn rate.
- Let admins, managers, and assigned project managers access the relevant project health view.
- Keep thresholds hardcoded for the MVP, matching the existing notification thresholds.

## Non-Goals

- No configurable alert thresholds.
- No persisted alert history or new alert tables.
- No new notification delivery behavior.
- No employee capacity, schedule capacity, or allocation utilization.
- No main app dashboard widget in this MVP.

## Data And Permissions

`getProjectsOverview(startDate, endDate, statusFilter)` will return additional derived health fields on each `ProjectSummary` plus portfolio-level budget health totals. All queries remain organization-scoped through the current employee's `organizationId`.

Access changes from admins/managers only to admins, managers, and assigned project managers:

- Admins and managers see all matching projects in their organization.
- Assigned project managers see only projects where they have a `projectManager` row.
- Existing detailed project report access remains aligned with this model.

Each project summary includes these derived fields:

- `budgetSeverity`: `none | warning | critical`
- `budgetAlertType`: `budget_70 | budget_90 | budget_100 | null`
- `deadlineSeverity`: `none | warning | critical`
- `deadlineAlertType`: `deadline_14d | deadline_7d | deadline_1d | deadline_today | deadline_overdue | null`
- `forecastSeverity`: `none | warning | critical`
- `forecastBudgetExhaustionDate`: `Date | null`
- `forecastMessage`: `string | null`

Portfolio totals include counts for budget usage above 70%, budget usage above 90%, over-budget projects, and forecast-at-risk projects. Projects without budgets are excluded from budget utilization and forecast counts. Projects without deadlines can still show threshold budget alerts but cannot show deadline-based forecast risk.

## Alert Rules

The MVP uses the existing hardcoded thresholds:

- Budget alerts at 70%, 90%, and 100% of budget hours used.
- Deadline alerts at 14 days, 7 days, 1 day, due today, and overdue.

Severity rules:

- `critical`: over budget, overdue, due today, or forecast exhaustion before deadline with very little remaining buffer.
- `warning`: 70% or 90% budget used, deadline within 14 days, or forecast exhaustion before deadline.
- `none`: no threshold alert and no forecast risk.

When multiple threshold conditions match, the highest severity alert is surfaced while preserving the underlying metrics for display.

## Forecasting

Forecasting uses the generated report range and remains deliberately simple and transparent:

- `averageDailyHours = totalHours / numberOfDaysInSelectedRange`
- `remainingBudgetHours = budgetHours - totalHours`
- If `averageDailyHours <= 0`, no forecast risk is shown.
- `daysUntilBudgetExhaustion = remainingBudgetHours / averageDailyHours`
- `forecastBudgetExhaustionDate = now + daysUntilBudgetExhaustion`
- If forecast exhaustion is before the project deadline, show a forecast risk.

Forecast risk is computed only for projects with both `budgetHours` and `deadline`. If a project is already over budget, the threshold budget alert is the primary signal and forecast risk does not need to duplicate it.

## UI

The Project Reports page keeps the current filter-first workflow. After the user generates a report, the portfolio tab shows two new sections above the portfolio table.

### Project Health Alerts

A compact card lists budget threshold alerts, deadline threshold alerts, and forecast risks. Alerts are sorted by severity first, then by nearest deadline or highest budget usage.

Each row shows:

- Project name.
- Alert reason.
- Current budget utilization when a budget exists.
- Deadline context when a deadline exists.
- A `View details` action that opens the existing project detail tab.

If no alerts are present, the card shows: `No budget or deadline risks in this report period.`

### Budget Utilization Summary

A small dashboard row shows portfolio-level budget health:

- Projects at or above 70% budget used.
- Projects at or above 90% budget used.
- Projects over budget.
- Projects forecast at risk.

The visual style follows the existing project report cards: restrained cards, tabular numbers, neutral defaults, amber for warnings, and red for critical states.

### Portfolio Table

The existing portfolio table remains the primary detailed list. If useful, the Budget column may add a compact forecast-risk badge, but the MVP should avoid creating a second large table.

## Implementation Boundaries

The implementation should stay local to the project reports feature:

- Update report types in `apps/webapp/src/lib/reports/project-types.ts`.
- Add health derivation helpers near the project reports action or in a small project report helper if the action becomes crowded.
- Update `getProjectsOverview` to compute health fields while it already aggregates each project.
- Adjust project report access so assigned project managers can see only managed project portfolio rows.
- Add `ProjectHealthAlerts` and `ProjectBudgetUtilizationSummary` components under `apps/webapp/src/components/reports/projects/`.
- Render both components in the portfolio tab above `ProjectPortfolioTable`.
- Update project report documentation to mention alerts, utilization summary, and forecast risk.

No database migration is required.

## Testing

Add coverage for:

- Budget threshold derivation at 70%, 90%, and 100%.
- Deadline threshold derivation for 14 days, 7 days, 1 day, due today, and overdue.
- Projects with no budget, no deadline, or no logged hours.
- Forecast risk when projected budget exhaustion falls before the deadline.
- No forecast risk when average daily hours is zero or required fields are missing.
- Access behavior: admins/managers see organization portfolio rows, assigned project managers see only managed projects, and unrelated employees remain unauthorized.
- Alert empty state and alert rendering, if the existing component test setup supports these components cleanly.

## Open Decisions

No open product decisions remain for the MVP. The approved scope is an existing Project Reports page enhancement using existing thresholds, budget utilization only, admins/managers/project managers access, and simple selected-range burn-rate forecasting.

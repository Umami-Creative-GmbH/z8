# Manager Today Counts Design

## Purpose

The dashboard Manager Today card currently repeats static guidance without showing whether anything needs attention. Replace that static body with a compact snapshot from the existing Manager Daily Briefing data so managers can see today's operational load before opening `/today`.

## Scope

- Reuse the existing manager/admin access behavior already present in `ManagerTodayWidget`.
- Reuse the existing Manager Daily Briefing summary model instead of creating a separate dashboard aggregation path.
- Show four compact counts: critical issues, open approvals, clock-in exceptions, and risks.
- Keep the existing `Open Brief` action linking to `/today`.
- Do not add new persisted state, dashboard settings, or a new route.

## Data Mapping

The card should call a small dashboard-facing server action that resolves the current employee and, for managers/admins, returns the existing briefing summary.

The displayed counts are:

- `Critical`: `summary.criticalIssues`
- `Approvals`: `summary.openApprovals`
- `Clock-ins`: `summary.attendanceExceptions`
- `Risks`: `summary.coverageRisks + summary.overtimeWarnings + summary.payrollIssues`

The server action must keep all data organization-scoped by using the existing `getManagerDailyBriefing` loader, which already scopes admins to the current organization and managers to managed employees.

## UI Behavior

The widget body becomes a two-by-two metric grid. Each cell shows a tabular count, a short label, and restrained status styling. Non-zero critical or risk counts should be visually noticeable but not alarmist.

When all four counts are zero, the card should show a concise all-clear message such as "No manager action is flagged right now." The count grid can still remain visible so the card does not collapse or change shape unexpectedly.

Loading should use the existing `WidgetCard` loading state. Error handling should show a short inline fallback rather than hiding the card for authorized users.

## Testing

Add focused coverage for the data mapping and rendering behavior:

- Managers/admins receive counts from the briefing summary.
- Employees continue not to see the card.
- Risk count combines coverage, overtime, and payroll issues.
- The zero-count state shows useful all-clear copy.

Verification should include the targeted tests for the changed widget or helper and the relevant `pnpm` command.

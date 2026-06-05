# Scoped Payroll Access Design

## Context

Some organizations need payroll staff who can run monthly payroll without becoming Z8 admins or managers. These users need payroll-only access to assigned teams and employees, including worked-hour totals, absence days by category, blockers for the selected period, combined PDF export, and existing payroll system exports.

The current payroll export UI is under `/settings/payroll-export` and is protected by admin settings access. That page also contains integration configuration, credentials, wage type mappings, and export history. Scoped payroll access should not open those admin configuration capabilities to normal employees.

## Goals

- Let org admins grant payroll access to selected employees without changing their `employee.role` to admin or manager.
- Scope each payroll user to any combination of teams and individual employees.
- Automatically include future employees added to assigned teams.
- Do not grant self-access unless the payroll employee is explicitly assigned or included through an assigned team.
- Let payroll users view payroll summaries, download one combined PDF, and trigger existing payroll system exports for their assigned employee scope.
- Show payroll blockers, but allow exports to proceed.
- Keep all data organization-scoped and server-authorized.

## Non-Goals

- Payroll users cannot edit payroll export configurations, credentials, wage type mappings, employee records, absence approvals, time entries, or organization settings through this feature.
- The first version does not add absence-hour totals; absences are reported in days.
- The first version does not add work category or project breakdowns for worked hours; worked time is reported as total hours per employee.
- The first version does not split the PDF into one file per employee.

## Access Model

Add a dedicated payroll access model separate from employee role promotion.

Recommended schema:

- `payroll_access_grant`
  - `id`
  - `organizationId`
  - `payrollEmployeeId`
  - `isActive`
  - `createdAt`, `createdBy`, `updatedAt`, `updatedBy`
  - unique active grant per `organizationId` and `payrollEmployeeId`
- `payroll_access_team`
  - `id`
  - `organizationId`
  - `grantId`
  - `teamId`
  - `createdAt`, `createdBy`
  - unique assignment per grant and team
- `payroll_access_employee`
  - `id`
  - `organizationId`
  - `grantId`
  - `employeeId`
  - `createdAt`, `createdBy`
  - unique assignment per grant and employee

All foreign keys should preserve organization scope. Team and employee assignments must verify that the target team or employee belongs to the same organization as the grant. Team assignments resolve employees from current team membership at request time. If both `employee.teamId` and `teamMembership` are in use, a payroll team assignment includes employees connected through either source so existing primary-team data and multi-team membership data are both honored.

Only org admins can create, update, or deactivate payroll access grants and assignments. Managers cannot assign payroll access, even for their own direct reports.

## Authorization Rules

Admins keep full payroll access.

Employees with an active payroll access grant get payroll-only `read` and `export` access for the resolved assigned employee set. The resolved set is:

- active employees directly assigned through `payroll_access_employee`
- active employees that belong to teams assigned through `payroll_access_team`
- future active employees added to assigned teams, because team membership is resolved at request time

The payroll employee is excluded unless included through the same rules. There is no automatic self-access.

Every payroll summary query, PDF export, and payroll system export action must resolve the allowed employee IDs server-side and intersect them with requested filters. Requested `employeeIds` or `teamIds` must never expand the allowed set.

CASL integration should expose payroll-specific checks, but concrete query scoping remains mandatory at call sites. This mirrors existing Z8 patterns where permissions authorize action and organization-scoped queries enforce data boundaries.

## Payroll Workspace

Add a payroll workspace at `/payroll`, outside admin-only settings. It is visible to org admins and employees with an active payroll access grant.

The workspace contains:

- Date range selector with month, week, and custom range modes.
- Filters for assigned teams and assigned employees only.
- Summary cards for selected period, visible employee count, blockers count, and total worked hours.
- Employee payroll table with one row per visible employee:
  - employee name, employee number, and team
  - contract type with hourly workers visually highlighted
  - total worked hours
  - absence days grouped by absence category
  - blocker/status indicator
- Blocker panel showing issues such as missing clock-outs, pending absence approvals, and pending payroll-relevant time corrections.
- Export actions:
  - download combined PDF
  - trigger payroll system export through configured targets such as DATEV, Lexware, Personio, SuccessFactors, or Workday

`/settings/payroll-export` remains admin-focused for configuration, credentials, wage type mappings, and admin export history.

## Data Calculation

Payroll summaries are calculated server-side from the resolved allowed employee set and selected date range.

Worked hours:

- Show total hours per employee.
- Calculate durations from canonical UTC work period instants, not displayed wall-clock strings.
- Use Z8 timekeeping rules for period boundaries and employee-local reporting context. Do not derive business meaning from the viewer's timezone.

Absences:

- Show absence days grouped by absence category and employee.
- Report days only in the first version.

Blockers:

- Show blockers in the UI and in the combined PDF.
- Blockers are warnings only. They do not prevent PDF download or payroll system export.
- The combined PDF must include blocker details. Payroll system export jobs should include a lightweight blocker summary in existing job metadata when possible without broad export-history redesign; otherwise the UI warning and PDF are the first-version audit record.

## PDF Export

The PDF export is one combined organization payroll PDF for the selected date range and accessible employee scope.

Use the existing `@react-pdf/renderer` approach already used by Z8 reports and AVV PDFs. The payroll PDF should be more polished than the current generic employee report PDF while staying restrained and audit-ready.

PDF structure:

- Header with organization name, selected period, generated timestamp, and generated-by employee.
- Blocker summary with counts and affected employees.
- Employee payroll table with total hours and absence-day totals by category.
- Absence-by-category section grouped by employee.
- Footer with page numbering and an audit note that blockers are informational and did not prevent export.

## Payroll System Exports

Reuse the existing payroll export infrastructure where possible.

For payroll users:

- Load only configured export targets.
- Allow triggering exports for the allowed scope.
- Intersect requested team and employee filters with the resolved allowed employee IDs before creating an export job.
- Do not allow reading or editing integration configuration, credentials, or wage type mappings.

For org admins:

- Existing admin export behavior remains available.
- Admins can also use the new payroll workspace if helpful.

## Error Handling

- If a payroll user has no active grant, hide the payroll workspace and deny server actions.
- If a grant exists but resolves to no employees, show an empty state explaining that no employees are assigned.
- If requested filters resolve outside the allowed scope, ignore unauthorized employees and return data for the allowed intersection. If the intersection is empty, return an empty result rather than leaking whether unauthorized employees exist.
- If payroll export configuration is missing for a target, show the same kind of unavailable-target messaging as the current payroll export form.
- If PDF generation fails, show a download-specific error and leave the selected filters intact.

## Testing

- Permission tests for admin access, active payroll grants, team assignments, direct employee assignments, automatic future team members, and no implicit self-access.
- Server action tests proving requested filters cannot exceed assigned payroll scope.
- Payroll summary tests for total worked hours, absence days by category, and blocker warnings.
- PDF generation smoke tests for filename and key rendered sections.
- UI tests for payroll workspace visibility, empty assignment state, scoped filters, blocker display, PDF export action, and payroll system export action.

## Implementation Notes

- Prefer small payroll-specific helpers such as `resolvePayrollAccessibleEmployeeIds` and `canManagePayrollAccess` instead of copying authorization checks into every action.
- Keep all tenant data filtered by `organizationId`.
- Use Luxon for date ranges and calendar math.
- Use `@tanstack/react-form` for any admin assignment forms that are created as part of this feature.
- Use `@tabler/icons-react` icons only.

# Manager Daily Briefing Design

## Purpose

The Manager Daily Briefing is a manager-facing Today command page for daily operational work. It is different from the existing dashboard because it prioritizes exceptions, decisions, and next actions over general status widgets.

The page answers one question: what needs the manager's attention today, and where should they act?

## Access And Navigation

The briefing will live at `/today` and be reached from a prominent manager-only entry card on the existing dashboard. It will not replace the current dashboard and will not add a sidebar item in the first version.

Access is limited to managers and admins:

- Admins see the whole current organization.
- Managers see employees in teams they manage.
- Employees without manager/admin access are redirected or denied consistently with the existing approvals pages.

Every query must be scoped by `organizationId`. Employee eligibility must be resolved before metrics are computed so unauthorized employees do not affect counts, lists, or summaries.

## Page Structure

The page is organized around action priority, not analytics.

### Priority Summary

A compact summary strip shows counts for:

- Critical issues
- Open approvals
- Missing or late clock-ins
- Absences today
- Coverage risks
- Overtime warnings
- Payroll-impacting issues

### Needs Action

This is the primary section. It combines the highest-priority items across all briefing categories into one ranked action queue.

Each item includes:

- Stable item ID
- Severity
- Category
- Employee, team, or location context
- Short reason
- Primary action label and destination

### Approvals

This section shows pending absence, time correction, shift request, and travel expense approvals. Simple approve/reject decisions can happen inline. Detailed review and bulk work link to the existing approvals inbox.

### Attendance Exceptions

This section shows employees who are expected from published shifts but have not clocked in or are late. The first version only uses published shifts and does not infer expectations from employee work schedules.

### Absences Today

This section shows approved absences overlapping today, grouped by team where possible.

### Coverage Risks

This section compares today's published shifts with coverage rules to surface understaffed subareas and unassigned shifts.

### Overtime And Payroll Issues

This section shows overtime warnings and payroll-impacting data quality issues, such as unapproved time records, missing wage mappings, or records likely to block payroll readiness.

## Data Flow

The briefing should use a server-side loader such as `getManagerDailyBriefing({ organizationId, employeeId, role, today })`. The loader returns normalized briefing sections and should not introduce new persisted state.

The loader flow is:

1. Resolve the current organization and employee.
2. Determine managed employee scope from the user's role.
3. Load today's published shifts, open work time records, approved absences, pending approvals, coverage rules, overtime signals, and payroll readiness issues.
4. Normalize the results into section models and action items.
5. Return partial section errors without failing the whole briefing when one data source fails.

Dates and time calculations should use Luxon, following the repository date/time conventions.

## Actions

The first version supports inline approval actions for simple approvals only. Other issues deep-link to existing workflows.

Supported actions:

- Approve or reject supported approval items inline.
- Open `/approvals/inbox` for full approval review and bulk decisions.
- Open scheduling, time tracking, absences, payroll readiness, or employee detail pages for non-approval issues.

After an inline approval action succeeds, the briefing refreshes and shows success feedback. If an inline approval action fails, the row remains visible and the returned error is shown.

## UI Requirements

The interface should be restrained, clear, and operational. It should use clean cards, severity badges, compact tables or lists, and direct action buttons. Copy should be specific and calm, for example: "3 employees expected but not clocked in."

Responsive behavior:

- On desktop, summary and sections can use multi-column layout where it improves scanning.
- On mobile, the Needs Action list appears before supporting sections.
- Actions remain reachable without horizontal scrolling.

Empty states should distinguish between all-clear states and missing configuration. For example, no coverage risks is different from coverage rules not being configured.

## Error Handling

Expected error states:

- No employee profile: show the existing no-employee error pattern.
- Unauthorized role: redirect or deny access consistently with current manager-only pages.
- Section-level data failure: render the rest of the briefing and show a section-level error state.
- Inline approval failure: keep the row visible and show the error.
- Missing configuration: show a clear setup-oriented empty state rather than an all-clear message.

## Testing

Testing should cover:

- Briefing loader organization scoping.
- Manager/admin employee scope rules.
- Missing and late clock-in detection from published shifts only.
- Approved absence overlap with today.
- Approval aggregation and inline action wiring.
- Coverage risk detection from published shifts and coverage rules.
- Overtime and payroll-impacting issue detection.
- Dashboard entry card visibility for managers/admins only.
- Page access behavior for employees, managers, and admins.
- Empty states and section-level error states.
- Inline approval success, failure, and refresh behavior.

Verification should include targeted tests and the relevant repository quality checks, using `pnpm` commands.

## Out Of Scope For First Version

- Inferring expected work from employee work schedules when no published shift exists.
- Adding a sidebar navigation item.
- Replacing the current dashboard for managers.
- Inline command actions for scheduling, time tracking, payroll, or absence issues beyond approval decisions.
- New persisted briefing state.

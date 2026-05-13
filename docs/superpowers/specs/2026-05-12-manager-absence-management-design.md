# Manager Absence Management Design

## Goal

Add a manager-facing absence management page where managers and admins can review employee absence metrics and record absences on behalf of employees. This supports cases such as an employee reporting sickness directly to a manager, where the manager needs to enter the record without asking the employee to submit a request.

## Scope

In scope:

- A separate manager/admin absence management page.
- A searchable, paginated employee table with selected-year absence metrics.
- A year switcher, defaulting to the current calendar year.
- A row action to record an absence on behalf of an employee.
- Manager/admin-created absences are approved immediately.
- Employee notification after an absence is recorded on their behalf.

Out of scope:

- Changing the existing personal `/absences` employee request page.
- A card-first employee directory layout.
- Custom approval routing for manager-entered absences.
- Bulk absence entry.

## Confirmed Decisions

- Managers can view and record absences only for employees they manage.
- Admins can view and record absences for any active employee in the active organization.
- Manager/admin-entered absences are created as already approved.
- The employee should be notified when an absence is recorded on their behalf.
- The page should use server-backed search and pagination.
- The page should expose a year switcher for metrics.
- Use a table as the primary layout, with responsive behavior on small screens.

## Approaches Considered

### A) Dedicated manager absence page with paginated table (Selected)

Create a new manager/admin page with search, pagination, selected-year metrics, and row actions.

Pros:

- Best fit for scanning many employees.
- Scales with server-backed pagination and search.
- Makes manager/admin behavior distinct from employee self-service requests.
- Supports operational metrics in a compact format.

Cons:

- Requires new query and mutation helpers instead of only reusing the personal absence page.

### B) Dedicated page with employee cards

Use cards for each employee and place metrics/actions inside each card.

Pros:

- Friendly on mobile.
- Good for rich employee summaries.

Cons:

- Weaker for comparing employees and scanning larger teams.
- Less efficient for pagination/search-heavy manager workflows.

### C) Hybrid table plus detail drawer

Use a table for search and add a detail drawer with deeper employee absence history.

Pros:

- Combines scalable scanning with rich detail.
- Leaves room for future context before recording an absence.

Cons:

- More UI and state-management scope than needed for the first version.

## Architecture

Add a new manager-facing absence page under `/team/absences` rather than extending the existing personal `/absences` page. The route should be available only to managers and admins in the active organization.

Backend behavior should live in focused server-side query/action helpers. The list query returns a paginated, searchable employee slice scoped by the acting employee's permissions. The create action records an absence for the selected target employee after re-checking organization, role, active employee status, and manager relationship.

The create action should reuse existing absence workflow logic where practical, but it needs a manager-specific entrypoint because the target employee differs from the acting user and the resulting absence is approved immediately.

## UI

The page header includes:

- Title such as `Team absences` or `Employee absences`.
- Short explanatory text that this page is for managers/admins to record absences on behalf of employees.
- Search input for employee name/email/employee number where available.
- Year switcher, defaulting to the current calendar year.

The table columns should include:

- Employee.
- Team or role where available.
- Vacation allowance.
- Used vacation days.
- Pending vacation days.
- Days left.
- Sick days.
- Actions.

The primary row action is `Add absence` or `Record absence`. The form copy should use `Record absence`, not `Request absence`, because the manager/admin is entering an approved record on behalf of the employee.

On mobile, keep employee identity, key metrics, and the row action visible. Lower-priority metrics can collapse into secondary row text or responsive details.

## Data Flow

The page reads `search`, `page`, `pageSize`, and `year` from server-backed state. The server query resolves the acting employee from the current session and active organization, then applies role-based scoping:

- Managers: employees they manage.
- Admins: all active employees in the active organization.

For each visible employee, the query returns selected-year metrics:

- Vacation allowance for the year.
- Approved vacation days used.
- Pending vacation days.
- Remaining vacation days.
- Sick days for the year.

When the manager/admin records an absence:

1. The client submits target employee, category, date range, half-day periods, and notes.
2. The server resolves the acting employee and active organization.
3. The server verifies the target employee is active, belongs to the active organization, and is accessible to the actor.
4. The server validates the category belongs to the organization and is active.
5. The server applies the same date, half-day, and overlap validation used by employee absence requests.
6. The server inserts an approved absence entry for the target employee.
7. The server sets `approvedBy` to the acting employee and `approvedAt` to the current timestamp.
8. The server creates or syncs the canonical absence record as approved.
9. The server queues calendar sync.
10. The server notifies the employee that an absence was recorded on their behalf.

## Permissions

Access rules:

- Employees without manager/admin role cannot access the page.
- Managers can view and record absences only for employees they manage.
- Admins can view and record absences for any active employee in the active organization.
- Every query and mutation must filter by `organizationId`.
- Mutations must re-check permissions on submit and cannot trust client-selected employee IDs.

Unauthorized or inaccessible employee errors should use a generic message such as `Employee not found or not accessible` to avoid leaking cross-organization or unmanaged employee existence.

## Error Handling

The create action should return structured success/error results consistent with existing server actions.

Expected errors:

- No employee profile for the actor.
- Actor is not a manager or admin.
- Target employee is not found, inactive, cross-organization, or inaccessible.
- Invalid or inactive absence category.
- Start date after end date.
- Invalid same-day half-day period.
- Overlap with existing pending or approved absence.
- Canonical record persistence failure.

Employee notification should be attempted after successful persistence. A notification failure should be logged and surfaced only if existing email/notification infrastructure requires hard failure; it should not roll back a successfully recorded absence.

## Testing Strategy

Server-side coverage should come first because authorization and tenant scoping are the highest-risk parts.

Tests should verify:

- Manager list query returns only managed employees.
- Admin list query can return all active employees in the active organization.
- Search and pagination remain organization-scoped.
- Manager cannot record absence for unmanaged employees.
- Admin cannot record absence for another organization.
- Inactive target employees are rejected.
- Manager/admin-created absences are approved immediately with `approvedBy` and `approvedAt`.
- Date, half-day, category, and overlap validation matches the existing absence flow.
- Employee notification is attempted after successful creation.
- UI renders the metrics table and opens the record absence flow for a row.

## Risks and Mitigations

- Risk: manager relationship logic diverges from other app areas.
  Mitigation: reuse the existing manager relationship model and query patterns where possible.
- Risk: cross-tenant data leakage through search or target employee IDs.
  Mitigation: every read and write must include active organization scope and server-side permission checks.
- Risk: duplicating absence request workflow logic.
  Mitigation: extract or reuse shared validation/persistence helpers only where it keeps the implementation small and clear.
- Risk: table metrics become slow for large organizations.
  Mitigation: calculate metrics only for the visible page of employees and selected year.

## Success Criteria

- Managers can find managed employees and record approved absences on their behalf.
- Admins can find any active employee in the active organization and record approved absences on their behalf.
- The table provides useful selected-year metrics for vacation and sickness at a glance.
- Employees are notified when a manager/admin records an absence for them.
- Authorization and organization scoping are enforced on both listing and creation.

# Team Yearly Time Balance Design

## Objective

Add manager-friendly yearly time balance visibility to `/team` by including the current user in the team list, marking them with a `You` badge, and showing each visible employee's current-year overtime or underhours as an organization-scoped persisted calculated value.

## Scope

V1 includes:

- Current user inclusion on `/team` for managers and admins.
- A `You` badge/tag in card and table views.
- A persisted yearly employee time balance keyed by organization, employee, and year.
- A current-year plus/minus balance indicator for each visible employee.
- Absence-adjusted expected hours using existing absence category semantics.

V1 excludes:

- Background scheduled recalculation jobs.
- Event-driven recalculation on every work-period or absence mutation.
- Org-wide expansion of `/team` visibility for admins beyond the existing direct-report behavior.
- Historical year selection in the `/team` UI.

## Confirmed Product Decisions

- Timeframe is the current calendar year.
- Balance values are persisted, not only calculated for the response.
- Persistence is organization-scoped because one user can have employee profiles in multiple organizations.
- Approved absences reduce expected hours only when their category has `requiresWorkTime = false`.
- Absences whose category has `requiresWorkTime = true` do not reduce expected hours because the employee still needs to record work time.
- The absence adjustment does not depend on `countsAgainstVacation`.

## Approaches Considered

### A) Persisted Balance Refreshed On `/team` Load (Selected)

Add an `employee_time_balance` table and refresh visible employees' current-year balances before returning `/team` data.

Pros:

- Satisfies the persisted calculated-field requirement.
- Minimal operational complexity.
- Keeps the first implementation focused on the existing `/team` use case.

Cons:

- Balance rows can be stale until `/team` or another refresh path recalculates them.

### B) Persisted Balance With Scheduled Recalculation

Persist the same table and add a recurring job to refresh balances for active employees.

Pros:

- Better freshness for downstream consumers.
- Avoids making `/team` responsible for all refreshes.

Cons:

- Adds job lifecycle and operational complexity before there is a second consumer.

### C) Event-Driven Balance Updates

Update balances whenever work periods, corrections, absences, or absence categories change.

Pros:

- Most real-time and efficient at read time.

Cons:

- Highest implementation risk because every write path must stay consistent.
- More invasive than needed for V1.

## Data Model

Add a persisted table named `employee_time_balance` in the time tracking schema area.

Fields:

- `id` uuid primary key.
- `organizationId` text, required, FK to organization.
- `employeeId` uuid, required, FK to employee.
- `year` integer, required.
- `actualMinutes` integer, required.
- `expectedMinutes` integer, required.
- `absenceAdjustedMinutes` integer, required.
- `balanceMinutes` integer, required.
- `calculatedAt` timestamp, required.
- `createdAt` timestamp, required.
- `updatedAt` timestamp, required.

Indexes and constraints:

- Unique `(organizationId, employeeId, year)`.
- Index `(organizationId, year)` for organization/year refreshes.
- Index `(employeeId, organizationId, year)` for employee lookup.

The unique organization/employee/year key is required for correct behavior when a user belongs to multiple organizations.

## Metric Definition

For each visible employee in the active organization and current year:

- `actualMinutes`: sum of completed `workPeriod.durationMinutes` for non-active work periods with matching `employeeId`, `organizationId`, and `startTime` inside the current year.
- `expectedMinutes`: schedule-aware expected work minutes for the year from the employee's effective work policy.
- `absenceAdjustedMinutes`: expected minutes removed by approved absences whose category has `requiresWorkTime = false` and overlaps the current year.
- `adjustedExpectedMinutes = max(0, expectedMinutes - absenceAdjustedMinutes)`.
- `balanceMinutes = actualMinutes - adjustedExpectedMinutes`.

Interpretation:

- Positive `balanceMinutes` means overtime.
- Negative `balanceMinutes` means underhours.
- Zero means balanced.

Partial-day absences should reduce expected minutes proportionally using the existing `startPeriod` and `endPeriod` fields. Full-day absences remove the expected minutes for the covered workday. Non-working days contribute zero absence adjustment.

## Server Flow

`/team` continues to resolve identity and organization from the server session.

Flow:

1. Load the current employee from the active Better Auth organization.
2. Reject users who are not managers or admins using the existing redirect behavior.
3. Build the visible employee set from direct reports plus the current employee.
4. Filter the visible employee set to the current employee's `organizationId`.
5. Deduplicate by employee ID so the current user appears exactly once.
6. Refresh/upsert current-year `employee_time_balance` rows for the visible employees.
7. Return `ManagedEmployee[]` with an attached `timeBalance` object.

The calculation must not trust client-provided employee or organization IDs. All employee, work period, absence, and balance queries must include `organizationId`.

## UI Design

`/team` keeps the existing card/table toggle.

Current user:

- Render the current user in the same list as direct reports.
- Add a compact `You` badge next to their name in card and table views.
- Keep the existing primary-manager icon separate from the `You` badge.
- Include the current user in the header count.

Time balance indicator:

- Show a compact yearly balance chip for each employee.
- Positive values render as signed overtime, for example `+12h 30m`.
- Negative values render as signed underhours, for example `-4h 15m`.
- Zero renders as neutral, for example `0h`.
- Card view places the chip with the existing metadata badges so it wraps on mobile.
- Table view adds a sortable yearly balance column.
- If no balance row is available, show a muted unavailable state; the normal server path should calculate rows before rendering.

## Error Handling

- If balance refresh fails, `/team` should fail through the existing server action error path rather than showing misleading stale values as fresh.
- Empty direct-report lists should no longer show the empty state when the current user is available; the self row still renders.
- If an employee has no effective work policy, reuse the existing default expected-hours behavior from time-tracking calculations.
- If expected hours are zero, use the actual minutes as the balance baseline.

## Testing Strategy

Unit tests:

- Yearly balance math for positive, negative, and zero balances.
- Approved absence adjustment for `requiresWorkTime = false`.
- No absence adjustment for `requiresWorkTime = true`.
- Partial-day absence adjustment.

Server tests:

- `getManagedEmployees` includes the current employee.
- Current employee is marked with `isCurrentUser` or equivalent.
- Direct reports and self are scoped to the active organization.
- Duplicate self entries are removed.
- Balance rows are upserted by `(organizationId, employeeId, year)`.

UI tests:

- Card view renders the `You` badge.
- Table view renders the `You` badge.
- Positive, negative, and zero balances render with signed labels.
- Balance column sorts in table mode.

## Performance Guardrails

- Refresh only the visible employee set for the current year on `/team` load.
- Aggregate actual work minutes with grouped database queries where practical.
- Avoid per-row client fetches for balances.
- Keep background and event-driven refreshes out of V1 unless another consumer requires fresher persisted data.

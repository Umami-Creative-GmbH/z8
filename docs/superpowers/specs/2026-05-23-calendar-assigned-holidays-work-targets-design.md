# Calendar Assigned Holidays Work Targets Design

## Purpose

Show employee-assigned holidays on `/calendar` and make those holidays reduce required work hours to `0`, matching the existing absence-adjusted work target behavior.

This must affect both visible calendar summaries and the materialized employee work-balance worker. The worker already computes required minutes through `getDailyWorkRequirementsForEmployee`, so holiday adjustment should be centralized there rather than duplicated in worker code.

## Current Context

`/calendar` fetches event data through `/api/calendar/events`. The route currently loads holidays with `getHolidaysForMonth(organizationId, month, year)`, which returns organization-wide holidays and does not account for the selected employee's holiday assignments.

`/absences` already has employee-scoped holiday lookup logic in `apps/webapp/src/app/[locale]/(app)/absences/queries.ts`. It includes active custom holiday assignments and active holiday preset assignments that apply by organization, team, or direct employee assignment.

`getDailyWorkRequirementsForEmployee` builds policy-derived requirements and applies approved absence reductions. The work-balance worker calls this same function, so adding holiday adjustment there updates both live calendar ranges and materialized balances.

## Approved Approach

Create a shared employee-scoped holiday resolver under `apps/webapp/src/lib/calendar` and use it from both calendar event loading and work requirement calculation.

The resolver should include assigned holidays from these scopes:

- Organization-wide assignments.
- Assignments for the employee's current team.
- Direct employee assignments.

It should support both holiday sources:

- Custom holidays from `holidayAssignment` joined to `holiday`.
- Preset holidays from `holidayPresetAssignment` joined to `holidayPreset` and `holidayPresetHoliday`.

Every assigned holiday should set that date's required minutes to `0`, regardless of the holiday category's `excludeFromCalculations` value.

## Calendar Behavior

When `/api/calendar/events` is scoped to a single authorized employee and `showHolidays=true`, it should return that employee's assigned holiday events for the requested month or year range.

If no single employee is scoped, holiday display can keep the existing organization-wide behavior. Requirement calculation already returns no employee-specific requirements without a scoped employee, so there is no target adjustment in that case.

Holiday events should preserve existing `CalendarEvent` shape with `type: "holiday"`, `date`, optional `endDate`, `title`, `color`, and metadata. Preset holiday metadata should include preset information where available, matching the existing calendar holiday event conventions.

## Requirement Calculation

`getDailyWorkRequirementsForEmployee` should keep its current flow:

- Verify the employee belongs to the organization.
- Clamp the range to the employee start date.
- Build policy-derived daily requirements.
- Apply approved absence reductions.

After absence reductions, fetch assigned holidays for the same employee, organization, and date range. For each holiday date that overlaps a requirement date, set `requiredMinutes` to `0` while preserving `policyId` and `policyName`.

Multi-day custom holidays and preset holidays with `durationDays` should zero every overlapping date in the requested range. Holidays on non-required days do not need to create requirement entries.

## Data And Assignment Rules

All holiday queries must be organization-scoped.

Custom holiday assignments should include only active assignments whose target scope applies to the employee. The joined holiday must also be active and belong to the same organization.

Preset assignments should include only active assignments whose target scope applies to the employee and whose `effectiveFrom`/`effectiveUntil` window overlaps the requested range. The joined preset must be active and belong to the same organization.

Duplicate holidays from multiple assignment scopes should be deduplicated by date and source id. For requirement adjustment, only the date set matters.

## Error Handling

Calendar event loading should continue to work if employee-assigned holiday loading fails. In that case, log the server-side error and fall back to an empty holiday list for the employee-scoped holiday portion.

Requirement calculation should keep the existing resilience pattern used for absences and policy requirements. If holiday adjustment fails inside the calendar API, the API should still return events and an empty or partially adjusted `dailyRequirements` object according to the existing outer fallback behavior.

The work-balance worker should not add separate holiday-specific error handling. If requirement calculation fails for an employee, the existing per-employee worker failure handling records the error and continues with the next employee.

## Security And Multi-Tenancy

The calendar route must continue using `resolveAuthorizedCalendarEmployeeId` before loading employee-scoped holidays. Managers and admins only see assigned holidays for employees they are authorized to read.

Every holiday query must filter by `organizationId`. Employee, team, preset, and custom holiday records must not leak across organizations.

No tenant-specific holiday behavior should come from environment variables.

## Testing

Add tests for the shared holiday adjustment logic:

- A single-day assigned holiday sets that date's required minutes to `0`.
- A multi-day assigned holiday zeros every overlapping required date.
- Holidays on dates without policy requirements do not create new requirement entries.

Add or update calendar route tests:

- Employee-scoped `showHolidays=true` calls the employee-assigned holiday resolver with the authorized employee and requested range.
- Unauthorized requested employees still return `403` before holiday lookup.

Add or update requirement tests:

- `getDailyWorkRequirementsForEmployee` keeps absence reduction behavior and applies holiday zeroing after it.

Run targeted webapp tests for the edited modules. If broader checks are blocked by unrelated existing issues, report that separately.

## Out Of Scope

This design does not change holiday management UI, holiday category semantics, time-entry blocking rules, overtime approval, payroll export behavior, or how non-employee-scoped organization holiday calendars behave.

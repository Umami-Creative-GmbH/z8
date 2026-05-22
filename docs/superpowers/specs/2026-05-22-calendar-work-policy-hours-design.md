# Calendar Work Policy Hours Design

## Purpose

Show policy-based required working hours on `/calendar` so an employee can see whether each work day is under, met, or over the requirement. The requirement must come from the selected employee's effective work policy schedule. If no schedule-enabled effective policy exists, the calendar must not show required-hour status for that employee.

## Current Context

The calendar page renders `CalendarView`, which fetches event data from `/api/calendar/events` through `useCalendarData`. The API already enforces organization membership and scopes employee-specific events to the current employee unless the user is an admin or manager. Work periods are returned as real timed events and include `durationMinutes` in metadata.

The year view currently derives `workHoursData` client-side with a hardcoded `8 * 60` expected minutes default. That default must be removed for this feature and replaced with policy-derived requirements only.

Work policy data already supports effective employee, team, and organization assignments through `WorkPolicyService.getEffectivePolicy`. A policy schedule can be simple, using `hoursPerCycle` and a `workingDaysPreset`, or detailed, using per-weekday `hoursPerDay` values.

## Data Model And API

The calendar events API should return a new top-level `dailyRequirements` object beside `events` and `total`. Each entry should be keyed by `yyyy-MM-dd` and include:

- `requiredMinutes`: the required minutes for that date.
- `policyId`: the effective policy id used for the requirement.
- `policyName`: the effective policy name, useful for tooltips or future details.

The API should compute requirements only when a single employee is in scope. For non-admin users this is already the current employee. For managers/admins this is the selected employee from the calendar filter. If no employee is scoped, or if the effective policy has no enabled schedule, return an empty `dailyRequirements` object.

The response must preserve existing event behavior and authorization. Policy lookup must be organization-scoped by relying on the same employee visibility path already used by the route and the effective policy resolver. No tenant-specific settings should come from environment variables.

## Requirement Calculation

For detailed schedules, map each date's weekday to the schedule day with `isWorkDay = true`. Convert that day's `hoursPerDay` to minutes. Dates with no configured work day or `0` hours should have no requirement entry.

For simple schedules, derive working days from `workingDaysPreset`:

- `weekdays`: Monday through Friday.
- `weekends`: Saturday and Sunday.
- `all_days`: every day.
- `custom`: use the schedule's configured work days if present; otherwise do not emit requirements.

For simple schedules, divide `hoursPerCycle` across the working days in that cycle and emit the per-day value for matching days. The first implementation should prioritize the existing weekly-style schedule behavior used in settings. If non-weekly cycles cannot be represented accurately from existing calendar context, they should be skipped rather than guessing.

All calculations should use Luxon-based date handling, matching repository date conventions.

## Client Data Flow

`useCalendarData` should parse and return both `events` and `dailyRequirements`. `CalendarView` should combine `dailyRequirements` with actual completed work period minutes already present in the returned events.

The combined per-day structure should include:

- `expected`: required minutes from policy.
- `actual`: summed work-period duration minutes for that date.
- `delta`: `actual - expected`.
- `status`: `met`, `over`, `under`, or `missing`.

There is no `8h` fallback. A date without a policy requirement should not show any requirement or status.

## UI Behavior

In day and week views, each visible day should show a compact summary in the calendar header area. The summary should display the required time, such as `8:00h`, and if work exists, show whether the user is over or under, such as `+0:07h` or `-0:31h`. The visual treatment should follow the provided reference: restrained text, tabular numbers, and a thin top status border or equivalent unobtrusive status marker.

Status colors:

- `met` and `over`: green, because the requirement is satisfied.
- `under`: red, because recorded work is below requirement.
- `missing`: muted, because there is a requirement but no completed work yet.

In year view, replace the current hardcoded expected hours with policy-derived requirements. Keep the small status-dot style, but only render it for dates that have a policy requirement.

The UI must remain readable in light and dark themes and should not make schedule requirement markers clickable unless there is a real interaction behind them.

## Error Handling

If policy lookup or requirement calculation fails, the API should still return calendar events and an empty `dailyRequirements` object, while logging the server-side error. Calendar event loading should not fail solely because policy requirement metadata is unavailable.

The client should treat missing or invalid requirement entries as no requirement for that date.

## Testing

Add API tests for:

- No effective schedule policy returns empty requirements.
- Simple weekday schedule returns expected weekday requirements and omits weekends.
- Detailed schedule returns configured per-day requirements.
- Existing authorization behavior remains unchanged for employee-scoped requests.

Add client/unit coverage for the daily hours aggregation where practical:

- Actual work minutes are summed by date.
- Status and delta are derived from policy requirements.
- No status is shown without a policy requirement.

## Out Of Scope

This design does not add new policy editing behavior, overtime approvals, absence-aware requirement reduction, or multi-employee requirement summaries. It also does not change existing work-period event rendering or details dialogs.

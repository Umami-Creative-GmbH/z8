# Absence-Adjusted Work Balance Design

## Purpose

Extend the existing calendar work-hours summaries so approved absences reduce required hours, and add an all-time over/undertime balance that employees can see on `/time-tracking` and scoped users can see on `/calendar`.

The visible day, week, and month summaries should remain live and bounded to the requested calendar range. The unbounded all-time balance should be materialized by the worker every 3 hours to avoid expensive page-load aggregation.

## Current Context

`/calendar` already fetches events through `/api/calendar/events`. The route returns `events`, `dailyRequirements`, and `dailyActualMinutes`. `CalendarView` uses `buildDailyWorkHoursSummaries` to derive actual, required, delta, and status values for visible calendar summaries.

Policy requirements are generated in `apps/webapp/src/lib/calendar/work-policy-requirements.ts` from the selected employee's effective work policy. Month view, week/day strips, and year view all consume those derived daily summaries.

Absence events are loaded in `apps/webapp/src/lib/calendar/absence-service.ts`. Absence records include status plus `startPeriod` and `endPeriod` values in the database, which are needed for full-day and partial-day reductions.

The app already has a BullMQ worker process with repeatable cron jobs in `apps/webapp/src/worker.ts` and a central registry in `apps/webapp/src/lib/cron/registry.ts`. New recurring work should use this registry.

## Approved Approach

Use a hybrid model:

- Keep visible-range calendar summaries live.
- Adjust visible-range required minutes by approved absences only.
- Add a materialized employee work-balance table for all-time totals.
- Refresh the materialized balance from a new `cron:work-balance` worker job every 3 hours.
- Read the materialized all-time balance in `/calendar` and `/time-tracking` instead of calculating it inline.

This avoids unbounded aggregation on user-facing requests while keeping currently viewed calendar ranges immediately useful.

## Absence-Adjusted Requirements

`getDailyWorkRequirementsForEmployee` should continue to produce daily policy requirements for a requested date range, but it should apply approved absence reductions for the same employee and organization before returning the final `dailyRequirements` object.

Only approved absences reduce required hours. Pending and rejected absences remain visible as events where applicable, but they do not change required minutes or over/undertime status.

Reduction rules:

- `full_day` absence coverage reduces that day by 100%.
- Half-day absence coverage reduces that day by 50%.
- For multi-day absences, the start date uses `startPeriod`, the end date uses `endPeriod`, and middle dates reduce by 100%.
- Single-day absences reduce 100% when either boundary period is `full_day`, reduce 100% when `startPeriod = "am"` and `endPeriod = "pm"`, and reduce 50% when both periods represent the same half day.
- Overlapping approved absences are capped at 100% reduction.
- Required minutes must never be negative.

For example, an 8-hour policy day with an approved full-day vacation returns `0` required minutes. The same day with an approved half-day absence returns `4` required hours.

The reduction logic should live in pure helper functions that accept policy-derived requirements plus approved absence ranges. Calendar range calculations and the all-time worker should use the same helper to avoid divergent business rules.

## Materialized Balance Data Model

Add a table for employee work balances keyed by organization and employee. The table should store:

- `id`
- `organizationId`
- `employeeId`
- `actualMinutes`
- `requiredMinutes`
- `balanceMinutes`
- `computedFromDate`
- `computedThroughDate`
- `computedAt`
- `createdAt`
- `updatedAt`

Add a unique index on `organizationId, employeeId` and normal indexes that support organization-scoped reads. The table is system-derived data, not a tenant-specific configuration setting.

`balanceMinutes` is always `actualMinutes - requiredMinutes`. Positive values mean overtime or surplus time. Negative values mean undertime.

## Worker Job

Add `cron:work-balance` to the cron registry with schedule `0 */3 * * *`, running every 3 hours.

The processor should recalculate balances for active employee profiles. For each employee, it should:

- Sum completed work-period minutes for the employee.
- Compute policy-required minutes from the first relevant record date through the current day.
- Apply approved absence reductions with the shared helper.
- Upsert the materialized balance row.

The first relevant record date is the earliest date of either a completed work period or an approved absence for that employee. If an employee has neither, the worker should skip the employee until there is data to summarize. This avoids inventing a new employment-start setting for the first version.

The first version can recalculate full balances per employee during the cron run. The goal is to move this work out of page requests. Incremental accumulation can be added later if full worker recomputation becomes too slow.

The worker should return aggregate result metadata such as organizations processed, employees processed, rows updated, and errors. Failures should flow through the existing `cron_job_execution` tracking.

## Calendar Behavior

The calendar API should continue returning adjusted `dailyRequirements` for the selected visible range. Existing day, week, month, and year summaries should automatically reflect absences because they already consume `dailyRequirements`.

Add the materialized all-time balance to the calendar response or page data when one scoped employee is selected. Managers and admins should only see this metric when the calendar is scoped to a single employee, matching the existing requirement-calculation behavior.

Calendar UI should show the all-time balance near the calendar summary/header area. Suggested display:

- Label: `All-time balance` or `Work balance`.
- Value: signed hours, such as `+12:30h` or `-4:15h`.
- Positive or zero: success/neutral-success styling.
- Negative: destructive styling.
- Helper text from `computedAt`, such as `Updated every 3 hours` or `Last updated 14:30`.

If no materialized row exists, show a quiet fallback such as `Balance not calculated yet`. Do not run the all-time calculation inline.

## Time-Tracking Behavior

`/time-tracking` should load the current employee's materialized work balance in `getTimeTrackingPageData` alongside the existing weekly summary data.

Add a fourth summary card next to Today, This Week, and This Month. It should show the signed all-time balance and the same stale/missing fallback behavior as calendar.

Employees should only see their own balance on `/time-tracking`. Organization and employee scoping should come from the current authenticated employee record.

## Error Handling

Visible calendar summaries should keep loading if absence-adjustment data cannot be fetched. In that case, log the server-side error and fall back to unadjusted policy requirements for the visible range.

The all-time balance should never block page rendering. If the balance row is missing, stale, or cannot be loaded, show fallback copy and keep the rest of the page usable.

Worker job failures should be tracked by existing cron execution tracking. The processor should continue processing other employees when one employee fails and include failures in the job result metadata.

## Security And Multi-Tenancy

Every query must be organization-scoped. Absence adjustment must only consider absences for the same `organizationId` and `employeeId` as the requirement calculation.

The materialized balance table should include `organizationId`, and all reads should filter by both organization and employee where possible. `/time-tracking` reads only the current employee's row. `/calendar` reads only the selected employee's row after the existing calendar employee scoping has been applied.

No tenant-specific balance behavior should come from environment variables.

## Testing

Add unit tests for absence-adjustment helpers:

- Approved full-day absence reduces required minutes to zero.
- Approved half-day absence reduces required minutes by 50%.
- Multi-day absence applies start, middle, and end day rules.
- Overlapping approved absences cap at 100% reduction.
- Pending and rejected absences do not reduce requirements.

Add calendar tests for adjusted visible summaries:

- Daily requirement output reflects approved absences.
- Weekly and monthly totals sum adjusted daily requirements.
- Cross-organization absences are ignored.

Add worker/helper tests:

- Actual, required, and balance minutes are computed correctly.
- Upsert payloads are organization-scoped.
- Employee-level failures are reported without aborting the whole job.

Add UI/component tests where practical:

- Time-tracking renders the fourth all-time balance card.
- Missing balance shows fallback copy.
- Calendar balance metric uses signed formatting and missing-row fallback.

## Out Of Scope

This design does not add user-configurable balance periods, event-triggered recalculation, overtime approval workflows, payroll export behavior, or new absence approval rules. It also does not change how actual work-period minutes are calculated for visible calendar ranges.

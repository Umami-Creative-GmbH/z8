# Personal Workday Timeline Design

## Goal

Add a mobile-first daily timeline to the existing employee time-tracking page. The timeline should help employees understand the selected workday at a glance by showing scheduled shifts, clock activity, break context, absences, pending requests, and warnings such as missing breaks or unapproved edits.

The primary success criterion is daily clarity. The timeline should reduce confusion before payroll without replacing the existing clock-in/out, correction, manual-entry, weekly summary, or table workflows.

## Scope

The first version lives on `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`. It is employee-facing, but the data boundary must be shaped around `{ organizationId, employeeId, date, timezone }` so future manager or admin inspection can be added with explicit authorization.

The first version includes:

- A day picker that defaults to today and supports nearby selected days.
- A chronological daily timeline for the signed-in employee.
- Scheduled shifts for the selected day.
- Clock-ins, clock-outs, active work periods, and completed work periods.
- Break-related context where explicit data exists, and warning rows where only warning data exists.
- Approved and pending absences overlapping the selected day.
- Pending correction, absence, and shift requests affecting the selected day.
- Warning rows and warning summary cards that explain the issue and link to existing flows.

The first version does not include:

- New persisted timeline tables.
- Inline warning resolution flows.
- A manager/admin timeline route.
- A full calendar or weekly planner replacement.

## Architecture

The feature should be implemented as an embedded `PersonalWorkdayTimeline` section on the time-tracking page, placed after the `ClockInOutWidget` and before the weekly summary/table content. The page already loads employee, timezone, active work period, weekly work periods, and translations through `page-data.ts`; the timeline should extend that server-rendered pattern instead of fetching the core timeline from the client.

Create a focused server-side loader, tentatively `getWorkdayTimelineData`, that accepts an internal input containing `organizationId`, `employeeId`, selected date, and timezone. The public time-tracking route continues to use the signed-in employee, but every query must filter by both `organizationId` and `employeeId`.

No new database table is needed. The timeline is a derived view composed from existing sources: `workPeriod`, `timeEntry`, `shift`, `absenceEntry`, `absenceCategory`, existing approval or self-service request helpers, and policy/compliance services where practical.

## Date Handling

The selected date comes from the `date` search param in `YYYY-MM-DD` form. The server interprets it in the employee's effective timezone using Luxon. If the param is missing or invalid, the page falls back to today in that timezone.

The loader computes the selected day's local start and end, then converts timestamp-backed query bounds to UTC/database dates. Logical date records, such as shifts and absences, should use their existing date fields rather than UTC timestamp comparisons. Date handling must follow the repo convention of using Luxon rather than native `Date` arithmetic.

## Timeline Model

The loader should return a presentation-ready model rather than raw database rows. A discriminated union such as `WorkdayTimelineItem` should cover:

- `shift`: scheduled shift window, status, and optional location/subarea when already available.
- `work-period`: actual recorded work block, including start, end, duration, approval status, and whether it is active.
- `break`: explicit break interval if existing data can represent one.
- `absence`: absence entry for the selected date, including category, status, and full-day/partial-day labels.
- `pending-request`: pending correction, absence, or shift request affecting the selected day.
- `warning`: payroll-risk or compliance context such as missing clock-out, pending edit, unapproved change, auto-adjustment, or missing-break-like condition.

Timed items should sort by local start time. All-day absences and day-level warnings should appear above the chronological list. If a warning relates to a specific row, the UI may also render it inline with that row.

## Data Flow

The time-tracking page reads the selected date from search params and passes it into `getTimeTrackingPageData`. The page data loader gets the current employee and user settings, resolves the timezone, and fetches the timeline in parallel with the existing active period, weekly work periods, summary, and translations.

The timeline loader fetches these sources in parallel where possible:

- `workPeriod` rows for the employee, organization, and selected day, including `approvalStatus`, `pendingChanges`, `wasAutoAdjusted`, `autoAdjustmentReason`, and start/end timestamps.
- `shift` rows for published assigned shifts on the selected logical date.
- `absenceEntry` rows joined with `absenceCategory` where the selected logical date overlaps the absence range.
- Pending self-service requests, using `getSelfServiceRequests` or a narrower helper if needed.
- Warning inputs from existing policy, break, or change-policy services where they fit the selected day.

If richer warning services are not practical in the first implementation pass, v1 should still derive conservative warnings from existing fields such as `approvalStatus === "pending"`, non-empty `pendingChanges`, `wasAutoAdjusted`, active periods without clock-out, and missing break evidence where available.

## UI Design

The main UI should be a mobile-first card titled `Workday timeline` or similar. It should use a compact day picker with previous day, selected date, today, and next day controls. On desktop, the control can stay compact; the feature is a daily clarity view, not a scheduler.

Rows should be text-first with restrained status color. Icons may be used to speed scanning, but labels and times must carry the meaning. Warning rows should explain the issue in plain language and link to the existing flow, such as time correction, `my-requests`, absences, or request status. V1 should not add inline fixes.

Empty states should distinguish between a genuinely empty day and a day with no scheduled shift or recorded activity yet. Timeline failure should show a non-destructive `Timeline unavailable` alert while preserving the existing clock widget and table.

## Error Handling

If the signed-in user has no employee profile, the existing `NoEmployeeError` behavior remains unchanged. If timeline loading fails while the rest of the time-tracking page can load, the page should still render clock-in/out and weekly content, plus a non-blocking timeline error state.

Invalid date params fall back to today in the employee timezone. Days with no records render an empty state. Unknown or unsupported pending request types should either be shown as generic pending requests or omitted, but they must not break the whole timeline.

## Security And Multi-Tenancy

Every timeline query must filter by `organizationId` and `employeeId`. The initial route must only load the signed-in employee's own timeline. Future manager/admin timeline access must be added through a separate authorization wrapper that checks org-level permissions before calling the shared loader for another employee.

The timeline must not expose cross-organization shift, absence, approval, or request data. Warning links should route to existing authorized pages and actions rather than bypassing established permission checks.

## Testing

Tests should cover:

- Selected date parsing and invalid date fallback.
- Employee timezone day bounds.
- Multi-tenant filtering by both `organizationId` and `employeeId`.
- Timeline normalization and ordering across shifts, work periods, absences, pending requests, and warnings.
- Warning derivation for pending edits, unapproved changes, active periods without clock-out, and auto-adjusted or missing-break-like records.
- Component rendering for populated, empty, warning-heavy, active-work-period, invalid-date, and unavailable states.

The feature should be verified so it does not regress existing clock-in/out, correction, manual-entry, weekly summary, or time entries table behavior.

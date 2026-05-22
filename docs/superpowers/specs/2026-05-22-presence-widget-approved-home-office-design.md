# Presence Widget Approved Home Office Exceptions

## Context

The dashboard presence widget now calculates home-office days left and office days still required from the employee's effective presence policy. It does not yet account for additional home-office days that an employee requested and a manager approved for the current evaluation period.

Home office requests are modeled as absence entries whose category type is `home_office`. The relevant source tables are `absenceEntry` and `absenceCategory`; requests are organization-scoped through `organizationId`, tied to an employee, and approved through `status = "approved"`.

## Goal

When an employee has approved additional home-office days in the current presence period, the presence widget should treat those dates as approved exceptions before calculating remaining office obligations.

## Non-Goals

- Do not change how employees request home office.
- Do not change approval workflows.
- Do not change clock-in location tagging.
- Do not add tenant-specific environment variables or external services.
- Do not redesign the widget UI beyond using corrected counts.

## Recommended Approach

Load approved home-office request dates in `getPresenceStatus` for the same employee, active organization, and presence evaluation period that the widget already uses. Pass those dates into `calculatePresenceStatusSummary` as a pure input, so policy math stays server-side and testable.

This keeps organization authorization in the server action, keeps the widget free of policy rules, and lets tests cover the fixed-day and minimum-count semantics without database setup.

## Data Flow

1. `getPresenceStatus(employeeId)` validates the employee belongs to the caller's active organization.
2. It resolves the effective work policy and current presence period.
3. It loads work periods in that period as it does today.
4. It also loads approved home-office absence entries whose category type is `home_office`, employee id matches, organization id matches, status is `approved`, and date range overlaps the presence period.
5. It expands overlapping approved request ranges into distinct ISO dates within the presence period.
6. It passes those dates to `calculatePresenceStatusSummary`.

## Counting Rules

Approved additional home-office dates are policy exceptions, not normal worked office dates.

For `fixed_days` policies:

- If an approved home-office date falls on a required fixed office weekday, that date should not contribute to `officeDaysRequiredLeft`.
- The approved date should be treated as home-office-allowed for the period, whether or not the employee has already clocked work on that date.
- Required fixed office dates outside approved exceptions keep their existing behavior.

For `minimum_count` policies:

- Approved home-office dates reduce the available pool of dates that can be required for office.
- `requiredOfficeDays` should be capped by scheduled workdays in the period minus approved home-office exception dates.
- `officeDaysRequiredLeft` should use the adjusted required office day count, so the widget does not tell an employee they still owe office attendance on a manager-approved exception.

For both modes:

- Dates are deduplicated.
- Only approved requests count. Pending and rejected requests do not affect the widget.
- Date expansion uses Luxon and logical calendar dates; native `Date` remains limited to database boundaries.
- Approved dates outside the current evaluation period are ignored.

## Error Handling

- If no approved home-office entries exist, behavior remains unchanged.
- If a malformed or unexpected absence range is encountered, ignore that entry rather than failing the widget.
- Cross-organization data must remain blocked by the existing active-organization check and query filters.
- Missing or disabled presence policy still hides the widget as before.

## Testing

Pure helper tests should cover:

- Fixed-day policy where an approved home-office request on a required office day reduces `officeDaysRequiredLeft`.
- Minimum-count policy where approved home-office dates reduce the required office-day cap.
- Deduplication of multi-day or overlapping approved home-office dates.
- Pending or rejected request dates are not passed into the helper or do not affect counts.

Server wiring tests should cover:

- Querying only approved `home_office` absence entries for the active organization and employee.
- Expanding absence ranges only inside the current presence period.

Component tests only need updates if visible copy changes. The existing stat rendering can remain unchanged because the corrected values arrive from the server summary.

## Implementation Boundary

Focused files:

- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`
- Existing server action tests if a suitable fixture pattern exists

No unrelated absence, approval, compliance, or dashboard refactor should be included.

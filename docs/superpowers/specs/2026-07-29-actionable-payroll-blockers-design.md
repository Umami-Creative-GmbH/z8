# Actionable Payroll Blockers

## Goal

Make payroll blockers identifiable and actionable without granting payroll
officers new timekeeping or approval permissions.

## Problem

The payroll workspace currently renders only each blocker's generic label.
Multiple records therefore appear as repeated `Missing clock-out` or
`Pending time correction` lines with no employee, date, or resolution path.
Users cannot determine which record is blocked or where to resolve it.

## Blocker Model

Each `PayrollBlocker` will retain its organization-scoped record ID and employee
ID and add:

- An employee-local logical date in `YYYY-MM-DD` format.
- An optional employee-local time for instant-based blockers.

Employee names remain sourced from the existing payroll employee summary and
are joined in the UI by `employeeId`. Record IDs are not displayed.

Missing clock-out and pending time-correction instants will be converted using
the affected employee's effective timezone. Pending absence dates will use the
absence record's employee-local logical start date. The viewer's timezone will
not determine payroll meaning.

## Data Flow

1. The blocker query remains filtered by `organizationId` and the payroll
   officer's allowed employee IDs.
2. It loads the source instant or logical date required for each blocker.
3. Effective timezone context is resolved only for affected, organization-
   scoped employees.
4. Instant-based blockers are converted to employee-local date and time values.
5. The payroll summary returns safe blocker display metadata.
6. The client joins blocker employee IDs to already-scoped employee names and
   renders contextual actions.

## User Interface

Replace the blocker alert's generic bullet list with compact blocker rows. Each
row shows:

- Employee name, falling back to employee number or ID through the existing
  payroll employee display rules.
- Localized blocker type.
- Employee-local date and, when available, time.
- A contextual action button.

Actions:

- `missing_clock_out`: open `/calendar/{employeeId}?date=YYYY-MM-DD`.
- `pending_time_correction`: open `/approvals/inbox?types=time_entry`.
- `pending_absence`: open `/approvals/inbox?types=absence_entry`.

Repeated blockers remain separate rows and can be distinguished by employee and
date/time. Existing blocker totals and employee blocked/ready states remain
unchanged.

## Calendar Deep Link

The selected-employee calendar route will accept a `date` search parameter.
Only a valid ISO logical date is accepted. A valid date initializes the calendar
to that employee-local date; an absent or invalid value falls back to the
existing employee-local current date.

The calendar's existing organization and employee authorization remains the
source of truth. The query parameter never bypasses employee access checks.

## Authorization

This change grants no new permissions.

- Calendar access remains controlled by the existing authorized employee
  context resolver.
- Approval actions remain controlled by the approval inbox and its existing
  decision permissions.
- Payroll access scope remains organization-scoped and employee-scoped.
- A user who cannot resolve a blocker will see the destination's existing
  authorization behavior rather than receiving elevated payroll permissions.

## Error Handling

- Missing employee display data falls back through existing payroll naming.
- Invalid or missing timezone settings use the existing effective-timezone
  fallback chain.
- Invalid calendar date parameters fall back to the employee-local current date.
- Missing blocker display metadata must not remove the blocker or mark payroll
  ready; the row uses a safe fallback label.

## Testing

- Missing clock-out blockers include the employee-local date/time derived from
  the source instant.
- Pending time-correction blockers include employee-local display metadata.
- Pending absence blockers retain their logical start date.
- Timezone conversion covers a non-UTC employee and a date-boundary instant.
- Blocker queries and timezone lookups remain organization-scoped.
- Repeated blocker rows display employee identity and distinct date/time data.
- Every blocker type renders the correct action URL.
- A valid calendar `date` parameter initializes the requested date.
- An invalid calendar `date` parameter falls back safely.
- Existing payroll totals, blocker counts, filters, and readiness behavior remain
  unchanged.

## Non-Goals

- Editing or closing time records directly from payroll.
- Granting payroll officers manager, calendar-edit, or approval permissions.
- Automatically approving corrections or absences.
- Changing payroll readiness rules.

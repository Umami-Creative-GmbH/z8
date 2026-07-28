# Payroll Absence Day Details Design

## Goal

Make the combined PDF downloaded from `/payroll` suitable for manual documentation in another legal system by showing the exact approved absence dates for each employee.

## Scope

The combined payroll PDF will list every approved absence category by exact recorded calendar date. Full-day and partial-day absences will be distinguished as `Full day`, `AM`, or `PM`.

This change applies only to the combined PDF downloaded from `/payroll`. It does not change DATEV, Lexware, or Sage files, and it does not change Personio, SuccessFactors, Workday, or other connector payloads.

## Existing Behavior

The payroll workspace summary currently reduces approved absences to total days per employee and category. The PDF displays those totals in the employee table but does not retain or display the dates represented by each absence record.

The underlying payroll summary query already reads approved canonical absence records, including their date range and first/last day periods. No database schema change is required.

## Data Model

Extend the payroll workspace summary with day-level absence details. Each detail contains:

- employee ID
- absence category ID and name
- logical ISO calendar date (`YYYY-MM-DD`)
- day period: `full_day`, `am`, or `pm`

These dates are logical absence dates. They must not be derived from the payroll officer's or another viewer's timezone.

Existing absence totals remain available for the employee totals table. Totals and details must be derived from the same approved absence rows so that the two representations cannot disagree.

## Date Expansion

An approved absence record is expanded into one detail for each recorded calendar date that overlaps the selected payroll period.

- A same-day full-day absence produces one `full_day` detail.
- A same-day partial absence produces one `am` or `pm` detail.
- For a multi-day absence, the first date retains the record's starting period, the last date retains its ending period, and intermediate dates are `full_day`.
- Expansion includes every recorded calendar date, including weekends, holidays, and employee non-working days. It does not recalculate the record against work schedules.
- Details outside the selected payroll period are excluded.
- An invalid range whose end precedes its start produces no details.

## PDF Structure

Keep the existing PDF header, metrics, blocker summary, and employee totals table. Add an `Absence details` section after the totals table.

The section is grouped by employee. Each employee group contains rows with:

- date
- absence category name
- `Full day`, `AM`, or `PM`

Employee groups are sorted by employee name. Rows within each group are sorted by date and then category name for deterministic output. Employees without approved absences are omitted from the detail section. If the selected scope has no approved absences, the PDF states that there are no approved absences for the selected period.

The section may flow across multiple pages. Employee headings and absence rows should remain compact and audit-readable, while avoiding a wide date matrix that would not fit monthly or custom periods.

## Authorization And Tenant Isolation

The existing `/payroll` server action remains the authorization boundary. It resolves the payroll officer's permitted employee IDs server-side and intersects them with requested filters before building the summary.

All absence queries remain filtered by `organizationId`, approved status, selected period, and the resolved employee IDs. Day-level details must not expose employees or absence records outside that scope.

## Error Handling

- Invalid or reversed absence ranges produce no day-level rows rather than misleading dates.
- An empty approved-absence result is valid and renders the explicit empty message in the PDF.
- PDF generation failures continue through the existing payroll download error path and do not clear the selected period or employee filters.
- No connector behavior changes, so connector-specific validation and errors remain unchanged.

## Documentation

Update the payroll export guide to explain that payroll officers can use `/payroll` to download a combined PDF containing approved absence dates and full-day or AM/PM detail for manual documentation in downstream legal systems.

The guide must distinguish this combined PDF from configured payroll connector exports, whose formats and payloads are unchanged.

## Testing

Implementation follows red-green-refactor and covers:

- same-day full-day expansion
- same-day AM and PM expansion
- multi-day expansion with first and last partial-day boundaries
- clipping details to the selected payroll period
- inclusion of all recorded calendar dates, including weekends
- rejection of reversed ranges
- deterministic employee, date, and category ordering
- approved absences only
- organization and payroll-access scope enforcement
- preservation of category totals from the same source details
- PDF generation with populated and empty absence-detail sections
- unchanged payroll connector output behavior through focused regression tests where needed

## Non-Goals

- Showing day-level absence details in the `/payroll` web table.
- Changing absence approval or editing workflows.
- Excluding weekends, holidays, or non-working days from recorded absence ranges.
- Exporting sick-detail metadata, notes, medical information, or approval history.
- Modifying file-based or API-based payroll connector contracts.
- Adding a database migration.

# Payroll Absence Day Details Design

## Goal

Make the combined PDF downloaded from `/payroll` suitable for manual review or entry in another system by showing the exact approved absence dates for each employee.

## Scope

The combined payroll PDF will list every approved absence category by exact recorded calendar date. Absences will be distinguished as `Full day`, `AM`, `PM`, or `Partial day`. `Partial day` identifies an explicitly timed same-day interval that crosses from AM into PM.

This change applies only to the combined PDF downloaded from `/payroll`. It does not change DATEV, Lexware, or Sage files, and it does not change Personio, SuccessFactors, Workday, or other connector payloads.

## Existing Behavior

The payroll workspace summary currently reduces approved absences to total days per employee and category. The PDF displays those totals in the employee table but does not retain or display the dates represented by each absence record.

The underlying payroll summary query already reads approved canonical absence records, including their date range and first/last day periods. No database schema change is required.

## Data Model

Extend the payroll workspace summary with day-level absence details. Each detail contains:

- employee ID
- absence category ID and name
- logical ISO calendar date (`YYYY-MM-DD`)
- day period: `full_day`, `am`, `pm`, or `partial_day`

These dates are logical absence dates. They must not be derived from the payroll officer's or another viewer's timezone.

Existing absence totals remain available for the employee totals table. Totals and details must be derived from the same approved absence rows so that the two representations cannot disagree.

## Date Expansion

An approved absence record is expanded into one detail for each recorded calendar date that overlaps the selected payroll period.

- A same-day full-day absence produces one `full_day` detail.
- A same-day partial absence produces one `am` or `pm` detail.
- A same-day absence with explicit clock times uses those times when its stored endpoint periods are generic AM placeholders: an interval beginning at or after 12:00 is `pm`, one ending at or before 12:00 is `am`, and one crossing 12:00 is `partial_day`.
- For a multi-day absence, the first date is `pm` only when the record starts in the PM; an AM or full-day start produces `full_day` coverage for that date.
- The last date is `am` only when the record ends in the AM; a PM or full-day end produces `full_day` coverage for that date.
- All interior dates are `full_day`. Dates that become range boundaries only because the record is clipped to the selected payroll period are also `full_day` unless they are an original record endpoint.
- Expansion includes every recorded calendar date, including weekends, holidays, and employee non-working days. It does not recalculate the record against work schedules.
- Details outside the selected payroll period are excluded.
- An invalid range whose end precedes its start produces no details.

## PDF Structure

Keep the existing PDF header, metrics, blocker summary, and employee totals table. Add an `Absence details` section after the totals table.

The section uses a compact table with columns for:

- employee identity
- date
- absence category name
- `Full day`, `AM`, `PM`, or `Partial day`

Rows remain contiguous and grouped by employee, with the employee's identity repeated on every row so that each row retains its context across page breaks. Employee groups are sorted by employee name, and rows within each group are sorted by date, category name, and period for deterministic output. Employees without approved absences are omitted from the detail section. If the selected scope has no approved absences, the PDF displays the unchanged message: `No approved absences for the selected period.`

The compact table may flow across multiple pages. Its fixed table headers repeat on continuation pages, while the contiguous rows and repeated employee identity keep the report audit-readable without the pagination overhead of separate employee cards or headings.

## Authorization And Tenant Isolation

The existing `/payroll` server action remains the authorization boundary. It resolves the payroll officer's permitted employee IDs server-side and intersects them with requested filters before building the summary.

All absence queries remain filtered by `organizationId`, approved status, selected period, and the resolved employee IDs. Day-level details must not expose employees or absence records outside that scope.

## Error Handling

- Invalid or reversed absence ranges produce no day-level rows rather than misleading dates.
- An empty approved-absence result is valid and renders the explicit empty message in the PDF.
- PDF generation failures continue through the existing payroll download error path and do not clear the selected period or employee filters.
- No connector behavior changes, so connector-specific validation and errors remain unchanged.

## Documentation

Update the payroll export guide to explain that payroll officers can use `/payroll` to download a combined PDF containing approved absence dates and `Full day`, `AM`, `PM`, or `Partial day` detail for manual review or entry in downstream systems.

The guide must distinguish this combined PDF from configured payroll connector exports, whose formats and payloads are unchanged.

## Testing

Implementation follows red-green-refactor and covers:

- same-day full-day expansion
- same-day AM and PM expansion
- explicitly timed same-day AM, PM, and cross-noon classification
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

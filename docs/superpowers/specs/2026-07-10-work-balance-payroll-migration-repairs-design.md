# Work Balance, Payroll, and Migration Repairs Design

## Goal

Correct employee-local calendar boundaries in work balances and payroll exports, recover the skipped sick-detail schema change, and replace fabricated historical timezone values with clearly identified inferences.

## Scope

This change consists of three independent repairs delivered and verified in order:

1. Employee-local boundaries for work balances and payroll exports.
2. An idempotent recovery migration for `0021_sick_detail`.
3. DST-aware historical timezone inference plus recovery for values fabricated by `0036_time_entry_timezone_capture`.

The implementation will not modify or revert unrelated concurrent work.

## Calendar Boundary Model

Calendar dates such as `2026-05-01` are logical dates in the selected employee's effective timezone. They are not UTC dates. The effective timezone follows the existing resolution order:

1. A valid non-default employee user setting.
2. A valid non-default organization timezone.
3. UTC.

Database timestamps remain canonical UTC instants. Code converts the employee-local start and end of each logical date to UTC before constructing timestamp filters.

### Work Balances

Work-balance refresh resolves the target employee's effective timezone with both employee ID and organization ID constraints. It uses that timezone for:

- Monthly period start and end boundaries.
- Calculation-start boundaries.
- The last completed employee-local day used as the refresh cutoff.
- Daily work-requirement generation and date keys.

The aggregation query remains organization-scoped and employee-scoped. Durations continue to come from canonical UTC work-period instants.

### Payroll Exports

Payroll date inputs remain logical ISO dates. An export may contain employees in different timezones, so a single organization-wide UTC interval is insufficient.

The payroll data fetcher will load organization-scoped employee timezone context and derive a UTC interval for each employee. It may use a safe outer UTC envelope for the database query, but every fetched record must then pass exact employee-local overlap filtering and clipping. `countWorkPeriods` must reuse the same boundary calculation and exact filtering so its sync/async decision matches the records that can be exported.

Absence records remain based on logical absence dates. Any canonical timestamp overlap checks used to fetch them must use the same employee-local date interpretation rather than the server or viewer timezone.

## Sick Detail Recovery

Migration `0021_sick_detail` has a `when` earlier than `0020_drop_organization_fiscal_year`, so databases already advanced past `0020` may skip it. Editing only the old journal timestamp cannot repair those databases.

A new journaled migration named `0051_sick_detail_recovery` will have a `when` greater than every existing entry. It will:

- Create the `sick_detail` enum only when it does not exist.
- Add `absence_entry.sick_detail` only when it does not exist.
- Preserve existing schema and data when rerun.

The old migration remains available for databases that already recorded it; the recovery migration guarantees the final schema independently of that history.

## Historical Timezone Repair

The fixed `Europe/Berlin` and `+120` values in migration `0036` are not valid historical evidence. Historical entries will instead be inferred from the employee's current effective timezone evaluated at each entry's canonical UTC timestamp. Luxon remains the application date-time library; PostgreSQL timezone rules are used inside SQL migrations.

Inference follows the effective-timezone fallback order and calculates the event-time offset, including daylight-saving transitions. Inferred rows use an explicit provenance value, `historical_inference`, so consumers can distinguish inference from browser or manager capture.

Fresh migration behavior will avoid assigning a fixed Berlin offset. A later migration named `0052_time_entry_timezone_recovery` will repair databases that already ran the old migration. It targets the distinctive old migration values:

- `timezone_source = 'backfill'`
- `timezone = 'Europe/Berlin'`
- `utc_offset_minutes = 120`

It limits recovery to rows created no later than the original migration timestamp, recomputes timezone and offset from the employee and organization context, and marks the source as `historical_inference`. Legitimate browser, user-setting, and manager-captured rows are untouched.

This cannot reconstruct travel locations or historical settings changes. The repaired values are explicitly labeled as inference rather than represented as observed audit data.

## Error Handling

- Invalid or absent saved timezone names fall through to a valid organization timezone and then UTC.
- Employee timezone lookups are constrained by `organizationId`; a missing employee produces no cross-tenant fallback.
- Payroll records without valid scoped employee context are excluded rather than interpreted in the viewer's timezone.
- Recovery migrations use conditional DDL and can safely run whether the original migration ran fully, partially, or not at all.

## Testing

Implementation follows red-green-refactor for each repair.

### Boundary Regression Tests

- A New York work-balance month starts at `04:00Z` during daylight time and ends at the next month's `03:59:59.999Z`.
- A calculation-start date uses the same employee-local conversion.
- Daily requirements receive the employee timezone and matching UTC bounds.
- The completed-day cutoff follows the employee-local calendar.
- Payroll includes and clips late-evening records according to each employee's timezone.
- Payroll counting uses the same exact inclusion rules as export fetching.
- A multi-employee export handles different timezones without assigning one employee's boundaries to another.

### Migration Regression Tests

- `0051_sick_detail_recovery` exists, is journaled after all prior entries, and contains idempotent enum and column creation.
- Fresh timezone migration SQL contains no fixed Berlin or `120` fallback.
- `0052_time_entry_timezone_recovery` exists after `0051`, targets only the old fabricated signature, computes offsets at each entry timestamp, and records inferred provenance.
- Schema and TypeScript source types accept `historical_inference` while all current write paths still require a concrete offset and timezone capture.

## Non-Goals

- Reconstructing historical travel locations.
- Reconstructing prior user-setting changes that were never stored.
- Changing canonical UTC timestamp storage or duration calculations.
- Refactoring unrelated date/time code.

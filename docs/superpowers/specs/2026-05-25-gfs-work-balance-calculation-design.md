# GFS Work Balance Calculation Design

## Context

The current work balance refresh job runs every three hours through `cron:work-balance`. It selects active employees with missing, dirty, or stale balances, but each selected employee is recalculated from their first completed work period through today. That means the batch is not selecting every employee every time, but dirty or stale employees still pay an all-history scan cost.

The existing `employee_work_balance` table already stores aggregate totals and dirty metadata, including `dirty_from_date`, but `computeEmployeeWorkBalance` ignores the dirty range and rebuilds actual and required minutes for the full historical range.

## Goal

Replace all-time recalculation with a tiered, GFS-style balance model:

- Keep the last three months as the hot window and recalculate it from detailed source data when needed.
- Store older history in monthly aggregate buckets.
- Store yearly aggregate buckets derived from closed monthly buckets.
- Keep the current `employee_work_balance` row as the fast read model for UI consumers.
- Add an admin/owner control on `/settings/employees/:id` to force a complete recalculation for one employee.

The hot window is calendar-month based, not a rolling 90-day interval. On any date in May, the hot window is March 1 through today. February and older months are eligible for closed monthly aggregation.

## Data Model

Add a new period aggregate table, tentatively named `employee_work_balance_period`.

Columns:

- `id`
- `organization_id`
- `employee_id`
- `period_type`: `month` or `year`
- `period_start`: date, normalized to the first day of the month or year
- `period_end`: date, normalized to the last day of the month or year
- `actual_minutes`
- `required_minutes`
- `balance_minutes`
- `computed_at`
- `is_closed`
- `is_dirty`
- `dirty_from_date`
- `refresh_requested_at`
- `last_error`
- `created_at`
- `updated_at`

Indexes and constraints:

- Unique index on `organization_id`, `employee_id`, `period_type`, `period_start`.
- Composite foreign key on `employee_id`, `organization_id` to enforce tenant consistency.
- Index on `organization_id`, `period_type`, `period_start` for maintenance jobs.
- Index on `is_dirty`, `refresh_requested_at` for batch selection.

The existing `employee_work_balance` table remains the current read model. Its totals should be computed as historical closed buckets plus the live three-month window.

## Calculation Model

The balance calculation is split into three tiers.

Hot tier:

- Covers the three-month hot window.
- Uses UTC calendar months: current month plus the previous two months.
- Recomputed from `work_period`, work policy requirements, absences, and assigned holidays.
- Used for recent corrections and normal clock-out updates.

Monthly tier:

- Covers months older than the hot tier.
- Stored as one aggregate per employee per month.
- Can be reopened and recomputed when an old correction, absence, holiday, or policy assignment affects that month.

Yearly tier:

- Covers years with closed monthly buckets.
- Derived from monthly bucket sums, not from raw work periods.
- Updated whenever any month in that year is recomputed.

The current displayed balance is:

```text
sum(closed yearly/monthly history) + recomputed hot-window balance
```

The implementation should avoid double-counting. If yearly buckets are used for a year, do not also include monthly buckets from the same year in the final aggregate. A simple first implementation can sum monthly buckets plus the hot window, then maintain yearly buckets for reporting and future optimization.

## Worker Behavior

The three-hour job should change from all-history employee recalculation to dirty-range processing.

Selection:

- Select employees with missing read-model rows.
- Select employees whose read model or period buckets are dirty.
- Select employees whose hot window is stale for the current UTC date.
- Keep the existing batch limit behavior.

Processing:

- Determine the earliest affected date from `dirty_from_date`, missing periods, stale hot window, or force-recalculation metadata.
- If the affected date is inside the hot window, recompute only the hot window and update `employee_work_balance`.
- If the affected date is before the hot window, recompute each affected closed month, update affected yearly buckets, then recompute the hot window and update `employee_work_balance`.
- At month boundary, close the month that just left the hot window by materializing its monthly bucket.
- Only perform a full raw-history scan for bootstrap, missing aggregate repair, or explicit force recalculation.

## Dirty Marking

Existing dirty marking should continue to use the earliest known affected date.

Examples:

- Clock-out marks dirty from the work period start date.
- Manual time entry or correction marks dirty from the changed period date.
- Approved absence marks dirty from the absence start date.
- Employee start-date change marks dirty from the earlier of old and new start date.
- Organization-level work policy changes mark affected employees or period buckets dirty from the effective policy date when known. If the effective date is unknown, mark from the oldest relevant open period.

Dirty marking should never require immediate recalculation in the request path. It should only enqueue or flag work for the worker.

## Admin Force Recalculation

Add an admin/owner-only action to `/settings/employees/:id` that forces a complete recalculation for that employee.

UI behavior:

- Place the control in an admin maintenance or danger-zone style section on the employee detail page.
- Label it clearly, for example: `Recalculate work balance`.
- Explain that it rebuilds historical monthly/yearly aggregates and the current balance.
- Require confirmation before triggering.
- Show queued/running/success/failure state from the worker metadata when available.

Server behavior:

- Require the actor to be an owner or admin in the same organization as the employee.
- Scope all reads and writes by `organization_id` and `employee_id`.
- Mark all balance periods for that employee dirty, or create a dedicated recalculation request row if that proves cleaner during implementation.
- Set the employee read model dirty from the first relevant date.
- Enqueue or rely on the next `cron:work-balance` run to perform the rebuild.
- Do not run the full rebuild synchronously from the server action.

Audit behavior:

- Log who requested the recalculation, for which employee, and when.
- Preserve the latest worker error in balance metadata so admins can see failed recalculations.

## Migration And Backfill

Migration should be safe for production databases.

Steps:

1. Add the period aggregate table and indexes.
2. Keep current `employee_work_balance` reads working.
3. Update the worker to bootstrap missing period buckets in batches.
4. During bootstrap, use existing all-time computation only as a fallback and prefer month-by-month materialization.
5. Once period buckets exist, update read-model totals from buckets plus the hot window.

The migration must follow the repository rule that new Drizzle journal entries use a `when` value greater than prior entries. If an older migration could be skipped in production, add a later idempotent recovery migration instead of editing only the old journal entry.

## Error Handling

- A failed employee recalculation should not fail the whole batch.
- Store the error on the affected read model or period bucket.
- Keep dirty state when a newer refresh request arrives while a worker is processing.
- Admin-triggered recalculation should surface queued or failed state without blocking the UI.

## Testing

Unit tests:

- Hot-window calculation only reads the last three months.
- Dirty date inside the hot window does not recompute old months.
- Dirty date before the hot window recomputes only affected months plus related yearly buckets.
- Month-boundary processing closes the month that leaves the hot window.
- Aggregate read model avoids double-counting monthly and yearly tiers.
- Force recalculation requires owner/admin permissions and organization scope.

Integration-style tests:

- A historical correction changes the correct monthly bucket and final balance.
- An approved absence in an old month changes required minutes for that month and the yearly summary.
- A work policy change marks the correct employee periods dirty.
- Worker batch continues after one employee fails.

## Open Implementation Notes

- The first implementation should prefer correctness and clear period boundaries over aggressive optimization.
- Yearly buckets can initially be maintained for reporting while the main aggregate sums monthly buckets plus the hot window. This avoids double-counting risk and still removes the expensive all-history scans.
- The hot-window boundary should be UTC date based, matching the current batch cutoff behavior.

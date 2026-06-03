# Team Absences Year Calendar Design

## Goal

Add a year calendar to `/team/absences` so managers and admins can see all team absences across the selected year at a glance. The calendar should default to the current year through the page's existing year default and should preserve the existing table workflow for metrics, sorting, pagination, and recording absences.

## Scope

In scope:

- A team-wide year calendar on `/team/absences`.
- Calendar data scoped to the active organization and the actor's manager/admin permissions.
- Calendar filtering by the selected `teamId` query parameter.
- Inclusion of approved and pending absences.
- Compact day indicators for days with one or more absences.
- Day details listing employee name, category, and status.
- Tests for query scoping and UI behavior.

Out of scope:

- Replacing the existing employee metrics table.
- Month/week/day calendar modes.
- Editing or approving absences directly from the calendar.
- Calendar filtering by search text or table pagination.
- Changing personal `/absences` calendar behavior.

## Confirmed Decisions

- The calendar shows all accessible employees matching the selected team filter.
- Search and pagination do not limit the calendar.
- Approved and pending absences are both shown.
- Days with multiple absences use compact counts plus details instead of rendering every employee directly in the day cell.
- The calendar should be visible by default on `/team/absences`, above the current table.

## Approaches Considered

### A) Dedicated team year calendar above the table (Selected)

Add a new team-calendar query and component to the existing page. The table remains below the calendar.

Pros:

- Keeps the current manager absence workflow intact.
- Gives an immediate year overview without adding tab/view state.
- Avoids forcing team calendar needs into the single-employee calendar component.
- Lets the calendar ignore table pagination while sharing the selected year and team filter.

Cons:

- Adds another server query to the page.
- The page becomes taller, especially on small screens.

### B) Tabbed table/calendar view

Add a `view=calendar|table` query state and default to the calendar view.

Pros:

- Gives the calendar more vertical space.
- Keeps the table hidden when users only need the overview.

Cons:

- Makes metrics and record actions one click away.
- Adds URL and client state for a page that already has several filters.

### C) Extend the existing personal absence year calendar

Reuse `AbsenceYearCalendar` and add employee metadata to its events.

Pros:

- Smaller initial component surface.
- Reuses month layout and weekday preference behavior.

Cons:

- The existing component assumes single-employee semantics and one dominant absence status per day.
- Team days with multiple employees and mixed statuses need different aggregation and details.

## Architecture

Add a focused server query near the existing manager absence actions, for example `getManagerAbsenceCalendar`, that resolves the current actor using the same authorization model as `getManagerAbsenceEmployees`.

The query should:

- Resolve the active organization and actor employee.
- Reject employees who cannot use the manager absence page.
- Apply `organizationId` to every employee and absence condition.
- For managers, restrict employees to those connected through `employeeManagers`.
- For admins, include active employees in the active organization.
- If `teamId` is provided, verify it is one of the actor-visible teams and filter employees by that team.
- Return an empty calendar result for inaccessible team filters instead of leaking team existence.
- Load absences overlapping the selected year, not only absences fully contained in the year.
- Include only `approved` and `pending` absences.

The existing `/team/absences/page.tsx` should load the table data, categories, and calendar data in parallel where practical. The calendar uses the same normalized year as the table so the URL remains the source of truth.

## Data Shape

The calendar result should be purpose-built for display rather than reusing table rows. A compact shape is enough:

```ts
type ManagerAbsenceCalendarEntry = {
	id: string;
	employeeId: string;
	employeeName: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	status: "approved" | "pending";
	category: {
		name: string;
		type: string;
		color: string | null;
	};
};
```

The client component can expand each date range into per-day entries for the selected year and group them by `YYYY-MM-DD`. Use Luxon for date math when clipping absence ranges to the selected year.

## UI

Place a card above `TeamAbsencesTable` with a title such as `Year calendar` and helper text such as `Approved and pending absences for the selected team and year.`

The calendar should render twelve compact months, using the existing week-start preference. Each day cell should show:

- The day number.
- A subtle highlight when at least one approved absence exists.
- A distinct pending indicator when at least one pending absence exists.
- A compact count such as `3` or `3 absent` when people are absent that day.

Details should appear through a tooltip or popover and list each absence on that day with employee name, category, and status. The details should remain readable when approved and pending absences are mixed on the same day.

On mobile, the twelve-month grid can stack into two columns or one column as needed. The existing table remains below for detailed metrics and the `Record absence` action.

## Data Flow

1. `/team/absences` reads `year` and `teamId` from `searchParams`.
2. The page normalizes the year, defaulting to the current local year when absent or invalid.
3. The page loads manager table data and manager calendar data using the normalized filters.
4. The server calendar query authorizes the actor and returns accessible approved/pending absences overlapping the selected year.
5. The client calendar groups returned absences by date and renders aggregate counts.
6. Changing the existing year or team filter updates the URL and refreshes both calendar and table data.

## Permissions

The calendar must follow the same permission rules as manager absence management:

- Employees without manager/admin role cannot access the page.
- Managers can see only employees they manage.
- Admins can see active employees in the active organization.
- Every query condition must include `organizationId` where applicable.
- Inaccessible `teamId` filters must not leak team or employee existence.

## Error Handling

If the table query succeeds but the calendar query fails, the page should still render the existing table and show an inline calendar error card. If both fail due to the same authorization/session issue, the page can reuse the current page-level error behavior.

Expected errors:

- No employee profile for the actor.
- Actor lacks manager/admin access.
- Database query failure.
- Inaccessible team filter.

The inaccessible team case should be treated as an empty calendar result, consistent with the table's current behavior.

## Testing Strategy

Server-side tests should verify:

- Manager calendar data includes only managed employees.
- Admin calendar data includes active employees in the active organization.
- Cross-organization employees and absences are excluded.
- `teamId` filters calendar entries to visible employees on that team.
- Inaccessible `teamId` returns an empty result without leaking data.
- Absences overlapping the selected year are included and clipped for display.
- Rejected absences are excluded.

UI tests should verify:

- The calendar renders on `/team/absences` above the table.
- The selected year is shown and defaults to the current year when no year param is present.
- A day with multiple absences shows an aggregate count.
- Day details include employee name, category, and status.
- Pending and approved absences have distinct indicators.

## Risks and Mitigations

- Risk: calendar data leaks unmanaged or cross-organization employees.
  Mitigation: reuse the manager absence actor resolution and visible-team logic, and test cross-tenant exclusions.
- Risk: the year calendar becomes unreadable for large teams.
  Mitigation: keep day cells aggregate-first and move detailed names into tooltip/popover content.
- Risk: page load becomes slower because the calendar ignores pagination.
  Mitigation: fetch only the selected year, selected team, active employees, and minimal display fields.
- Risk: reusing single-employee calendar behavior creates incorrect team semantics.
  Mitigation: build a dedicated team calendar component while borrowing only layout ideas and week-start behavior.

## Success Criteria

- Managers and admins can open `/team/absences` and immediately see a year calendar for accessible team absences.
- The calendar defaults to the current year through the existing page year default.
- The selected team filter affects both calendar and table.
- Search and pagination affect only the table, not the calendar.
- Approved and pending absences are visible and distinguishable.
- Multi-employee absence days are summarized compactly with readable details.
- Authorization and organization scoping are enforced on every calendar query.

# Year-Specific Holiday Presets Design

## Context

Holiday presets are imported from location/year data, but the current assignment model only allows one active preset assignment per organization, team, or employee. This makes it awkward to set up both the current year and next year so employees can plan future vacations.

The desired behavior is to support multiple year-specific presets, such as `Germany - Bavaria 2026` and `Germany - Bavaria 2027`, with each assigned to the relevant target for its calendar year.

## Goals

- Allow admins to import year-specific holiday presets for current and future years.
- Allow the same organization, team, or employee to have separate preset assignments for different non-overlapping date ranges.
- Keep holiday resolution deterministic: employee override beats team override, team override beats organization default, and date ranges decide which assignment applies for a requested period.
- Preserve organization scoping and org-admin-only management for preset creation and assignment changes.

## Non-Goals

- Do not redesign the full holiday settings area.
- Do not add a visual timeline editor in this iteration.
- Do not make imported presets automatically valid forever.
- Do not change custom holiday assignment behavior.

## Recommended Approach

Use year-specific presets with scheduled assignments.

When importing holidays for a selected year, the import flow creates a preset named with the selected year and location. For example, importing Germany Bavaria for 2027 creates `Germany - Bavaria 2027`.

When the admin chooses to set the imported preset as the organization default, the assignment is created with:

- `effectiveFrom`: January 1 of the selected year
- `effectiveUntil`: December 31 of the selected year

Manual preset assignments also become schedule-aware. An admin can assign one preset for 2026 and another for 2027 to the same organization, team, or employee, provided their effective date ranges do not overlap.

## Data Model

Add a nullable integer `year` column to `holiday_preset`. Imported presets set this value to the selected import year. Manually created presets can leave it empty unless the UI later supports year-specific manual creation.

The current unique index on organization and location must be replaced with a unique index on organization, location, and year. This allows `Germany - Bavaria 2026` and `Germany - Bavaria 2027` to coexist while still preventing duplicate imported presets for the same organization, location, and year.

The existing `holiday_preset_assignment.effective_from` and `holiday_preset_assignment.effective_until` columns are used as the scheduling model.

The existing partial unique indexes that enforce one active assignment per organization/team/employee conflict with this requirement. They need to be replaced with conflict validation that rejects overlapping active assignments for the same target instead of rejecting all second assignments.

No new table is required.

## Application Behavior

The import dialog keeps the existing location, holiday type, and year selection, but generated preset names include the year and saved presets store that year. If the admin imports multiple years for the same location, each year becomes its own preset.

The assignment dialog adds effective date inputs. For year-specific work, it can default to the current calendar year or the selected year when launched from import. Organization defaults, team overrides, and employee overrides all use the same date-range rules.

The assignment list should show effective ranges so admins can see both current and upcoming assignments. The current assignment remains the one whose range includes today. Future assignments are visible but not treated as current until their effective date.

## Holiday Resolution

Absence planning already requests holidays for a date range and filters preset assignments by overlapping effective dates. That behavior should remain the foundation.

When multiple assignments overlap the requested date range at different levels, priority remains:

1. Employee assignment
2. Team assignment
3. Organization assignment

For the same target and same assignment type, overlapping active assignment ranges are invalid and must be rejected at creation time.

## Validation And Errors

Creating an assignment must check for an existing active assignment for the same target whose effective date range overlaps the new range.

Open-ended ranges are treated as unbounded. For example, an assignment with no `effectiveUntil` overlaps any future assignment for the same target unless the new assignment ends before its `effectiveFrom`.

If a conflict exists, the server action returns a clear duplicate-range conflict message, such as: `An assignment already exists for this target in the selected date range`.

## Permissions And Tenancy

All preset and assignment mutations remain organization-scoped. The active organization and actor organization must be enforced server-side, and org-admin access remains required for creating presets or assignments.

Managers may continue to read scoped assignments according to existing holiday-scope rules, but they must not gain broader mutation access.

## Testing

Add server-action tests for assignment conflict detection:

- Allows adjacent year assignments for the same organization target.
- Rejects overlapping assignments for the same organization target.
- Allows the same date range for different targets.
- Preserves employee/team/organization priority behavior.

Add UI or component tests where practical for:

- Import-generated preset names include the selected year.
- Import-created organization default assignments use the selected year range.
- Assignment list renders effective date ranges for current and future assignments.

## Documentation

Update the admin guide to explain that imported holiday presets are year-specific and can be scheduled ahead of time. Include an example for adding current and next year so employees can plan future vacations.

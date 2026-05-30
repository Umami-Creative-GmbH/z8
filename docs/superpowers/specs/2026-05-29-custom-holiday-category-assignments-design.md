# Custom Holiday Category Assignments Design

## Context

`/settings/holidays` currently supports assigning individual custom holidays to an organization, team, or employee through `holiday_assignment`. That makes custom holiday groups awkward: admins must assign every holiday one by one, and newly added holidays in the same category do not automatically apply to the same targets.

Holiday categories already group custom holidays in `holiday.categoryId`. The desired behavior is to assign one custom holiday category to an organization, team, or employee and have every active custom holiday in that category apply automatically.

## Recommended Approach

Add category-level assignments for custom holidays with a new `holiday_category_assignment` table. This matches the user's mental model, avoids duplicating single-holiday assignment rows, and automatically includes future holidays added to an assigned category.

Alternatives considered:

- Expand a category selection into many `holiday_assignment` rows. This avoids a new table but keeps the underlying brittle behavior and misses future category additions without sync logic.
- Convert custom categories into holiday presets. This reuses preset assignment but mixes custom dated `holiday` rows with preset month/day templates, which would make the model harder to understand.

## Data Model

Create `holiday_category_assignment` with the same target shape as `holiday_assignment`:

- `id`
- `categoryId`, referencing `holiday_category.id` with cascade delete
- `organizationId`, referencing `organization.id` with cascade delete
- `assignmentType`, using `holidayPresetAssignmentTypeEnum`
- nullable `teamId`, referencing `team.id` with cascade delete
- nullable `employeeId`, referencing `employee.id` with cascade delete
- `isActive`
- `createdAt`
- `createdBy`
- `updatedAt`

Add indexes for category, organization, team, and employee lookups. Add partial unique indexes that reject duplicate active assignments for the same category and target:

- one active org assignment per category and organization
- one active team assignment per category and team
- one active employee assignment per category and employee

Keep existing `holiday_assignment` rows and actions so current individual holiday assignments continue to work.

## Server Actions

Add category assignment actions next to existing custom holiday assignment actions:

- `getHolidayCategoryAssignments(organizationId)` returns active assignments, scoped for managers like existing assignment queries, with category, team, and employee display data.
- `createHolidayCategoryAssignment({ categoryId, assignmentType, teamId?, employeeId? })` creates an active assignment.
- `deleteHolidayCategoryAssignment(assignmentId)` soft-deletes an assignment by setting `isActive` to false.

Creation and deletion require org-admin employee settings access. Creation validates that the category, team, and employee belong to the active organization and are active where applicable. Cross-org IDs must be rejected before mutation.

## Assignment Reads

`getAssignedHolidaysForEmployee` should include custom holidays from both sources:

- direct active `holiday_assignment` rows matching organization, team, or employee scope
- active `holiday_category_assignment` rows matching organization, team, or employee scope, expanded to active holidays whose `categoryId` is assigned

Both queries must filter by `organizationId`. The final holiday occurrence map should dedupe by holiday occurrence so a holiday assigned both directly and through its category appears only once. Existing recurrence expansion for custom holidays remains unchanged.

## Settings UI

Update the custom holiday assignment flow in `AssignmentManager` and `HolidayAssignmentDialog` so the visible admin action assigns a custom holiday category rather than a single custom holiday.

The dialog should:

- use titles and descriptions such as `Assign Custom Holiday Category`
- list active holiday categories instead of individual holidays
- preserve the existing org/team/employee target picker behavior
- disable submit when no categories are available
- invalidate the category assignment query on success

The assignment cards should display category assignment rows with category name and target context. Existing direct individual holiday assignments may still be displayed so old data is visible, but the primary add action should create category assignments going forward.

## Error Handling

Use the existing server action result pattern. Expected errors include:

- category not found for inactive or cross-org category IDs
- team not found for missing or cross-org team IDs
- employee not found for missing or cross-org employee IDs
- duplicate assignment conflict for an already active category assignment on the same target
- database errors wrapped as `DatabaseError`

The UI should show the returned error message through toast notifications, matching existing holiday assignment behavior.

## Testing

Add focused coverage for:

- assigned holiday expansion includes active holidays from an assigned category
- direct holiday assignment and category assignment dedupe the same holiday occurrence
- create action rejects cross-org category IDs
- create action rejects cross-org team and employee IDs
- list action returns category assignment rows with team and employee display data
- delete action soft-deletes only assignments in the actor organization

Run targeted tests for holiday assignment actions and assigned holiday expansion after implementation.

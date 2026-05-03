# Absences Mobile Cards And Assigned Holidays Design

## Goal

Improve the `/absences` page so the vacation overview cards are readable on narrow mobile screens and the absence calendars show every holiday assigned to the current employee.

## Scope

- Make `VacationBalanceCard` use a single-column layout on the smallest screens, then two columns on small screens, then four columns at the existing card container breakpoint.
- Replace the current organization-only holiday lookup for `/absences` with an employee-scoped lookup.
- Include active custom holiday assignments and holiday preset assignments that apply at organization, team, or employee level.
- Keep the existing calendar components unchanged by returning concrete `Holiday[]` records.

## Data Rules

The absence view should include all active holiday rules that apply to the employee:

- Organization-wide assignments.
- Assignments for the employee's current team.
- Assignments directly for the employee.
- Preset assignment effective date windows must overlap the requested calendar range.
- Preset holidays are expanded into concrete dates for the requested year and support `durationDays`.

## Testing

- Add or update query tests if an existing test harness is available for absence queries.
- Run targeted checks for the modified webapp files.

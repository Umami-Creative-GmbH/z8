# Team Absences Today Highlight Design

## Goal

Highlight the current day in the `/team/absences` year calendar so managers can quickly orient themselves in the selected year's absence overview.

## Scope

In scope:

- Add a visual today state to the existing team absence year calendar day cell.
- Apply the state only when the selected calendar year contains the real current day.
- Preserve the existing approved and pending absence indicators.
- Include accessible labeling and a focused UI test.

Out of scope:

- Changing calendar data queries or absence grouping.
- Highlighting the same month/day in non-current years.
- Changing personal `/absences` calendar behavior.

## Approach

Compute today's date key in `TeamAbsenceYearCalendar` using Luxon, in UTC to match the component's existing calendar-date construction. Pass that key into each `TeamAbsenceMonth`. Each rendered day compares its ISO date key to `todayDateKey` and adds a restrained ring/background treatment when it matches.

This keeps the change local to `team-absence-year-calendar.tsx`, follows the project's Luxon convention, and avoids changing server data or URL state.

## UI

The today marker should be subtle and compatible with absence states:

- A stronger blue ring and slightly emphasized background for today.
- Existing approved fill remains visible.
- Existing pending yellow ring/dot remains visible.
- The accessible label starts with `Today, ...` for the matching day.

## Testing

Add a test in `team-absence-year-calendar.test.tsx` that freezes Luxon's current time to a known date in the rendered year and verifies the corresponding calendar button has the `Today, ...` accessible label. Also verify a non-current selected year does not expose a today label.

## Success Criteria

- Opening `/team/absences` in the current year shows today's date highlighted.
- Switching to another year removes the today highlight.
- Approved and pending day indicators still work on the highlighted day.
- The calendar remains accessible to screen readers.

# Absence Holiday Tooltips Design

## Goal

Show the holiday name when a user hovers or focuses a holiday day in the `/absences` calendars.

## Scope

- Add tooltips to holiday days in `AbsenceYearCalendar`.
- Add tooltips to holiday days in the older monthly `AbsenceCalendar`.
- Use the existing `components/ui/tooltip` primitives for consistent styling and accessible focus behavior.
- Keep non-holiday day rendering unchanged.

## Behavior

- A holiday day shows a tooltip containing the holiday name.
- If multiple holidays fall on the same day, each name appears on its own line.
- The year calendar reads holiday names from holiday `CalendarEvent` entries.
- The monthly calendar carries the matched holiday name through its date status data.

## Testing

- Run the relevant TypeScript or lint check for the webapp files touched.
- If the broad check is blocked by unrelated existing issues, report that and verify the edited files as far as available.

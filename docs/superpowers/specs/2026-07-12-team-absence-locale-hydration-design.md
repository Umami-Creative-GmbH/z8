# Team Absence Calendar Locale Hydration Design

## Problem

The team absence year calendar formats day labels with Luxon's runtime-default locale. During server rendering that default can be English, while the browser default can be German. React then receives different `aria-label` and hidden-detail text during hydration and regenerates the calendar on the client.

## Design

Use Tolgee's active language as the single locale source for the client component. `TeamAbsenceYearCalendar` will subscribe to Tolgee's language state, default to `en` only when Tolgee has no active language, and pass that locale through the month and day-detail components. Date label formatting will set the explicit locale on the existing UTC Luxon `DateTime` before formatting.

This preserves the calendar's current date arithmetic and UTC date keys. It does not derive business meaning from the viewer timezone, change translation keys, or alter visible layout and interactions.

## Alternatives Considered

- Pass the route locale from the server page. This would be deterministic but adds prop plumbing for data already available through the hydrated Tolgee provider and would not react automatically to language changes.
- Translate complete date labels through Tolgee. This could offer more control over sentence grammar, but it expands the scope into new translation keys and duplicates locale-aware date formatting.

## Testing

Add a focused regression test that sets Luxon's runtime default locale to a value different from the mocked Tolgee language and verifies that the rendered day label follows Tolgee. The test must fail before the production change and pass afterward. Then run the complete calendar test file and relevant static checks.

## Non-goals

- Migrating this existing Luxon calendar to Temporal.
- Localizing the existing `Today`, `absent`, or `pending` fallback phrases.
- Refactoring the calendar component hierarchy or styling.

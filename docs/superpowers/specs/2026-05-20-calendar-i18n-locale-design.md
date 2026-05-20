# Calendar i18n and Locale Design

Replace hardcoded user-facing strings in the `/calendar` webapp view with Tolgee `t()` calls, and make calendar date labels use the active Tolgee language configured for the user.

## Scope

- Update the custom Schedule-X wrapper controls: loading text, Today, Refresh, and view tabs.
- Update the year calendar controls: Today and view tabs.
- Keep existing calendar legend translations and existing week-start preference behavior.
- Format custom date range labels with Luxon using the active Tolgee language.
- Pass the active language into Schedule-X if the calendar app configuration supports a `locale` option.
- Add matching `calendar.view.*` message keys to all calendar namespace locale files.

## Architecture

Use the existing client-side Tolgee pattern. `schedule-x-calendar.tsx` will call `useTranslate()` for copy and `useTolgee(["language"])` for the active locale. `year-calendar-view.tsx` already reads Tolgee language for month and weekday names, so it only needs the remaining hardcoded controls moved to `t()`.

## Data Flow

Tolgee active language drives both translated copy and date formatting. The existing user preference provider continues to drive week-start ordering. No new setting, database field, API, or organization-scoped data access is needed.

## Testing

Run a focused type/lint-safe verification for the webapp after editing. If a focused calendar test exists, run it; otherwise run the broader webapp test command that is feasible in this workspace.

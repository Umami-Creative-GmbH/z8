# Header Timezone Control Design

## Goal

Show the signed-in user's configured timezone and current local time in the app header, and let the user quickly change that timezone from the header without navigating to profile settings.

## Scope

- Add a compact timezone/time display to the right side of the app header before notifications.
- Display the current time in the user's configured timezone without seconds.
- Display the configured timezone's current UTC offset as a small pill next to the time, for example `UTC+02:00`.
- Open a popover when the header control is clicked.
- Let the user choose a draft timezone in the popover using the existing `TimezonePicker`.
- Save the draft timezone only when the user presses Save.
- Keep the full profile timezone card available and unchanged in purpose.

## Architecture

Create a focused client component for the header timezone control, rendered from `SiteHeader` before `NotificationBell`.

The component reads existing user preferences through `UserPreferencesProvider`:

- `useUserTimezone()` for the configured timezone.
- `useTimeFormat()` for the current 12-hour or 24-hour display preference.

The component calls the existing profile `updateTimezone` server action from `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`. No new database fields are required because the app already stores user timezone in `userSettings.timezone` and the app layout already fetches it with `getUserTimezone`.

## UI Behavior

The header trigger is a button styled as a compact control that fits the existing header action row. It contains:

- Current time in the configured timezone, without seconds.
- A pill showing the current UTC offset for that timezone.

The trigger should remain readable on narrow screens. If space is constrained, the timezone control may hide less important text before hiding core actions like notifications or clock-in.

Clicking the trigger opens a popover. The popover contains:

- A short label showing the currently saved timezone.
- The existing searchable `TimezonePicker` bound to local draft state.
- A Save button that is enabled only when the draft timezone differs from the saved timezone.

Saving shows a loading state, disables controls, and preserves the selected draft until the server action resolves.

## Time And Offset Formatting

Use Luxon `DateTime` for timezone-aware time and offset formatting, following the repository date/time convention.

The current time updates once per minute because seconds are not shown. The update should be lightweight and scoped to the header control only.

The offset pill represents the selected configured timezone at the current instant, including daylight saving time where applicable. Examples:

- `UTC+00:00`
- `UTC+01:00`
- `UTC+05:30`
- `UTC-04:00`

If the stored timezone is invalid, fall back to `UTC` for display and saving behavior should still use the selected picker value.

## Data Flow

1. `AppLayout` fetches the user timezone with `getUserTimezone` and passes it into `UserPreferencesProvider`.
2. `SiteHeader` renders the new header timezone control before notifications.
3. The control reads the saved timezone and time format from `UserPreferencesProvider`.
4. The control formats the current time and UTC offset for display.
5. The user opens the popover and selects a draft timezone with `TimezonePicker`.
6. The user presses Save.
7. The control calls `updateTimezone(draftTimezone)`.
8. On success, the control shows a success toast and refreshes the current route so server-provided preferences and timezone-aware UI are synchronized.
9. On failure, the popover remains open and the draft selection is preserved.

## Error Handling

- Failed server action: show an error toast, stop loading, keep the popover open, and preserve the draft timezone.
- Thrown server action or network failure: show a generic error toast and keep the draft selection.
- Invalid display timezone: display the time and offset using `UTC` rather than breaking the header.
- Save button double-clicks: disabled while a save is in progress.

## Testing

Add or update tests for:

- `SiteHeader` renders the timezone control before notifications.
- The control displays the configured timezone's current local time without seconds.
- The control displays the current UTC offset pill for the configured timezone.
- Opening the popover shows the timezone picker and Save button.
- Selecting a different timezone enables Save.
- Successful save calls `updateTimezone`, shows success feedback, and refreshes the route.
- Failed save shows error feedback and leaves the popover/draft state intact.

Use deterministic time in tests through mocked timers or a small formatting helper so assertions do not depend on wall-clock time.

## Non-Goals

- No changes to organization timezone settings.
- No new timezone storage model.
- No automatic browser timezone detection or suggestion flow.
- No seconds in the header time display.
- No inline save-on-select behavior.
- No removal of the profile timezone settings card.

## Open Decisions

None. The control appears before notifications, uses select-then-Save behavior, and displays time without seconds.

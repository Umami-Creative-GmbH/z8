# User Time Format Preference Design

## Summary

Improve time handling by making shared time fields picker-driven and adding a per-user time format preference. The preference controls both time picker presentation and user-facing time displays. Date fields are intentionally out of scope.

## Goals

- Remove the need to manually type exact `HH:mm` values into time fields.
- Keep using `timepicker-ui` rather than building a custom time picker.
- Let each user choose between 24-hour and 12-hour time.
- Default existing and new users to 24-hour time unless they choose otherwise.
- Apply the preference to both picker UI and visible clock-time displays.
- Preserve existing storage and business logic formats.

## Non-Goals

- Do not change date inputs, date pickers, or date formatting.
- Do not change how work periods, shifts, or templates are stored.
- Do not migrate time values away from normalized `HH:mm` strings where forms already use that format.
- Do not infer defaults from locale in this iteration.

## Data Model

Add a `timeFormat` preference to `user_settings`:

- Allowed values: `24h`, `12h`.
- Default: `24h`.
- Scope: user-level, not organization-level.

Create a helper module similar to `lib/user-preferences/week-start.ts` that provides:

- `TimeFormat` type.
- `DEFAULT_TIME_FORMAT` set to `24h`.
- options for settings and onboarding UI.
- validation and normalization helpers.
- formatting helpers for display code.

Invalid or missing values normalize to `24h`. Server actions that persist this preference reject unsupported values.

## Input Behavior

Update the shared `TimeInput` component so time selection happens through `timepicker-ui` only. The text input should not support manual typing. It can remain an underlying text input for library integration and form compatibility, but it should be read-only from the user's perspective.

The picker should use the active user's preference:

- `24h`: picker presents values like `08:00` and `17:30`.
- `12h`: picker presents AM/PM controls and familiar 12-hour labels.

The component must continue emitting normalized `HH:mm` values such as `08:00` and `17:30`. Existing form validators and server actions can therefore remain focused on `HH:mm` values.

## Profile Settings

Add a profile settings card alongside timezone and week-start settings:

- Title: Time Format.
- Options: `24-hour (08:00)` and `12-hour (8:00 AM)`.
- Save behavior follows the existing week-start card pattern.
- Persistence uses a server action with the existing `userSettings` upsert pattern.

The profile page should fetch the current time format in parallel with the existing profile settings data.

## Onboarding

Add the same time format choice to the onboarding profile step near the existing week-start preference. This keeps basic user display preferences together.

The onboarding profile schema and service should accept and persist `timeFormat`. If a user skips profile setup, the default remains `24h`.

## Displays

Introduce shared formatting utilities that render clock times according to `timeFormat`. Update user-facing time displays that currently hard-code `hour12` or directly instantiate `Intl.DateTimeFormat` in relevant time-tracking, approvals, and scheduling areas.

The implementation should avoid touching date-only rendering. When formatting a `Date`, Luxon `DateTime`, or existing `HH:mm` string, the displayed clock time should honor the user preference while the underlying value remains unchanged.

## Error Handling

- Unsupported submitted preferences fail validation in server actions.
- Missing database values normalize to `24h`.
- `TimeInput` should preserve existing behavior for disabled fields and required form participation.
- Picker confirmation should only update the form when a complete hour and minute are available.

## Testing

Cover the change with focused tests:

- `TimeInput` remains picker-driven, is not manually editable, and emits normalized `HH:mm` values.
- Time format helper tests cover normalization and 12-hour/24-hour formatting.
- Profile update action validates and persists the selected format.
- Onboarding profile submits and persists the selected format.
- At least one representative display component or formatter test proves visible time output follows the preference.

## Implementation Notes

- Use `pnpm` commands for verification.
- Keep changes small and follow the existing week-start preference structure.
- Do not edit `src/db/auth-schema.ts`.
- Do not introduce tenant-specific environment variables.

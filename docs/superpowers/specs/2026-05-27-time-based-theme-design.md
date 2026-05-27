# Time-Based Theme Option Design

## Context

The webapp currently uses `apps/webapp/src/components/theme-provider.tsx` as the client-side owner of theme state. It supports `light`, `dark`, and `system`, persists the selected value in localStorage under `theme`, and applies the resolved `light` or `dark` class to the document root. Theme choices are exposed from `nav-user.tsx` in the account menu and from `theme-toggle.tsx` in the compact toggle.

The new feature adds a fourth user-selectable mode that resolves the app theme from the user's local sunrise and sunset times. The app already has Luxon and SunCalc available. The feature should not require a backend data model change and should not send location data to the server.

## Goals

- Add a `time` theme option alongside `light`, `dark`, and `system`.
- Request browser location permission only after the user explicitly selects the time-based option.
- Use granted coordinates with SunCalc to resolve `time` to `light` between sunrise and sunset, and `dark` otherwise.
- Keep the previous theme if location permission is denied, ignored, unavailable, or fails.
- Store coordinates locally only, so the mode can keep working after reloads without repeated prompts.
- Re-evaluate automatically at the next sunrise or sunset boundary.

## Non-Goals

- No tenant- or user-level database persistence for coordinates.
- No timezone-to-coordinate approximation.
- No fixed local clock fallback when permission fails.
- No location permission prompt before the user chooses the time-based theme.
- No custom per-user sunrise/sunset offsets in this iteration.

## User-Facing Behavior

The theme menu gets a new option labeled `Time based`. Selecting it triggers `navigator.geolocation.getCurrentPosition`. If permission succeeds, the provider stores the selected theme as `time`, stores the coordinates in localStorage, and immediately resolves the active theme with SunCalc.

If permission is denied, times out, the browser lacks geolocation, or geolocation is blocked by browser context, the app keeps the previous theme in React state and localStorage. The provider exposes a short-lived error state so the menu can show a small message such as `Location permission is required for time-based theme.`

The mode should not send coordinates to the backend. Coordinates are only used in the browser to calculate sunrise and sunset.

## Architecture

`ThemeProvider` remains the single owner of theme state. Its theme type expands from `light | dark | system` to `light | dark | system | time`. The context continues to expose `theme`, `resolvedTheme`, `systemTheme`, `themes`, and `setTheme`, and adds a small error surface such as `themeError` plus `clearThemeError` for UI feedback.

`setTheme("time")` differs from the other modes. It first requests geolocation and only persists `time` after a successful location response. This preserves the user's previous selection when location cannot be acquired. Other theme values continue to persist immediately.

The provider stores coordinates under a separate localStorage key, for example `theme-location`, with `{ latitude, longitude }`. On mount, if the stored theme is `time` and stored coordinates exist, it resolves the theme immediately without prompting. If the stored theme is `time` but coordinates are missing or invalid, it keeps `time` selected but resolves to the current system theme until valid coordinates are granted again, and exposes an error if the user tries to select `time` again.

## Theme Resolution

`resolveTheme` should handle four cases:

- `dark` resolves to `dark`.
- `light` resolves to `light`.
- `system` resolves to `getSystemTheme()` when system mode is enabled.
- `time` resolves through SunCalc when valid coordinates are available.

For `time`, the provider calls `SunCalc.getTimes(now, latitude, longitude)` and compares the current browser time to sunrise and sunset. If the current time is greater than or equal to sunrise and before sunset, the resolved theme is `light`; otherwise it is `dark`.

If SunCalc returns invalid dates for edge cases, such as extreme polar locations, keep `time` selected but resolve to the current system theme. This is different from geolocation failure because permission succeeded and the feature is active.

## Automatic Updates

When `theme === "time"` and valid coordinates are available, the provider schedules a timeout for the next relevant boundary:

- Before sunrise: schedule sunrise.
- Between sunrise and sunset: schedule sunset.
- After sunset: schedule the next day's sunrise.

When the timeout fires, the provider recalculates the resolved theme and schedules the next boundary. This avoids polling and keeps the behavior local to the theme provider.

## UI Updates

Both account-menu theme selectors in `nav-user.tsx` should include the new time-based option with a Tabler icon. The mobile collapsed theme section and the desktop submenu should stay structurally consistent with the existing options.

`theme-toggle.tsx` should also expose the new option if it is still used in visible parts of the app. The compact button can continue to show the resolved light/dark icon rather than adding a separate time-mode icon to the trigger.

The account menu should render the provider's location-required error near the theme options when present. The message should be concise and non-blocking.

## Error Handling

The following cases all keep the previous theme and set the same user-facing error:

- User denies location permission.
- User ignores the permission prompt until it times out.
- The browser does not support geolocation.
- Geolocation is blocked by an insecure context or browser policy.
- The returned coordinates are missing or invalid.

The provider should clear the error when the user successfully changes to any theme, successfully enables `time`, or the UI explicitly clears it.

## Testing

Most coverage belongs in `theme-provider.test.tsx` because the provider owns permission, persistence, resolution, and scheduling behavior.

Provider tests should cover:

- Existing light, dark, and system behavior still works.
- Selecting `time` with mocked geolocation success stores `theme=time`, stores coordinates, and applies the expected resolved class.
- Selecting `time` with mocked geolocation failure keeps the previous theme and localStorage value.
- A stored `time` theme with stored coordinates resolves on mount without another permission request.
- The scheduled boundary update recalculates the resolved theme.
- Invalid SunCalc results fall back to system theme while keeping `time` selected.

UI tests can stay light. Add coverage for the new menu option in `nav-user.test.tsx` only if it can be done without heavy mocking. Otherwise, rely on provider tests plus existing menu rendering patterns.

## Implementation Notes

- Use Luxon only if it improves date handling around next-day boundary calculation; native `Date` values are returned by SunCalc and are acceptable at the browser API boundary.
- Use Tabler icons only.
- Keep all storage browser-local. Do not introduce environment variables or tenant-specific settings.
- Keep the change scoped to the theme provider and existing theme selection UI.

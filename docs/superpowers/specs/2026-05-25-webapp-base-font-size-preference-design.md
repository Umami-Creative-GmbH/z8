# Webapp Base Font Size Preference Design

## Context

Some users report that the base UI font is too small. The current compact size should remain the default visual experience, but users need an in-product way to increase readability. The webapp already exposes theme and language controls on auth routes, onboarding routes, and the signed-in user menu.

This feature focuses only on the webapp. It does not change tenant configuration, organization settings, or database-backed user settings.

## Goals

- Add a user-controlled base font size preference with three choices: Default, Comfortable, and Large.
- Keep the current UI unchanged for users who keep Default selected.
- Make the preference available before sign-in on auth routes and during onboarding.
- Add the same preference to the signed-in user menu next to the existing language and theme controls.
- Apply the selected size globally across auth, onboarding, and app routes.

## Non-Goals

- Do not add a database column or migration.
- Do not sync the preference across devices.
- Do not add per-organization font-size policy.
- Do not redesign the existing theme or language controls.

## Architecture

Add a small client-side font-size preference system in the webapp:

- A shared provider runs under the locale root layout near the existing theme provider.
- The provider reads a local browser preference key, validates it, and applies the selected value to `document.documentElement`.
- The selected value is exposed through a React context hook for controls that need to read or update it.
- Global CSS maps the active value to the root font size.

The values are:

- `default`: current UI sizing, no effective font-size change.
- `comfortable`: modest increase, intended around `17px` root sizing.
- `large`: stronger increase, intended around `18px` root sizing.

The implementation should prefer a `data-font-size` attribute on `<html>` or an equivalent class that is easy to test and does not conflict with `next-themes`, which already manages the theme class on `<html>`.

## Components

Add a shared compact font-size control and reuse it in the existing surfaces.

- Auth layout: render the font-size control beside `ThemeToggle` and `LanguageSwitcher`.
- Onboarding layout: render the same control beside `ThemeToggle` and `LanguageSwitcher`.
- Signed-in user menu: add a `Font size` option near `Language` and `Theme`.
- Desktop user menu: use a submenu with radio options for Default, Comfortable, and Large.
- Mobile user menu: use the same collapsible section pattern already used for language and theme.

The compact auth/onboarding control should visually match the existing theme icon button: outline button, icon-only trigger, dropdown content aligned to the end, and accessible screen-reader text. Use a Tabler text/typography icon such as `IconTextSize` if available.

Labels should use Tolgee fallbacks, for example:

- `user.font-size`: Font size
- `user.font-size-default`: Default
- `user.font-size-comfortable`: Comfortable
- `user.font-size-large`: Large

## Data Flow

The preference is local and immediate:

1. On client startup, the provider reads a key such as `z8-font-size` from `localStorage`.
2. Invalid or missing values resolve to `default`.
3. The provider applies the value to `<html>`.
4. Selecting a new option updates React state, writes `localStorage`, and applies the value to `<html>` immediately.
5. Auth routes, onboarding routes, and signed-in app routes inherit the selected base font size from the root element.

Because this must work before authentication, local storage is the source of truth. Signed-in persistence can be considered later only if there is a concrete product need.

## Error Handling

- If `localStorage` is unavailable, fall back to `default` and keep the control usable for the current in-memory session.
- If a stored value is invalid, ignore it and apply `default`.
- If writing to storage fails, still update the current page session.
- Server rendering should remain safe by emitting default markup; the client provider applies the stored preference after mount.

## Accessibility and UX

- The control must be keyboard-accessible through the existing dropdown primitives.
- The icon-only trigger must have an `sr-only` label.
- Radio options must expose the selected state through the existing menu radio components.
- Mobile rows should keep the selected-row styling pattern used by language and theme.
- The default option must preserve the current compact UI for users who prefer it.

## Testing

Add focused tests for the touched behavior:

- Preference helper/provider behavior for valid stored values, invalid stored values, and storage failures.
- Font-size toggle renders Default, Comfortable, and Large and updates the preference.
- Auth layout renders the new control beside the existing theme and language controls.
- Onboarding layout renders the new control beside the existing theme and language controls.
- `NavUser` mobile behavior includes the font-size collapsible section and keeps selected-row styling consistent.

Run the relevant Vitest tests for the touched files after implementation.

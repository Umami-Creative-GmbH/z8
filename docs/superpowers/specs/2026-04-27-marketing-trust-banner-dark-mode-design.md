# Marketing Trust Banner Dark Mode Design

## Goal

Reduce the brightness of the marketing trust banner in dark mode while keeping it visibly separated from the surrounding page.

## Scope

- Update the marketing `LogoBar` trust banner styling.
- Keep light mode visually unchanged.
- Use a subtle dark panel treatment in dark mode rather than a white or high-contrast surface.

## Design

The banner should use the existing theme token pattern. Add a dedicated trust banner background token so the section can render as a quiet panel in dark mode without affecting other surfaces.

Light mode should remain transparent or visually equivalent to the current treatment. Dark mode should use a restrained navy-gray shade, with the existing border preserving section separation.

## Testing

Verify the marketing app typecheck/lint/build path available in the repo and inspect the changed component for light and dark theme behavior.

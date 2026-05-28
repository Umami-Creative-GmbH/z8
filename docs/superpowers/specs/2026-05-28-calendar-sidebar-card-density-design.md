# Calendar Sidebar Card Density Design

## Goal

Adjust the `/calendar` sidebar so controls read in the requested order and the sidebar cards use a tighter, more consistent visual treatment in light and dark themes.

## Design

- Reorder the non-year calendar sidebar to show the employee selector first, then all-time balance, filters, and legend.
- Keep the employee selector unboxed so it remains visually lightweight.
- Apply compact card styling locally to the calendar sidebar cards rather than changing the global card component.
- Give filters and legend a subtle title header background using existing theme tokens so the treatment adapts to dark mode.
- Reduce card header and body padding to better match the provided compact reference.
- Match the compact all-time balance card to the same sidebar card shell while preserving its current balance value, status color, and helper text behavior.

## Scope

This change is presentation-only. It does not change calendar data fetching, filtering behavior, permissions, work-balance calculation, or employee selection behavior.

## Verification

- Run the focused calendar component tests if available.
- Run type/lint checks or the closest existing package checks if practical.
- Visually inspect the changed class structure for theme-token usage and responsive sidebar order.

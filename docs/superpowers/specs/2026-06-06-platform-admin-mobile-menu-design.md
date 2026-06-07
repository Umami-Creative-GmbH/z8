# Platform Admin Mobile Menu Design

## Purpose

Make platform-admin usable on mobile by exposing the hidden navigation through a classic left offscreen menu and improving the mobile readability of platform settings cards.

## Context

The platform-admin route uses its own compact admin layout in `apps/webapp/src/app/[locale]/(admin)/layout.tsx`. Desktop navigation is rendered by `PlatformAdminHeaderActions` as icon-only links, but those links are hidden below the `md` breakpoint and no replacement mobile menu is rendered. The app-wide sidebar already has an offcanvas pattern, but platform-admin does not use that shell.

The platform settings page already uses `Card` surfaces, but some setting details use horizontal rows that compress poorly on small screens.

## Chosen Approach

Add a dedicated platform-admin mobile menu button on the left side of the admin header. The button opens a left-side offscreen sheet containing the existing platform-admin navigation items with labels, icons, and active-state highlighting. Keep the current desktop header navigation unchanged.

This is the smallest change that matches the requested behavior. Reusing the app-wide sidebar would add unnecessary shell complexity, and a horizontal mobile nav would not satisfy the left offscreen menu requirement.

## Interface Design

On mobile, the header order is:

1. Menu button.
2. Admin Console identity.
3. Language and exit controls.

The menu button uses a Tabler menu icon, an accessible label such as `Open admin menu`, and the same compact button scale as the existing header actions.

The sheet opens from the left and is titled `Admin Menu`. It lists the same destinations as desktop navigation:

1. Overview.
2. Analytics.
3. Users.
4. Organizations.
5. Billing when billing is enabled.
6. Settings.
7. System Email Templates.
8. Worker Queue.
9. Deployment Diagnostics.

Each item shows its icon and label. The active item uses the existing accent background and foreground treatment. Non-active items use muted text with hover/focus states. Navigation remains keyboard accessible.

## Settings Mobile Cards

Keep the existing desktop grid and card hierarchy. On small screens, make settings card interiors stack cleanly:

1. Card headers keep icon, title, and description grouped.
2. Turnstile key rows stack label and environment variable vertically on narrow screens.
3. The cookie consent script remains full width, with mobile-safe padding and a readable textarea.

This preserves the current visual language while making each setting read as a distinct mobile surface.

## Data Flow

The layout continues building `navItems` server-side using the existing billing feature flag and translations. The client mobile menu receives those same `navItems`, uses `usePathname()` to compute active state, and renders links through the existing localized `Link` component.

No platform data access changes are required.

## Error Handling

The menu has no async behavior. The billing item remains absent when billing is disabled, matching the existing desktop logic. If navigation changes later, both desktop and mobile menus should continue to consume the same `navItems` array to avoid drift.

## Testing

Add or update lightweight tests around platform-admin layout/header source expectations:

1. The admin layout renders a mobile menu trigger on the left side of the header.
2. The mobile menu receives the same platform-admin nav items as desktop.
3. Active-state logic remains shared for desktop and mobile links.
4. The settings page includes responsive stacked row classes for mobile card readability.

Manual verification should include mobile viewport checks for `/platform-admin` and `/platform-admin/settings`.

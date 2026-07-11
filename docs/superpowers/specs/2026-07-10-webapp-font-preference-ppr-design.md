# Webapp Font Preference PPR Design

## Goal

Allow the webapp to prerender with Next.js Cache Components while retaining each user's font-size preference after hydration.

## Problem

`FontSizeProvider` currently reads `localStorage` in its lazy state initializer. Next.js treats that browser-only value as uncached runtime data during prerendering, so static page generation fails outside a Suspense boundary.

## Design

Use `useSyncExternalStore` in `FontSizeProvider`.

- The server snapshot is always the `default` font size and never accesses browser APIs.
- The client snapshot reads the stored preference from `localStorage` after hydration.
- The subscription listens for native `storage` events and a private in-tab font-size change event.
- `setFontSize` persists the preference, dispatches the in-tab event, and applies the document attribute.
- The existing effect applies the current store value to the document element.

This preserves static rendering with the default font size. After hydration, the saved value is applied; a brief default-size flash is acceptable.

## Testing

- Add component tests for the default server snapshot and same-tab preference updates.
- Run the font preference test file.
- Run the Docker regression test suite that guards Next.js and TypeScript compatibility.
- Run the CI-equivalent pruned webapp build with the Dockerfile's required build environment.

## Scope

Only `FontSizeProvider` and its tests change. Theme preferences, route rendering, and deployment configuration are not modified.

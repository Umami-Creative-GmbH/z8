# Webapp Translation PPR Design

## Goal

Allow route-specific translation loading to use request headers without blocking Next.js Cache Components prerendering.

## Problem

`TranslationProvider` awaits `headers()` to select route namespaces. It is rendered directly in the locale layout, so Cache Components rejects the uncached request dependency during static generation.

## Design

Extract the shared `TolgeeNextProvider` and `NextIntlClientProvider` nesting into `TranslationProviders`.

- `TranslationProvider` remains async and loads route-specific records from the pathname request header.
- `AppProviders` wraps `TranslationProvider` in `Suspense`.
- The fallback renders `TranslationProviders` with an empty records object.
- The fallback preserves translation context and leaves the static application shell visible while route-specific records stream.

## Behavior

The shell may briefly use translation fallbacks until route-specific records arrive. It must not render without a translation provider or delay all app content behind a loading-only fallback.

## Testing

- Add a layout source-contract test covering the Suspense boundary and base-provider fallback.
- Retain existing locale layout tests.
- Run the layout test and Docker regression suite.
- Run the CI-equivalent pruned webapp build and confirm static generation has no uncached font-preference or translation-provider access.

## Scope

Only the locale layout and its tests change. Translation namespace selection, route configuration, and provider libraries remain unchanged.

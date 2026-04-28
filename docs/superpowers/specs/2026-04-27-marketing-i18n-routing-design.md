# Marketing I18n Routing Design

## Goal

Add German and English language support to the marketing app while keeping German as the default language. The root marketing route `/` should redirect to `/de`, and all marketing pages should be available under `/de` and `/en`.

## Scope

- Cover the main marketing homepage.
- Cover the existing alternate marketing pages `s-1` through `s-10`.
- Add a language switcher near the existing dark mode toggle.
- Add SEO metadata for localized pages.
- Preserve the current visual design and theme behavior.

## Routing

Use explicit locale-prefixed App Router routes:

- `/` redirects to `/de`.
- `/de` renders the German homepage.
- `/en` renders the English homepage.
- `/de/s-1` through `/de/s-10` render German alternate pages.
- `/en/s-1` through `/en/s-10` render English alternate pages.

Only `de` and `en` are valid locales. German is the default locale and fallback. Unsupported locale prefixes should redirect to the same path under `/de` when the target route exists, such as `/fr/s-1` to `/de/s-1`. Unknown routes without a matching German marketing page should use Next.js not-found handling.

## Translation Model

Use a lightweight local dictionary instead of introducing a new i18n dependency. The marketing app is currently static, standalone, and has no existing i18n framework, so typed local dictionaries provide the smallest reliable change.

Create shared locale helpers that define:

- supported locales: `de`, `en`
- default locale: `de`
- locale validation
- dictionary loading
- localized URL helpers for switching languages

Move German copy out of components into German dictionaries or locale-specific data modules. Add matching English copy in the same structure. Components should receive translated strings and arrays through props or localized data helpers instead of importing German-only constants directly.

## Components

The existing landing components should keep their layout and theme behavior. Content-bearing components should accept translated content from the page layer or a shared localized landing data helper.

The header should add a compact language switcher next to the dark mode toggle. The switcher should:

- show `DE` and `EN`
- preserve the current path and hash where feasible
- replace only the leading locale segment
- mark the active language accessibly
- stay visually aligned with the current restrained header controls

## SEO

Localized pages should generate metadata with:

- localized title and description
- canonical URL for the current locale route
- `alternates.languages` for German and English equivalents
- `x-default` pointing to the German route
- correct document language via `<html lang="de">` or `<html lang="en">`

The unprefixed root route should redirect to `/de` so search engines and users have a stable canonical default.

## Error Handling

If a locale is unsupported, the app should avoid rendering the page with mismatched content. Prefer `notFound()` for invalid locale segments inside locale-prefixed routes. The root route remains a direct redirect to `/de`.

If translation keys are missing during development, TypeScript should catch the mismatch by using a shared dictionary shape for both languages.

## Testing And Verification

Verify the implementation by running the marketing build:

```bash
pnpm --filter marketing build
```

Manually inspect or route-check these cases:

- `/` redirects to `/de`
- `/de` renders German content
- `/en` renders English content
- representative alternate routes such as `/de/s-1` and `/en/s-1` render localized content
- the language switcher preserves the current route when moving between German and English
- generated metadata includes canonical and language alternates

## Non-Goals

- Do not add tenant-specific configuration or environment variables.
- Do not change the webapp i18n setup.
- Do not redesign the marketing page.
- Do not translate legal documents beyond existing visible marketing link labels.

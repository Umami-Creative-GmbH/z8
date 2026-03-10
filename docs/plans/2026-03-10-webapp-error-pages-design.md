# Webapp Error Pages Design

**Goal:** Replace the default Next.js not-found and server error screens in the webapp with a polished, recovery-first global experience that feels native to the product.

**Recommended approach:** Build one shared error-state presentation layer for the webapp and use it to power both a global `404` page and a matching global `5xx` error page. Keep the experience visually consistent, prioritize safe recovery actions, and avoid tenant-specific or sensitive data.

## Scope

- Add a custom global not-found page for the webapp.
- Add a matching global error page for unexpected application failures.
- Keep the experience localized and aligned with the existing app theme.
- Preserve existing route-level error boundaries such as `apps/webapp/src/app/[locale]/(app)/settings/error.tsx`.

## Decisions

### 1. Experience direction

- Optimize for recovery first.
- Treat the `404` page as a navigation problem, not a failure state.
- Treat the `5xx` page as a temporary system issue with clear retry and exit paths.

This keeps the pages useful in day-to-day product use and avoids turning them into decorative dead ends.

### 2. Architecture

- Add global app-router entries for not-found and error handling in the webapp.
- Introduce one shared presentational component for the core error-state layout.
- Feed that shared component scenario-specific copy, actions, and optional metadata.

This keeps the visual system consistent while limiting duplication between `404` and `5xx` flows.

### 3. Visual design

- Use the existing webapp design tokens from `apps/webapp/src/app/globals.css`.
- Add a more intentional backdrop with a subtle gradient or glow treatment, plus a framed content surface.
- Keep motion minimal and respect reduced-motion preferences.

The result should feel crafted and product-native without becoming overly illustrative or disconnected from the rest of the app.

### 4. Content and actions

For `404`:

- Show a clear status marker and direct headline.
- Explain briefly that the page cannot be found.
- Offer safe recovery actions such as returning to the dashboard, opening a stable app destination, and going back.

For `5xx`:

- Show a calm error message and reassurance that the issue may be temporary.
- Offer retry and return-to-app actions.
- Display `error.digest` only when available, and only as muted support context.

### 5. Localization

- Keep copy locale-aware using the webapp's existing `next-intl` and Tolgee setup.
- Place these strings in the common translation surface where practical.
- Avoid introducing route-specific translation dependencies for global fallback pages.

This keeps the pages globally usable and compatible with the app's namespace model.

## Component model

- A shared error-state component renders the layout shell, visual accents, headings, body copy, and action slots.
- The global not-found entry passes the `404` content variant.
- The global error entry passes the `5xx` content variant and retry behavior.
- A small contextual panel can expose safe fallback links without assuming tenant-specific state.

## Data flow

### Not-found flow

1. A route resolves to `notFound()` or misses an app-router match.
2. The webapp's global not-found entry renders.
3. The shared error-state component displays localized `404` copy and safe navigation actions.

### Error flow

1. An uncaught render or route error reaches the global app-router error boundary.
2. The global error entry receives the error object and reset callback.
3. The shared error-state component renders localized `5xx` copy, retry action, and optional digest.

## Error handling and security

- Never expose stack traces, backend messages, or tenant-specific internals.
- Only show safe diagnostic metadata already intended for client display, such as `error.digest`.
- Use globally valid fallback destinations so actions do not depend on unknown organization setup state.

## Testing strategy

- Verify a missing localized route renders the custom `404` page.
- Verify a controlled render failure reaches the custom global `5xx` page.
- Verify primary and secondary actions work from localized paths.
- Verify mobile and desktop layouts.
- Verify dark and light themes.
- Verify reduced-motion behavior.
- Keep any existing local error boundaries working as-is.

## Risks and mitigations

- Risk: fallback actions point users to invalid app states.
  - Mitigation: only use globally stable destinations.
- Risk: global error pages feel inconsistent with existing local error UIs.
  - Mitigation: use shared tokens and keep the local settings override untouched for now.
- Risk: localized fallback pages fail due to translation loading assumptions.
  - Mitigation: keep copy in the common namespace and follow existing layout-level i18n patterns.

## Out of scope

- Redesigning every route-level error boundary in the app.
- Adding support chat, incident status APIs, or tenant-specific troubleshooting.
- Reworking the broader global visual system outside these fallback pages.

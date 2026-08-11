# Webapp Selective Cache Components Adoption Design

## Goal

Adopt Cache Components selectively across the authenticated webapp so navigation paints useful, non-sensitive structure immediately while fresh user, organization, and operational data continues to resolve at request time.

The goal is not to make the application static. The target state is a highly dynamic application with deliberate static or per-session shells, focused streaming boundaries, safe organization-scoped caching, and documented reasons for any remaining request-time escape hatches.

## Context

The webapp uses Next.js 16.3 with `cacheComponents: true` and `partialPrefetching: true`. It is gated by Better Auth and performs organization-scoped authorization, billing, preferences, and operational reads on most product routes.

The current implementation has several adoption gaps:

- The locale root reads request headers to derive a pathname that `loadRouteTranslations` discards.
- The root translation boundary can reduce primary route content to a null fallback.
- Authenticated and admin layouts await session and tenant data before rendering shared chrome.
- Shared pathname consumers are not consistently isolated by local Suspense boundaries.
- 51 of 121 pages and 4 of 9 layouts call `connection()`, often as a broad Cache Components escape hatch.
- Cache Components-native caching is not used, while a small number of helpers still use `unstable_cache`.

This design extends the existing partial-prefetching shell design. That design defines safe shell content and route-level fallback expectations. This design adds the selective caching, session-boundary, escape-hatch review, and staged migration policy needed to complete Cache Components adoption safely.

## Principles

1. Preserve dynamic behavior when freshness or authorization requires it.
2. Optimize rendering boundaries before adding caches.
3. Never place tenant or authorization data in a public static shell.
4. Key every reusable tenant cache by `organizationId` and enforce authorization before accepting an identifier.
5. Keep request-time APIs dynamic unless an endpoint receives a separate explicit caching decision.
6. Prefer the smallest useful Suspense and cache boundaries.
7. Treat a meaningful first paint and resolved streaming state as part of correctness.

## Delivery Strategy

Implementation occurs on one isolated branch and is delivered in staged commits:

1. Root translation and provider cleanup.
2. Authenticated and admin shell boundaries.
3. Shared navigation and URL-hook boundaries.
4. Product route groups, migrated one surface at a time.
5. Safe shared cache helpers and invalidation updates.
6. Final route sweep and verification.

The stages remain on one branch because they share the same runtime validation and build gate. Each stage must remain independently reviewable and must not mix unrelated refactoring.

## Root Locale And Translation Loading

The locale root must not read request headers solely to select translations. `loadRouteTranslations` already loads all namespaces and ignores the pathname, so its API becomes locale-only.

Bundled translation loading is cached by locale with a long lifetime. The locale value is the complete cache key; pathname, request headers, cookies, and user data are not inputs.

The root provider tree retains static locale document attributes and existing client providers. Its primary fallback must preserve useful application structure instead of rendering children behind a nested null boundary. Null fallbacks remain acceptable only for invisible background utilities.

If route-scoped translation loading is reintroduced later, it requires a separate design because persistent layouts and client navigation must receive newly required namespaces without full reloads.

## Authenticated Application Shell

The authenticated layout is split into two conceptual regions:

- A neutral shell fallback containing only sidebar, header, banner, and content geometry.
- Request-time authenticated content that resolves session, locale preference, organization settings, billing state, membership, and permission-aware navigation.

The shell must not expose user names, organization names, billing status, notifications, feature flags, role-sensitive links, or tenant records. Failed and missing sessions continue to redirect before protected child content is exposed.

Session access moves below a Suspense boundary. A narrow private session cache may be used when Better Auth request access is compatible with `use cache: private`; its result is browser-scoped rather than server-shared. Authorization remains enforced near every protected data access, Server Action, and Route Handler regardless of shell caching.

Session-derived data that is reusable on the server follows a two-step pattern:

1. Resolve and authorize the current session and active organization at request time.
2. Pass only stable identifiers into an unexported cached function whose query also filters by `organizationId`.

Raw session tokens, cookies, emails, headers, and secrets never become cache arguments or tags.

## Admin And Settings Shells

The admin layout follows the same request-boundary structure. Its neutral shell contains generic admin geometry but no user identity or privileged navigation details. Platform-admin authorization remains server-side and authoritative.

Settings navigation may stream independently because its access tier is session-derived. Settings breadcrumbs and other pathname consumers receive focused Suspense boundaries so a dynamic descendant route does not suspend the complete settings frame.

## Cache Classification

Each data source is classified before caching:

### Static Or Long-Lived

- Bundled locale translations
- Public product metadata
- Stable, non-sensitive reference data

These may use `use cache` with a long lifetime.

### Organization-Scoped And Slowly Changing

- Teams and lightweight employee selectors
- Work policies and holiday presets
- Organization settings suitable for brief staleness

These may use `use cache` only when the function accepts `organizationId`, the query filters by that value, and invalidation is organization-specific. Stable user IDs may be included when the result is user-specific.

### Request-Fresh Or Operational

- Time clock state
- Notifications and approval inbox state
- Live schedules and conflicts
- Billing enforcement and suspension decisions
- Permission checks and active-organization selection
- Search-parameter-dependent results

These remain uncached and stream behind focused Suspense boundaries.

## Existing Cache Helpers

Existing `unstable_cache` functions are not converted mechanically. A helper is migrated only when its lifetime, durability, cache key, and invalidation behavior can be preserved intentionally.

Cache tags include the stable tenant identifier where tenant-specific invalidation is needed. Mutations use immediate invalidation when users must observe their own writes. External handlers use stale-while-revalidate invalidation only where stale reads are acceptable.

Because plain `use cache` is process-local by default, no existing durable cache behavior is silently downgraded. Helpers requiring cross-instance persistence remain on their current mechanism until a remote cache policy is explicitly selected.

## Connection Escape-Hatch Review

Every page and layout `connection()` call is classified as one of:

- Required to move synchronous I/O such as random or current-time generation to request time.
- Deliberately request-bound because no safe meaningful shell exists.
- Obsolete because uncached work can stream behind Suspense without forcing the whole route dynamic.

Obsolete calls are removed. Required calls remain close to the operation they protect and receive a concise reason when the code does not make that reason obvious. A route may legitimately remain partial or fully dynamic; route-table glyphs are not optimization targets by themselves.

API Route Handlers remain dynamic in this project. Their 65 `connection()` call sites are outside this migration except where a shared helper changes without affecting endpoint freshness.

## URL And Client Hook Boundaries

Components using `usePathname`, `useParams`, `useSelectedLayoutSegment`, or `useSearchParams` are wrapped at the smallest useful boundary when dynamic route values are unavailable during prerendering.

The sweep includes the main site header, sidebar navigation, admin navigation, language switching, settings breadcrumbs, and workspace initialization. Fallbacks preserve nearby static controls and geometry rather than blanking the whole layout.

## Error And Authorization Behavior

- Existing redirects, `notFound()`, and permission failures remain authoritative inside request-time components.
- Fallbacks never render protected child data before authorization succeeds.
- Cache failures fall back to normal error boundaries; they do not bypass authorization or tenant filters.
- Session expiry and locale correction preserve their current redirect behavior.
- Billing-check failure remains fail-closed.

## Testing Strategy

Implementation follows test-driven development for observable behavior and extracted helpers.

Focused tests cover:

- Translation loading no longer depends on headers or pathname.
- Translation cache inputs are locale-only.
- Neutral shells contain no user, organization, permission, or billing data.
- Missing or invalid sessions still redirect before protected content renders.
- Tenant cache helpers include and filter by `organizationId`.
- Cache tags and invalidation are tenant-specific.
- Shared pathname consumers have meaningful local fallbacks.
- Reviewed dynamic routes preserve current data and redirect behavior.

Each test is run before implementation to confirm it fails for the intended missing behavior, then rerun after the minimal change.

Runtime verification uses Turbopack and `next-dev-loop` for every changed product surface:

1. Check compilation issues through Next.js MCP.
2. Check framework and browser runtime errors.
3. Verify first-paint shell content in a real browser.
4. Confirm each fallback resolves to real content.
5. Inspect Suspense and React boundaries where DOM checks are insufficient.
6. Recheck siblings after shared-layout changes.

Each stage also runs focused tests, type checking, and `CI=true pnpm build`. The full webapp suite is rerun, but the existing unrelated dependency-baseline failures are reported separately unless the corrected baseline lands before final verification.

## Completion Criteria

- The locale root has no redundant pathname/header dependency.
- Authenticated, admin, and settings layouts expose useful non-sensitive shells.
- Shared URL hooks no longer trigger Cache Components blocking validation on exercised routes.
- Every page/layout `connection()` has been removed or deliberately justified.
- API Route Handler freshness remains unchanged.
- New tenant caches are keyed and queried by `organizationId` with correct invalidation.
- No changed route exposes sensitive data in its prerendered shell.
- Focused tests, type checking, build, MCP diagnostics, and browser checks pass, subject only to explicitly documented pre-existing baseline failures.

## Out Of Scope

- Caching authenticated or mutating API Route Handlers
- Making all product data static
- Visual redesign beyond neutral loading shells
- Changes to billing, authorization, or organization membership semantics
- Runtime prefetching every dynamic link
- Repairing unrelated dependency-upgrade test failures

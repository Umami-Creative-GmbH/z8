# Webapp Partial Prefetching Shells Design

## Goal

Complete Partial Prefetching adoption for the authenticated webapp so default links immediately paint meaningful, non-sensitive structure while URL-specific and tenant-specific content streams after navigation.

## Context

The webapp uses Next.js 16.3 with Cache Components. It is highly dynamic, organization-scoped, and gated by server-side authentication and authorization. Partial Prefetching must therefore optimize route structure without making tenant data static or weakening access control.

The source tree has no explicit `<Link prefetch={true}>` props or imperative `router.prefetch()` calls. Default links should continue to prefetch only their shared App Shell. Runtime URL prefetching is outside this change.

## Safety Boundary

Authentication, authorization, active-organization selection, billing enforcement, and tenant queries remain request-time server operations.

Before authentication resolves, the shared shell may contain only neutral structure:

- Generic sidebar and header skeletons
- Page layout geometry
- Generic loading labels and controls
- Brand elements already visible outside the authenticated area

The shell must not contain organization names, user names, permission-sensitive navigation, billing state, notifications, or tenant records. The real authenticated navigation and all organization-scoped content remain behind the existing server-side gate.

No broad `use cache` boundary will be added around session, permission, billing, or tenant lookups. Existing organization filters and permission checks remain unchanged.

## Architecture

Use focused shell extraction rather than broad `loading.tsx` files or route opt-outs.

- Keep stable, safe page structure outside the nearest Suspense boundary.
- Pass unresolved `params` and `searchParams` promises to focused async children.
- Consume `params`, `searchParams`, `connection()`, session data, and database data only inside the boundary responsible for their loading state.
- Reuse existing page-shaped skeletons where available.
- Add concise accessible loading states where no skeleton exists.
- Keep `fallback={null}` only for secondary background utilities whose absence does not blank primary navigation or page content.
- Use `instant = false` only if live validation proves that a route cannot expose a meaningful safe shell.

## Authenticated App Shell

Refactor the authenticated layout into two conceptual regions:

1. A neutral app-frame fallback that can be prefetched safely.
2. The existing authenticated layout content, which resolves the session, locale preference, organization settings, billing state, membership, and permission-aware navigation before rendering tenant-specific UI.

The fallback mirrors the sidebar, header, banner area, and content viewport without exposing user or organization information. Failed or missing sessions continue to use the existing redirect behavior. Authentication errors must never fall through to child route content.

The locale root retains locale-specific document attributes and translation providers. Child route suspension must no longer collapse into the nested null fallback used by the root provider tree.

## Route Changes

### URL-Dependent Server Routes

Move URL reads into async content children and retain stable page structure outside their boundaries:

- Employee calendar: the calendar skeleton covers both `employeeId` and date query resolution.
- Platform analytics: title and description remain visible while controls and charts resolve from query parameters.
- Payroll readiness: title and description remain visible while authorization, period parsing, and readiness data resolve.
- Works council: a neutral dashboard skeleton covers permission checks, date range resolution, audit recording, and model loading.

### Dynamic Detail Routes

Consume dynamic identifiers below meaningful boundaries:

- Employee detail
- Import batch review
- Team detail
- Vacation employee detail
- Invitation acceptance

Client pages that call `use(params)` receive an enclosing server boundary so their existing query loading states are reachable only after route parameters resolve.

### Primary Null Fallbacks

Replace blank primary-content fallbacks with form- or page-shaped loading states for:

- Approval inbox
- Sign-in and sign-up
- Password reset
- Email verification and pending verification
- Access denied
- Workspace initialization
- Authenticated auth-layout content

Null fallbacks remain acceptable for deployment refresh checks and other invisible background behavior.

### Settings Shell

Preserve settings navigation independently from page content. Settings pages that perform request-bound work without a local boundary receive a content-region fallback so they do not suspend the entire authenticated frame.

## Prefetch Policy

- Keep `partialPrefetching: true` after the route sweep passes.
- Keep default `<Link>` behavior throughout the app.
- Do not add `prefetch={true}` or imperative prefetching.
- Do not introduce runtime URL prefetching or per-link server renders.
- If a route has no safe meaningful shell, opt out only that route and record why.

## Error Handling

- Existing redirects, `notFound()`, and permission failures remain authoritative inside async route content.
- Fallbacks never catch or replace authorization outcomes; they only provide structure while those outcomes resolve.
- Existing route error boundaries remain unchanged unless live verification identifies a regression.
- Loading states use accessible status semantics where text or spinners communicate progress.

## Testing

Add focused tests where component extraction creates observable shell behavior:

- Unresolved URL promises render the intended fallback.
- Resolved URL promises preserve current content and redirects.
- Authenticated app fallback contains no user, organization, permission, or billing data.
- Client pages using `use(params)` are enclosed by a meaningful boundary.
- Primary route fallbacks are not null.

Run verification in this order:

1. Route-specific tests for changed features.
2. Webapp test suite.
3. Webapp typecheck.
4. `CI=true pnpm build`.
5. Authenticated `next dev` route sweep using Next.js runtime diagnostics and a real browser.
6. Production `next build` and `next start` navigation checks for representative app, settings, admin, and auth links.

The development sweep must cover every changed route and report no remaining App Shell URL-data or blocking-prerender findings. Each route's first paint must contain meaningful safe structure rather than an empty page or permanently stuck fallback.

Production checks confirm that default links paint the shared shell immediately and then stream dynamic content. No explicit runtime prefetch requests are expected.

## Worktree And Delivery

Implementation occurs in an isolated git worktree created from current `HEAD`. The main checkout's uncommitted configuration and skill files remain untouched. Only the intended Partial Prefetching config change is reproduced in the worktree.

The completed change is delivered as one reviewable branch because the route fixes share one global configuration flag and one verification sweep. No commit or pull request is created without an explicit user request after implementation.

## Out Of Scope

- Broad webapp performance auditing
- Unrelated React component optimization
- Runtime URL prefetching decisions
- New caching policy for tenant or session data
- Visual redesign of application pages
- Changes to authorization, organization scoping, or billing behavior

# Sign-In Prerender Boundary Fixes

## Problem

`DeploymentRefreshChecker` passes `initialDataUpdatedAt: () => Date.now()` to TanStack Query. TanStack evaluates that callback while constructing the query during Next.js prerendering. On `/[locale]/sign-in`, the checker can also render as part of the translation Suspense boundary's fallback, so that boundary does not isolate the render-time clock access. Next.js therefore reports `next-prerender-current-time-client`.

After isolating the checker, Next.js also reports that `AuthLayout` calls `connection()` outside a Suspense boundary. The layout intentionally reads the request host, resolves organization-specific authentication configuration, and validates platform or custom domains on every request. That request-scoped work must remain dynamic and organization-safe.

## Design

Wrap `DeploymentRefreshChecker` in its own `Suspense` boundary with a `null` fallback inside `ApplicationContent`.

The checker has no visible output, so a `null` fallback preserves the rendered interface. The dedicated boundary lets Next.js defer the client-only, time-dependent query initialization without changing the query's five-minute freshness or polling behavior. The existing translation boundary remains unchanged.

Split the auth route layout into a synchronous default `AuthLayout` and an async `AuthLayoutContent`. The default layout wraps `AuthLayoutContent` in a dedicated `Suspense` boundary with a `null` fallback. `AuthLayoutContent` retains `connection()`, `headers()`, host classification, organization-scoped domain configuration, Turnstile settings, cookie consent, background selection, and the existing auth shell.

Keeping request access and tenant resolution in the same async component makes the boundary explicit without caching or sharing host-specific data across organizations. A `null` fallback avoids rendering auth children before their correct `DomainAuthProvider` context is available.

## Alternatives Considered

- Defer mounting the checker until an effect runs. This avoids prerender execution but adds state and an extra render solely to reproduce behavior already provided by Suspense.
- Replace or remove `initialDataUpdatedAt`. TanStack Query may still initialize timestamps internally, while using a fixed stale timestamp could cause an immediate query and change the intended first-check timing.
- Remove `connection()` from `AuthLayout`. This does not solve the route blocker because `headers()` and uncached domain configuration are also request-time operations.
- Cache auth layout data. The result depends on the trusted request host and organization, so broad caching risks returning the wrong tenant configuration and is outside the intended request-specific behavior.

## Error Handling

No error-handling behavior changes. Version checks remain best-effort through the existing query configuration. Unknown platform domains and missing platform organizations continue to call `notFound()`. The auth boundary renders nothing until the request-specific `DomainAuthProvider` context is ready.

## Verification

- Run the deployment refresh checker unit tests to confirm polling, activity, reload, in-flight request, and unmount behavior remain intact.
- Run the locale layout unit tests to cover provider composition.
- Run the auth layout unit tests to confirm the default layout owns a Suspense boundary and all existing domain, organization, Turnstile, cookie-consent, and shell behavior remains intact.
- Request `http://localhost:3000/en/sign-in` and confirm the prerendered route still returns successfully.
- Confirm the Next.js dev console no longer reports `next-prerender-current-time-client` or `blocking-route` for the sign-in route.

# Deployment Refresh Prerender Fix

## Problem

`DeploymentRefreshChecker` passes `initialDataUpdatedAt: () => Date.now()` to TanStack Query. TanStack evaluates that callback while constructing the query during Next.js prerendering. On `/[locale]/sign-in`, the checker can also render as part of the translation Suspense boundary's fallback, so that boundary does not isolate the render-time clock access. Next.js therefore reports `next-prerender-current-time-client`.

## Design

Wrap `DeploymentRefreshChecker` in its own `Suspense` boundary with a `null` fallback inside `ApplicationContent`.

The checker has no visible output, so a `null` fallback preserves the rendered interface. The dedicated boundary lets Next.js defer the client-only, time-dependent query initialization without changing the query's five-minute freshness or polling behavior. The existing translation boundary remains unchanged.

## Alternatives Considered

- Defer mounting the checker until an effect runs. This avoids prerender execution but adds state and an extra render solely to reproduce behavior already provided by Suspense.
- Replace or remove `initialDataUpdatedAt`. TanStack Query may still initialize timestamps internally, while using a fixed stale timestamp could cause an immediate query and change the intended first-check timing.

## Error Handling

No error-handling behavior changes. Version checks remain best-effort through the existing query configuration, and the boundary fallback renders nothing because the checker itself renders nothing.

## Verification

- Run the deployment refresh checker unit tests to confirm polling, activity, reload, in-flight request, and unmount behavior remain intact.
- Run the locale layout unit tests to cover provider composition.
- Request `http://localhost:3000/en/sign-in` and confirm the prerendered route still returns successfully.
- Confirm the Next.js dev console no longer reports `next-prerender-current-time-client` for the sign-in route.


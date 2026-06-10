# Deployment Refresh Checker Design

## Purpose

Users can leave the Z8 webapp open across a redeploy. After deployment, Next.js Server Action identifiers can change while the browser still runs the old client bundle. A later action can fail because the client and server no longer agree on the action version. The app should periodically detect that a newer deployment is available and refresh safely before the user hits a stale Server Action.

## Recommended Approach

Add a small app-version endpoint and a global client-side checker. The checker compares the build hash embedded in the current client bundle with the build hash reported by the current server. It checks roughly every five minutes, but only reloads when the tab is hidden or the user has been idle long enough to reduce the chance of losing in-progress form input.

This keeps the behavior explicit, deployment-agnostic, and independent of authentication or tenant data.

## Alternatives Considered

1. Static public `version.json`: simple to fetch, but requires reliable build-time file generation and careful cache headers. It adds deployment plumbing that is not needed because the app already exposes `NEXT_PUBLIC_BUILD_HASH` in env validation.
2. Client-side reload after Server Action mismatch errors: useful as a fallback, but too late. The user still experiences a failed action first.

## Architecture

Add `GET /api/app-version` under the webapp. The route returns JSON with the current `buildHash`, sets no-store cache semantics, and reads from the existing `env.NEXT_PUBLIC_BUILD_HASH`. If the env var is missing, it returns a stable fallback string such as `development` so local development remains harmless.

Add a client component mounted from `apps/webapp/src/app/[locale]/layout.tsx` near the existing global `OfflineBanner` and `SWUpdatePrompt`. The component receives or imports the current bundle hash and keeps its own last-activity timestamp.

## Client Behavior

The checker runs on a five-minute interval. On each interval it first decides whether a reload is safe:

- The document is hidden, or
- The document is visible but the user has not interacted for the idle threshold.

The idle threshold should be at least the interval length. A user interaction includes keyboard, pointer, mouse, touch, wheel, and focus activity. If the page is active, the checker skips that interval.

When the page is eligible, it fetches `/api/app-version` with no-store cache options. If the returned hash differs from the client hash, it calls `window.location.reload()` once. Failed checks are ignored and retried on the next interval.

## Data And Security

The endpoint returns only a deployment identifier. It must not read user, organization, session, or tenant data. No organization scoping is needed because no tenant data is accessed. The route should not require authentication because logged-out pages can also become stale.

## Error Handling

Network failures, malformed responses, missing hashes, and non-2xx responses do not surface UI errors. The checker silently retries later. The app should not show a toast before hard refresh in the initial implementation because the purpose is to avoid stale actions without adding user decisions.

## Testing

Add targeted Vitest coverage for the pure decision logic that determines whether a check is eligible and whether a changed hash should trigger reload. If practical with existing route-handler test patterns, add a small route test confirming the version endpoint returns JSON and no-store cache headers.

## Scope

This change does not attempt to preserve unsaved form state across reloads, notify users before reload, or catch every possible Server Action mismatch error. It reduces the common stale-tab problem while minimizing disruption.

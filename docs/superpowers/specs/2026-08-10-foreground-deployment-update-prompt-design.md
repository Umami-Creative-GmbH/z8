# Foreground Deployment Update Prompt Design

## Problem

The global deployment refresh checker polls `/api/app-version` every five minutes, including while a tab is hidden. When the reported build hash differs from the client bundle, it immediately calls `window.location.reload()`.

This unattended hard reload is disruptive on suspended desktop and mobile tabs. It is especially unsafe during a rolling deployment because requests can alternate between old and new replicas. A version check, the reloaded HTML, and subsequent assets may come from different deployment generations, producing repeated reloads or a white page.

## Goal

Keep stale-deployment detection without background polling or automatic reloads. An open tab must remain responsive until the user returns, and a hard refresh must only occur after an explicit user action.

## Chosen Approach

Replace interval polling with a foreground-only, rate-limited version check. When a hidden tab becomes visible or the window regains focus, the checker may request the current app version. A valid hash mismatch displays a persistent update prompt instead of reloading.

The minimum interval between checks is six hours. This is intentionally conservative because deployments are infrequent and stale tabs are not an urgent condition until the user returns. The cooldown is held in memory for the mounted app session; no cross-session browser storage is needed.

## Client Lifecycle

The checker performs no request on mount and installs no timer. Mount time starts the first six-hour cooldown. It listens for `visibilitychange` and `focus`, so the first eligible request can occur only after the app has remained mounted for six hours and then receives a foreground event.

An event starts a check only when all of these conditions are true:

- The document is visible.
- At least six hours have elapsed since the last started check.
- No request is already in flight.
- No update prompt has already been shown during this mounted session.
- A non-empty client build hash is available.

The checker records the check time before starting the request so simultaneous visibility and focus events cannot issue duplicate requests. Hidden-tab events do not fetch.

## Update Prompt

When `/api/app-version` returns a non-empty build hash that differs from the client hash, show a persistent localized toast with the existing update wording:

- Title: `Update available`
- Description: `A new version is ready. Reload to update.`
- Primary action: `Reload`
- Secondary action: `Later`

The checker never reloads from the request or lifecycle event. Only the `Reload` action calls `window.location.reload()`. `Later` dismisses the toast. After either prompt action, the checker does not prompt again during the same mounted session, avoiding repeated notices caused by old/new replicas during a rolling deployment.

The existing service-worker update prompt remains separate because it may need to activate a waiting worker before reloading. Both prompts use the same user-facing language, but this change does not combine their lifecycle logic.

## Error Handling

Non-2xx responses, network failures, malformed JSON, and missing or invalid hashes are ignored. They do not reload the page, display an error, or bypass the six-hour cooldown. A future eligible foreground event may try again.

## Scope

This change modifies only deployment-version checking and its tests. The version endpoint and build-hash generation remain unchanged. It does not alter service-worker caching, deployment routing, Server Action error handling, or other page-specific refresh behavior.

## Testing

Targeted component tests will verify:

- Mounting and elapsed time alone never start a request.
- Hidden visibility events never start a request.
- Returning to a visible tab starts one eligible request.
- Focus and visibility events inside the six-hour cooldown do not duplicate requests.
- A matching hash shows no prompt and never reloads.
- A mismatching hash shows the persistent update prompt and never reloads automatically.
- Choosing `Reload` performs exactly one hard reload.
- Choosing `Later` does not reload and suppresses another prompt in the mounted session.
- An in-flight request and an unmounted component cannot create duplicate or late prompts.

Existing route tests continue to cover version payload and no-store cache headers.

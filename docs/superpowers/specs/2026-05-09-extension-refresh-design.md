# Browser Extension Refresh Design

## Context

The browser extension in `apps/extension` is a Vite, React, and Manifest V3 extension. It currently provides a popup for clocking in and out, optional project selection on clock-out, offline queue support, badge updates, notifications, and an options page for the webapp URL and notification preferences.

The extension has not had focused product attention recently. Its current behavior is useful, but the interface still uses older green styling, the session context is sparse, and some implementation details should be checked against the current dependency stack.

## Goal

Refresh the extension without changing the webapp API contract. The result should feel aligned with the current Z8 product direction: restrained, precise, operationally clear, and blue-forward rather than emerald-forward.

The refresh should keep the current feature set and add one small quality-of-life improvement: clearer last-action and session context.

## Non-Goals

- Do not add new webapp API endpoints for richer history.
- Do not change the extension settings storage schema unless required by a bug fix.
- Do not add tenant-specific environment variables. The extension continues to use the user-configured webapp URL.
- Do not rewrite the extension architecture from scratch.
- Do not remove offline queue, notifications, project selection, or badge behavior.

## Recommended Approach

Use a focused full refresh:

- Keep the current API shape and offline behavior.
- Modernize the popup and options UI.
- Add last-action context using existing status data, queued actions, and local extension state.
- Clean up technical rough edges found during the build and type-check process.

This approach has the best risk/reward balance because it improves the user experience without expanding backend scope.

## Architecture

Keep the current extension structure intact:

- `src/popup` remains the popup React app.
- `src/options` remains the settings React app.
- `src/background` continues to own badge updates, queue processing, alarms, and background sync.
- `src/lib` continues to hold API, storage, notification, and small utility helpers.

Introduce small shared helpers only where they reduce duplication or clarify behavior. The most likely additions are date/time formatting helpers and local last-action storage methods. Avoid broad component-library work unless it directly supports the popup and options refresh.

## Popup Design

The popup should become a clearer status card rather than a minimal button panel.

Core layout:

- Header with Z8 branding, current connection/session state, and settings access.
- Main status area showing whether the user is clocked in, clocked out, offline, queued, unauthenticated, or missing employee setup.
- Large readable elapsed timer when clocked in.
- Session context line such as `Started at 09:14` when active work period data is available.
- Last-action row based on local extension state, for example `Clocked in at 09:14`, `Clock-out queued at 17:02`, or `Last action synced` when known.
- Project selector when clocked in and online, preserving the current behavior that project selection is applied on clock-out.
- One obvious primary action: clock in or clock out.

The popup should stay compact enough for browser-extension use. A small width increase is acceptable if it improves readability, but the design should remain quick to scan.

## Options Design

The options page should remain a single focused settings page, but with refreshed visual hierarchy:

- Blue Z8 brand treatment instead of emerald styling.
- Clear sections for connection settings, notification preferences, usage instructions, and offline behavior.
- Strong labels, readable helper text, visible focus states, and clear button hierarchy.
- Preserve the existing URL validation behavior, including rejection of non-HTTP(S) URLs and embedded credentials.

The stored settings remain:

- `webappUrl`
- `notificationsEnabled`
- `notifyOnClockIn`
- `notifyOnClockOut`

## Data Flow

On popup load, `useClock` continues to fetch `/api/time-entries/status` through React Query. The returned `activeWorkPeriod.startTime` drives the elapsed timer and active session context.

The extension should persist a lightweight local `lastAction` record in `chrome.storage.local` with:

- `type`: `clock_in` or `clock_out`
- `timestamp`: ISO timestamp
- `syncState`: `synced` or `queued`

When the user clocks in or out online, the popup stores a synced last action after the mutation succeeds. When the user clocks in or out offline, the popup queues the action, updates optimistic state, and stores a queued last action. If the background worker successfully processes a queued action that matches the stored last action by type and timestamp, it updates that local last-action metadata from `queued` to `synced`.

This keeps the context honest. If the backend does not expose historical last-entry data, the extension should not imply complete history beyond what it can reliably know locally.

## Offline And Sync Behavior

Offline support remains conservative:

- Offline clock actions continue to be queued in `chrome.storage.local`.
- Optimistic state continues to drive the popup and badge while offline.
- The popup should clearly distinguish queued local actions from synced actions.
- Queue processing remains in the background worker and continues to retry on alarm/startup when online.
- Client errors such as rejected queued actions should not leave stale queued status in the popup.

## Error Handling

The existing error boundaries remain conceptually unchanged:

- Unauthenticated users see a direct sign-in-required state.
- Users without employee setup see the missing employee state.
- Offline/network failures show offline-aware copy rather than generic failure copy.
- Non-network API failures show a retryable error state.
- Invalid settings URLs are blocked before saving.

The refresh should improve wording and hierarchy, not mask failure states.

## Security And Privacy

The extension must continue using browser cookies with `credentials: "include"` for the configured webapp URL. It should not store credentials, API keys, tenant secrets, or organization-specific configuration in environment variables.

The manifest should be reviewed during implementation. Any permission changes should be minimized. If a permission is unused, remove it; if a permission is still required, keep the reason clear in code or documentation.

## Accessibility

The refreshed UI should preserve and improve basic accessibility:

- Buttons must have accessible labels or visible text.
- Loading and timer states should remain announced appropriately without excessive noise.
- Inputs must have labels and helpful validation messages.
- Focus states must be visible.
- Color should not be the only indicator for offline, queued, error, or active states.
- Text contrast should remain strong in light mode.

## Testing And Verification

Primary verification:

- Run `pnpm --filter extension build`.
- Fix TypeScript, Vite, React, or Manifest V3 issues exposed by the build.

Manual/code review verification:

- Popup shows correct active, inactive, offline, queued, unauthenticated, no-employee, loading, and error states.
- Last-action context is honest and does not claim unavailable backend history.
- Options page still saves and validates settings.
- Background queue processing still updates badge and queue state.
- Manifest permissions are still appropriate.

## Acceptance Criteria

- The extension builds successfully with `pnpm --filter extension build`.
- Popup and options UI use the current Z8 blue/neutral product direction.
- Existing clock in/out, project selection, offline queue, notifications, settings, and badge behavior remain intact.
- Popup shows clearer active-session context and local last-action context.
- Offline queued actions are visually distinct from synced actions.
- No new webapp API endpoint is required.
- No tenant-specific environment variable is introduced.

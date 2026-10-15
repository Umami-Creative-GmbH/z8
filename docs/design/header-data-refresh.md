# Header data refresh

Tracked in [#1237](https://github.com/Umami-Creative-GmbH/z8/issues/1237).

## Agreed behavior

- Add an icon-only refresh button immediately before the notification bell in the shared desktop and mobile header.
- Give it a translated “Refresh data” tooltip and accessible label.
- Refresh the current view's data, the visible time-tracking status, and notification count without reloading the document.
- Preserve filters, selected dates, pagination, scroll position, open dialogs, and unsaved edits.
- Show a spinning refresh icon while work is pending, prevent duplicate refreshes, and report refresh failures.

## Implementation findings

The application combines server-rendered data, TanStack Query, SWR, and locally managed client data. A route refresh alone does not refresh all of these sources.

Examples requiring particular care:

- Vehicle settings initialize their local vehicle list from server props without synchronizing later prop updates.
- The absence calendar loads a client-selected year. New server props currently replace its data with the server's initial year even when the user has selected a different year.

## Confirmed scope

Refresh support includes existing client-managed views throughout the application, including legacy settings and calendars. This was explicitly confirmed by the user.

## Implementation

The shared refresh provider revalidates active TanStack Query and mounted SWR data, awaits registered manual loaders, then asks Next.js to merge fresh server content. It keeps the mounted route and browser state intact. If navigation occurs during the operation, it leaves the newly opened route alone.

Manual loaders participate through `useViewRefresh`; use a background loader that leaves its controls and dialogs mounted and retains applied filters independently of unsaved filter edits. Saved local lists accept new server props through `useServerDataState`. Manual drafts use `useServerDraftState` to accept refreshed values while pristine and preserve edits until saved. Dialog initialization is scoped to an opening and record through `useEditSession`.

No architecture decision record is needed: this is a reversible interface behavior built on the existing data-loading systems.
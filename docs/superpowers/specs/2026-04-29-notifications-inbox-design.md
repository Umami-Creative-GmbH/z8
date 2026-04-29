# Notifications Inbox Design

## Summary

Add a localized `/notifications` page that turns the existing notification popover link into a full inbox. The inbox will reuse the current organization-scoped notifications API, query hook, and notification item behavior while adding page-level search, status filtering, grouping, and bulk management.

## Goals

- Make the existing `View all notifications` link resolve to a real app page.
- Provide a richer inbox than the popover without changing notification storage or delivery.
- Preserve current multi-tenant isolation by relying on the existing API, which scopes reads and bulk operations to the active organization.
- Keep the first implementation small enough to ship safely.

## Non-Goals

- No new notification database tables or delivery channels.
- No server-side search endpoint in this pass.
- No changes to notification generation, SSE delivery, or external integrations.

## Architecture

- Add `src/app/[locale]/(app)/notifications/page.tsx` as the app route.
- Add a focused client component under `src/components/notifications/` for inbox state and interactions.
- Reuse `useNotifications` for fetching, unread count, refresh, mark-as-read, mark-all-read, and delete operations.
- Fetch a larger notification page than the popover and apply search, read-state filters, grouping, and selected-item state in the client. Use the existing active-organization checks already enforced by `/api/notifications`; do not add a second organization selector on the page.
- Reuse existing notification types and keep the existing `/api/notifications` organization scoping unchanged.

## User Interface

The page header shows the inbox title, unread count, refresh action, and a link to notification settings. A toolbar provides text search and `All`, `Unread`, and `Read` filters.

The main list groups matching notifications into `Today`, `Yesterday`, and `Earlier`. Each notification keeps the current icon, read marker, click-to-open action URL, mark-as-read action, and delete action. The inbox adds row selection for bulk work.

Bulk mode appears when at least one notification is selected. Users can clear the selection, mark selected unread notifications as read, or delete selected notifications. Bulk operations call existing single-notification mutations for selected rows and refresh query state through the existing invalidation behavior.

## States

- Loading: show page-level skeleton rows.
- No notifications: show an empty inbox message.
- No unread notifications: show a caught-up message when the unread filter has no results.
- No search results: show a message that the current query matched nothing.
- Error: show a retryable error card using the hook error state.

## Data Flow

1. The page renders the notifications inbox client component.
2. The component calls `useNotifications` with a larger limit. The API derives the active organization from the authenticated session and rejects requests without an active organization.
3. Notifications are filtered client-side by read state and query text.
4. Filtered notifications are grouped by `createdAt` into `Today`, `Yesterday`, and `Earlier`.
5. Single-row actions call the existing hook mutations.
6. Bulk actions iterate over selected IDs and call the existing hook mutations, then clear selection after completion.

## Testing And Verification

- Verify `/notifications` loads for an authenticated app user.
- Verify search, status filters, grouping, row selection, mark-as-read, delete, and settings navigation.
- Run the relevant project checks available without external secrets, at minimum type/lint checks if configured.

## Future Consideration

- This design intentionally uses client-side filtering for the first version. If notification histories become too large, a later API-backed search and pagination pass can extend `/api/notifications` with query and status parameters.

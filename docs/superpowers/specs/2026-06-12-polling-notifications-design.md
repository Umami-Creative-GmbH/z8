# Polling Notifications Design

## Summary

Replace realtime in-app notification updates with low-frequency polling. The notification bell and inbox will use the existing organization-scoped notification APIs instead of opening Server-Sent Event streams backed by Redis pub/sub.

The change intentionally favors process stability and infrastructure simplicity over instant in-app notification delivery. Push, email, and external channel notifications are out of scope and should continue to work as they do today.

## Context

The current notification stream path opens `EventSource("/api/notifications/stream")` from the notification bell. The stream route authenticates the user, verifies the active organization, and then creates a Redis subscriber for the user's notification channel. If Redis is unavailable, the route falls back to per-client database polling every five seconds.

This creates avoidable runtime pressure:

- each active browser can hold a long-lived Next.js request
- each stream can create a dedicated Redis subscriber connection
- Redis outages can turn connected clients into frequent database pollers
- a separate notify-server plan would reduce some pressure but add another service and keep Redis in the notification path

Notifications do not need second-level freshness for the current product behavior. A polling model is a simpler fit.

## Goals

- Stop opening realtime notification streams from the webapp UI.
- Remove notification Redis pub/sub from in-app notification updates.
- Poll notification count and list data every 20 minutes.
- Keep immediate UI refresh after explicit user actions such as mark-as-read and delete.
- Preserve active-organization scoping by continuing to use the existing notification APIs.
- Keep Redis available for other existing uses, including auth secondary storage, rate limiting, queue infrastructure, and caches.
- Make the prior notify-server direction clearly superseded so future work does not implement it accidentally.

## Non-Goals

- No changes to notification table schema.
- No changes to notification creation rules, preference rules, email, push, Slack, Teams, Telegram, Discord, or webhook delivery.
- No new background job for polling.
- No new notification aggregation endpoint in the first pass.
- No removal of Redis from the application as a whole.

## Recommended Approach

Use polling-only in-app notifications and retire the realtime notification path.

Alternatives considered:

- Keep realtime and build `apps/notify-server`: preserves instant updates but adds a service and still depends on Redis for in-app notification delivery.
- Switch to polling but keep notify-server docs as future work: technically safe, but confusing because the repo would still describe a direction we no longer intend to build.
- Poll every 15 minutes: also acceptable, but 20 minutes further reduces load and matches the goal of making notifications low-pressure.

## Client Behavior

`NotificationBell` will no longer call `useNotificationStream`. It will rely on `useNotifications` for the unread count.

`useNotifications` will configure React Query polling for both the list query and unread-count query:

- `refetchInterval`: 20 minutes
- `refetchOnWindowFocus`: true
- stale time aligned with the polling model, not the old SSE model

The hook will keep its mutation invalidation behavior. Marking one notification read, marking all read, deleting one notification, deleting all notifications, and manual refresh will still invalidate the notification query group immediately.

The inbox and popover will receive fresher data when opened or focused through normal React Query behavior, but they will no longer receive new notification rows pushed into cache by SSE events.

## Server Behavior

Remove the notification stream endpoint from the app route tree:

- delete `/api/notifications/stream`
- delete stream route tests
- remove the stream hook and stream hook tests

Notification APIs that remain:

- `GET /api/notifications`
- `GET /api/notifications/count`
- `PATCH /api/notifications`
- `DELETE /api/notifications`
- push subscription and preference APIs

These existing endpoints already derive the active organization from the authenticated session, verify an active employee record, and pass the organization id into notification-service queries. The polling model should keep that security boundary unchanged.

## Redis Cleanup

Remove Redis code that exists only for realtime notification fanout:

- `publishNotificationEvent`
- `redisPub`, if no other code uses it
- `createRedisSubscriber`
- notification-service calls that publish `new_notification` and `count_update`

Do not remove `redis`, `ensureRedisReady`, or `secondaryStorage`, because they are still used by auth, rate limiting, setup/vault caches, and queue/worker infrastructure.

## Documentation Updates

The existing notify-server spec and plan should be marked as superseded by this polling-notifications design. They should not be deleted, because they document the prior analysis and may remain useful if realtime delivery becomes necessary later.

README claims that notification center updates are SSE-powered should be updated to describe periodic in-app refresh instead.

## Error Handling

Polling uses the existing React Query error states. If a poll fails, React Query keeps prior data available and retries according to the existing query client defaults.

Explicit user actions continue to return endpoint errors through the existing mutation paths. The design does not add custom retry UI for background poll failures.

## Testing And Verification

Tests should verify:

- `NotificationBell` no longer imports or starts the notification stream hook.
- `useNotifications` configures 20-minute polling for list and unread-count queries.
- mutations still invalidate `queryKeys.notifications.all`.
- notification-service no longer publishes Redis notification events after create, mark-read, or mark-all-read.
- removed stream hook and stream route tests are no longer referenced.

Verification commands should include focused notification tests first, then broader checks if feasible:

- `pnpm --filter webapp test -- src/hooks/use-notifications.test.ts src/components/notifications/notification-bell.test.tsx src/lib/notifications/__tests__/notification-service.test.ts`
- `pnpm --filter webapp check-types` if available
- `CI=true pnpm build` when time and environment allow

## Rollout Notes

This is a behavior simplification, not a database migration. Deployment can happen with normal webapp rollout.

If users report that in-app notification freshness is too slow, the first adjustment should be lowering the polling interval before reintroducing realtime infrastructure.

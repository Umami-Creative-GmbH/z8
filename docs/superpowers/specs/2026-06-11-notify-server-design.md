# Notify Server Design

## Summary

Move notification SSE streaming out of the Next.js webapp into a separate `apps/notify-server` service. The service will be Bun-first, Node-compatible, and deployed behind the same public origin so browsers continue to connect to `/api/notifications/stream` with existing cookies.

The main scaling improvement is not only moving the stream route. `notify-server` will replace the current one-Redis-subscriber-per-browser-connection model with shared Redis fanout per service instance.

## Goals

- Remove long-lived SSE connections from the main Next.js webapp runtime.
- Reduce webapp CPU and memory pressure caused by notification streams.
- Preserve the existing browser contract: `EventSource("/api/notifications/stream")`.
- Preserve Better Auth session validation and active organization scoping.
- Avoid per-client Redis subscriber connections.
- Keep the first implementation small enough to ship and benchmark safely.

## Non-Goals

- No notification UX changes.
- No changes to notification storage or existing notification generation.
- No cross-origin streaming endpoint in the first pass.
- No Go or Rust implementation in the first pass.
- No DB polling fallback per connected client.

## Architecture

Add `apps/notify-server` as a pnpm workspace app. It should be a small TypeScript service, not a Next.js app. The preferred runtime is Bun, but the service should stay close to web-standard APIs so it can run under Node if Better Auth, Redis, or deployment compatibility requires fallback.

Production routing keeps `/api/notifications/stream` on the same public origin as the webapp and proxies that path to `notify-server`. Same-origin routing lets the browser send the existing Better Auth cookies without CORS or cross-subdomain cookie changes.

`notify-server` owns only real-time notification streaming and health checks. The existing webapp remains responsible for notification creation, persistence, user preferences, push, email, and external channel delivery.

## Runtime Strategy

The implementation should be Bun-first:

- use `Request`, `Response`, `ReadableStream`, `TextEncoder`, and `AbortSignal` where practical
- use Bun's direct server API for the primary runtime and a thin Node adapter only as fallback
- avoid framework features that bind the service to Next.js
- keep a Node start path until Bun compatibility is proven

The service should not reimplement Better Auth session parsing. It should import and use the existing Better Auth server configuration, equivalent to the current webapp `auth.api.getSession({ headers })` flow. If that path does not run reliably under Bun, run the same service under Node rather than duplicating auth semantics.

Go and Rust remain future options if `notify-server` itself becomes the bottleneck after fanout and runtime isolation. They are not first-pass choices because they would need a webapp auth validation callback or a duplicated Better Auth session implementation.

## Authentication And Tenant Isolation

Each stream connection must be authenticated and organization-scoped before it is registered for fanout.

Connection validation rules:

- reject unauthenticated requests
- require `session.session.activeOrganizationId`
- query `employee` by `session.user.id`, `activeOrganizationId`, and `isActive = true`
- use the employee organization as the connection organization
- never accept `organizationId` from query params or client payloads

Event forwarding rules:

- only forward `new_notification` and `count_update` events
- require event payloads to include `organizationId`
- forward an event only when payload `organizationId` matches the connection organization
- keep existing user-level targeting from the Redis notification channel semantics

## Redis Fanout

The current webapp route creates a dedicated Redis subscriber for each SSE connection. `notify-server` should instead keep a process-local connection registry and use shared Redis subscribers per service instance.

The registry stores active clients by `userId`, with each client record containing:

- connection id
- user id
- organization id
- SSE send function or stream controller
- cleanup state

Redis messages continue to use the existing notification event shape. On message receipt, `notify-server` parses and validates the message, finds connected clients for the target user, filters by organization, and writes SSE frames to matching clients.

For one service instance, one shared subscriber is enough. For multiple service instances, each instance can subscribe and fan out only to its local clients. This still scales better than one Redis subscriber per browser connection and does not require sticky sessions for correctness.

## Data Flow

1. The webapp UI opens `EventSource("/api/notifications/stream")`.
2. The reverse proxy routes that path to `notify-server`.
3. `notify-server` validates the Better Auth session and active organization.
4. `notify-server` verifies the user has an active employee record in that organization.
5. `notify-server` sends the initial unread `count_update`.
6. Existing notification creation code continues publishing Redis notification events.
7. `notify-server` receives Redis events through shared subscriber fanout.
8. Matching connected clients receive `new_notification` and `count_update` SSE events.
9. Existing React Query cache update logic remains mostly unchanged.

## Failure Behavior

Redis outage handling must not recreate the current CPU problem in another service. The first pass should not fall back to per-client database polling every few seconds.

When Redis is unavailable, `notify-server` should close affected streams in a retryable way so browser `EventSource` reconnect behavior can recover after Redis returns. The service should keep reconnecting its shared Redis subscriber in the background with bounded backoff and throttled logs. It should not hold authenticated streams open indefinitely when it cannot deliver Redis-backed notification events.

Additional behavior:

- send heartbeat events roughly every 30 seconds
- clean up registry entries immediately on disconnect or stream cancellation
- avoid writing to closed stream controllers
- expose a `/health` endpoint for container and proxy checks
- log auth failures, Redis failures, and stream setup failures without leaking sensitive cookie or session data

## Webapp Changes

The browser API should stay stable. The existing client hook can keep using `/api/notifications/stream`.

The Next.js route handler should be removed from the production hot path once proxy routing exists. During rollout, it may remain only as a temporary development fallback. The final production design should not keep long-lived streams inside the webapp runtime.

Notification publishing in the webapp should continue using Redis. Any changes to the event payload must preserve `organizationId` so `notify-server` can enforce tenant filtering.

## Deployment

Add a separate deployable target for `notify-server`:

- workspace app: `apps/notify-server`
- container or process separate from `webapp`
- public routing: same-origin proxy for `/api/notifications/stream`
- internal health route: `/health`

The service needs the same system-level infrastructure environment as the webapp for auth/session validation, database access, and Redis. Tenant-specific configuration remains in the database and must not move to environment variables.

## Testing And Verification

Tests should cover:

- unauthenticated request rejection
- missing active organization rejection
- inactive or missing employee rejection
- initial unread count SSE frame
- organization-scoped event filtering
- unsupported event filtering
- fanout to multiple connections for the same user
- no fanout to another organization
- disconnect cleanup
- Redis reconnect or retryable failure behavior
- `/health` response

Compatibility verification should prove:

- Bun can execute Better Auth session validation using the existing auth configuration
- Bun can use the selected Redis client for pub/sub fanout
- Bun can hold many idle SSE connections without unexpected memory growth
- the same service can run under Node if Bun compatibility fails

Operational verification should compare webapp CPU and memory before and after routing streams to `notify-server`.

## Implementation Planning Decisions

- Use Bun's direct server API first, with a thin Node adapter fallback.
- Close streams for retry when Redis is unavailable instead of keeping undeliverable connections open.
- Keep the existing browser URL and route it to `notify-server` through same-origin proxying.
- Remove the Next.js stream route from production after proxy routing is active; keep any fallback development-only and temporary.

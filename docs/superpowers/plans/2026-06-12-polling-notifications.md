# Polling Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace realtime in-app notification updates with low-frequency polling and remove notification-specific Redis pub/sub/SSE code.

**Architecture:** Keep the existing organization-scoped notification HTTP APIs as the only in-app notification data source. Configure the shared notification hook to poll list and unread-count queries every 20 minutes while preserving immediate invalidation after user mutations. Delete the SSE stream route/hook and remove Redis notification fanout publishing, while keeping Redis for auth, rate limiting, queues, and caches.

**Tech Stack:** Next.js route handlers, React 19, TanStack Query, Vitest, Drizzle, Redis/ioredis for remaining non-notification infrastructure, pnpm.

---

## File Structure

- Modify `apps/webapp/src/hooks/use-notifications.ts`: define the polling interval and apply it to notification list and unread-count queries.
- Modify `apps/webapp/src/hooks/use-notifications.test.ts`: add tests proving both queries use the 20-minute refetch interval.
- Modify `apps/webapp/src/components/notifications/notification-bell.tsx`: remove `useNotificationStream` import and call.
- Create `apps/webapp/src/components/notifications/notification-bell.test.tsx`: guard against reintroducing the stream hook in the bell.
- Delete `apps/webapp/src/hooks/use-notification-stream.ts`: remove SSE client hook.
- Delete `apps/webapp/src/hooks/use-notification-stream.test.ts`: remove SSE cache update tests.
- Delete `apps/webapp/src/hooks/use-notification-stream.reconnect.test.tsx`: remove SSE reconnect tests.
- Delete `apps/webapp/src/app/api/notifications/stream/route.ts`: remove SSE stream route.
- Delete `apps/webapp/src/app/api/notifications/stream/route.test.ts`: remove stream route tests.
- Modify `apps/webapp/src/lib/redis.ts`: remove notification-only pub/sub exports while keeping `redis`, `ensureRedisReady`, and `secondaryStorage`.
- Modify `apps/webapp/src/lib/redis.test.ts`: remove `redisPub` expectations and keep remaining Redis behavior covered.
- Modify `apps/webapp/src/lib/notifications/notification-service.ts`: remove notification Redis publish calls and import.
- Modify `apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts`: remove the Redis mock and replace realtime publish assertions with assertions that persistence and org scoping still happen.
- Modify `apps/webapp/src/lib/auth/__tests__/org-scoping.test.ts`: remove the notification stream route org-scoping test block if present.
- Modify `README.md` and `README.en.md`: replace SSE-powered notification claims with periodic refresh wording.
- Modify `docs/superpowers/specs/2026-06-11-notify-server-design.md`: add a superseded notice pointing to polling notifications.
- Modify `docs/superpowers/plans/2026-06-11-notify-server.md`: add a superseded notice pointing to polling notifications.

## Task 1: Add Polling Tests And Hook Configuration

**Files:**
- Modify: `apps/webapp/src/hooks/use-notifications.test.ts`
- Modify: `apps/webapp/src/hooks/use-notifications.ts`

- [ ] **Step 1: Add failing polling tests**

Append these tests inside the existing `describe("useNotifications", () => { ... })` block in `apps/webapp/src/hooks/use-notifications.test.ts` after the existing organization key tests:

```ts
	it("polls the notification list every 20 minutes", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				refetchInterval: 20 * 60 * 1000,
				refetchOnWindowFocus: true,
			}),
		);
	});

	it("polls the unread count every 20 minutes", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				refetchInterval: 20 * 60 * 1000,
				refetchOnWindowFocus: true,
			}),
		);
	});
```

- [ ] **Step 2: Run the hook test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- src/hooks/use-notifications.test.ts
```

Expected: FAIL because neither query currently sets `refetchInterval: 20 * 60 * 1000`.

- [ ] **Step 3: Add the polling interval constant and query options**

In `apps/webapp/src/hooks/use-notifications.ts`, add this constant after the imports:

```ts
const NOTIFICATION_POLL_INTERVAL_MS = 20 * 60 * 1000;
```

Update the list query options to use the interval and remove the old SSE-oriented comment/freshness assumption:

```ts
	const notificationsQuery = useQuery({
		queryKey: queryKeys.notifications.list(listOptions),
		queryFn: async (): Promise<NotificationsListResponse> => {
			const params = new URLSearchParams({
				limit: limit.toString(),
				unreadOnly: unreadOnly.toString(),
			});
			return fetchApi<NotificationsListResponse>(`/api/notifications?${params}`);
		},
		enabled,
		staleTime: NOTIFICATION_POLL_INTERVAL_MS,
		refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
	});
```

Update the unread-count query options to match:

```ts
	const unreadCountQuery = useQuery({
		queryKey: queryKeys.notifications.unreadCount(organizationId),
		queryFn: async (): Promise<UnreadCountResponse> => {
			return fetchApi<UnreadCountResponse>("/api/notifications/count");
		},
		enabled,
		staleTime: NOTIFICATION_POLL_INTERVAL_MS,
		refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
	});
```

- [ ] **Step 4: Run the hook test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- src/hooks/use-notifications.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit hook polling**

Run:

```bash
git add apps/webapp/src/hooks/use-notifications.ts apps/webapp/src/hooks/use-notifications.test.ts
git commit -m "refactor(notifications): poll in-app notification queries"
```

## Task 2: Remove Notification Stream From The Bell

**Files:**
- Create: `apps/webapp/src/components/notifications/notification-bell.test.tsx`
- Modify: `apps/webapp/src/components/notifications/notification-bell.tsx`

- [ ] **Step 1: Add a failing guard test for stream removal**

Create `apps/webapp/src/components/notifications/notification-bell.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-notifications", () => ({
	useNotifications: () => ({ unreadCount: 3 }),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-a" }),
}));

vi.mock("./notification-popover", () => ({
	NotificationPopover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("NotificationBell", () => {
	it("renders the unread count without requiring a realtime stream provider", async () => {
		const { NotificationBell } = await import("./notification-bell");

		render(<NotificationBell />);

		expect(screen.getByLabelText("Notifications (3 unread)")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run the bell test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- src/components/notifications/notification-bell.test.tsx
```

Expected: FAIL because `NotificationBell` still imports and calls `useNotificationStream`, which pulls in the real TanStack Query stream hook in this focused component test.

- [ ] **Step 3: Remove the stream hook from the bell**

Update `apps/webapp/src/components/notifications/notification-bell.tsx` by removing this import:

```ts
import { useNotificationStream } from "@/hooks/use-notification-stream";
```

Remove this call and its comment:

```ts
	// Connect to SSE for real-time updates
	useNotificationStream({ enabled: hasOrganization, organizationId });
```

The top of the file should now import only the notification query hook and organization hook for notification state:

```ts
import { IconBell } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";
import { cn } from "@/lib/utils";
import { NotificationPopover } from "./notification-popover";
```

- [ ] **Step 4: Run the bell test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- src/components/notifications/notification-bell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit bell stream removal**

Run:

```bash
git add apps/webapp/src/components/notifications/notification-bell.tsx apps/webapp/src/components/notifications/notification-bell.test.tsx
git commit -m "refactor(notifications): stop opening realtime stream"
```

## Task 3: Remove SSE Route And Hook Files

**Files:**
- Delete: `apps/webapp/src/hooks/use-notification-stream.ts`
- Delete: `apps/webapp/src/hooks/use-notification-stream.test.ts`
- Delete: `apps/webapp/src/hooks/use-notification-stream.reconnect.test.tsx`
- Delete: `apps/webapp/src/app/api/notifications/stream/route.ts`
- Delete: `apps/webapp/src/app/api/notifications/stream/route.test.ts`
- Modify: `apps/webapp/src/lib/auth/__tests__/org-scoping.test.ts`

- [ ] **Step 1: Find all remaining stream references**

Run:

```bash
rg "useNotificationStream|notifications/stream|EventSource|count_update|new_notification" apps/webapp/src
```

Expected before deletion: matches in the stream hook, stream route, their tests, `notification-bell.tsx` if Task 2 was not completed, and notification-service Redis publish code that Task 4 will handle.

- [ ] **Step 2: Delete the stream hook and stream route files**

Delete these files:

```text
apps/webapp/src/hooks/use-notification-stream.ts
apps/webapp/src/hooks/use-notification-stream.test.ts
apps/webapp/src/hooks/use-notification-stream.reconnect.test.tsx
apps/webapp/src/app/api/notifications/stream/route.ts
apps/webapp/src/app/api/notifications/stream/route.test.ts
```

- [ ] **Step 3: Remove org-scoping stream tests if present**

Open `apps/webapp/src/lib/auth/__tests__/org-scoping.test.ts` and remove the `describe("notifications/stream route", () => { ... })` block. Do not remove org-scoping tests for the remaining notification list/count/update/delete APIs.

- [ ] **Step 4: Verify stream references are limited to docs and notification-service publish code**

Run:

```bash
rg "useNotificationStream|notifications/stream|EventSource" apps/webapp/src
```

Expected: no matches in `apps/webapp/src`.

Run:

```bash
rg "count_update|new_notification" apps/webapp/src/lib/notifications apps/webapp/src/lib/redis.ts
```

Expected: matches remain only in notification-service and Redis code that Task 4 removes.

- [ ] **Step 5: Run focused tests for remaining notification UI hook behavior**

Run:

```bash
pnpm --filter webapp test -- src/hooks/use-notifications.test.ts src/components/notifications/notification-bell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit stream file deletion**

Run:

```bash
git add apps/webapp/src/hooks/use-notification-stream.ts apps/webapp/src/hooks/use-notification-stream.test.ts apps/webapp/src/hooks/use-notification-stream.reconnect.test.tsx apps/webapp/src/app/api/notifications/stream/route.ts apps/webapp/src/app/api/notifications/stream/route.test.ts apps/webapp/src/lib/auth/__tests__/org-scoping.test.ts
git commit -m "refactor(notifications): remove SSE stream endpoint"
```

## Task 4: Remove Notification Redis Pub/Sub Publishing

**Files:**
- Modify: `apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts`
- Modify: `apps/webapp/src/lib/notifications/notification-service.ts`
- Modify: `apps/webapp/src/lib/redis.ts`
- Modify: `apps/webapp/src/lib/redis.test.ts`

- [ ] **Step 1: Update notification-service tests to stop expecting Redis publish events**

In `apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts`, remove `mockPublishNotificationEvent` from the hoisted mock object and remove this mock block:

```ts
vi.mock("@/lib/redis", () => ({
	publishNotificationEvent: mockPublishNotificationEvent,
}));
```

Replace the test named `requires organizationId and publishes scoped count updates` with:

```ts
		test("requires organizationId and keeps updates scoped", async () => {
			const mockNotification = createMockNotification({
				isRead: true,
				organizationId: "org-a",
				readAt: new Date(),
			});
			mockReturning.mockImplementation(() => Promise.resolve([mockNotification]));

			const { markAsRead } = await import("../notification-service");

			expect(markAsRead.length).toBe(3);
			await markAsRead("notif-1", "user-1", "org-a");

			expect(mockUpdateWhere).toHaveBeenCalled();
		});
```

Replace the test named `publishes scoped count updates` under `markAllAsRead` with:

```ts
		test("marks all unread notifications in the scoped organization", async () => {
			mockReturning.mockImplementation(() => Promise.resolve([{ id: "notif-1" }]));

			const { markAllAsRead } = await import("../notification-service");

			const result = await markAllAsRead("user-1", "org-a");

			expect(result).toBe(1);
			expect(mockUpdateWhere).toHaveBeenCalled();
		});
```

- [ ] **Step 2: Run notification-service tests and verify they fail on the implementation import**

Run:

```bash
pnpm --filter webapp test -- src/lib/notifications/__tests__/notification-service.test.ts
```

Expected: FAIL because `notification-service.ts` still imports and calls `publishNotificationEvent`.

- [ ] **Step 3: Remove Redis publish calls from notification-service**

In `apps/webapp/src/lib/notifications/notification-service.ts`, remove this import:

```ts
import { publishNotificationEvent } from "@/lib/redis";
```

Remove the `notifWithMeta` block in `createNotification`:

```ts
			// Publish to Redis for real-time SSE updates
			const notifWithMeta = {
				...created,
				timeAgo: getTimeAgo(created.createdAt),
			};
			void publishNotificationEvent(params.userId, "new_notification", notifWithMeta).catch(
				(error) => {
					logger.error({ error, userId: params.userId }, "Failed to publish notification event");
				},
			);
```

Remove the count publish block in `markAsRead`:

```ts
			// Publish count update to Redis for real-time SSE updates
			// Get organizationId from the updated notification
			const newCount = await getUnreadCount(userId, organizationId);
			void publishNotificationEvent(userId, "count_update", {
				count: newCount,
				organizationId,
			}).catch((error) => {
				logger.error({ error, userId }, "Failed to publish count update event");
			});
```

Remove the count publish block in `markAllAsRead`:

```ts
		// Publish count update to Redis for real-time SSE updates (count is now 0)
		if (updatedCount > 0) {
			void publishNotificationEvent(userId, "count_update", { count: 0, organizationId }).catch(
				(error) => {
					logger.error({ error, userId }, "Failed to publish count update event");
				},
			);
		}
```

- [ ] **Step 4: Remove notification-only Redis exports**

In `apps/webapp/src/lib/redis.ts`, remove `redisPub` from `globalForRedis`:

```ts
const globalForRedis = globalThis as unknown as {
	redis: Redis | undefined;
};
```

Delete the `redisPub` singleton block:

```ts
// Dedicated publisher client for pub/sub (pub/sub clients can't be used for regular commands)
export const redisPub = shouldDisableRedisDuringBuild
	? noopRedisClient
	: (() => {
			if (!globalForRedis.redisPub) {
				globalForRedis.redisPub = createRedisClient();
			}

			return globalForRedis.redisPub;
		})();
```

Delete `createRedisSubscriber` and `publishNotificationEvent`:

```ts
export function createRedisSubscriber(): Redis {
	if (shouldDisableRedisDuringBuild) {
		return noopRedisClient;
	}

	return createRedisClient();
}

export async function publishNotificationEvent(
	userId: string,
	event: "new_notification" | "count_update",
	data: unknown,
): Promise<void> {
	try {
		const channel = `notifications:${userId}`;
		const message = JSON.stringify({ event, data });
		await redisPub.publish(channel, message);
	} catch (error) {
		logger.error({ error, userId, event }, "Failed to publish notification event");
	}
}
```

Keep `noopRedisClient.publish` unchanged unless TypeScript proves it is no longer needed; it is harmless as part of the Redis-shaped test double.

- [ ] **Step 5: Update Redis tests for removed publisher client**

In `apps/webapp/src/lib/redis.test.ts`, remove any assertion or cleanup that references `redisPub` or `globalThis.redisPub`. Keep tests for `redis`, `ensureRedisReady`, `secondaryStorage`, TLS config, and build-time noop behavior.

- [ ] **Step 6: Verify no notification pub/sub symbols remain in source**

Run:

```bash
rg "publishNotificationEvent|createRedisSubscriber|redisPub|count_update|new_notification" apps/webapp/src
```

Expected: no matches in `apps/webapp/src`.

- [ ] **Step 7: Run notification and Redis tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/notifications/__tests__/notification-service.test.ts src/lib/redis.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Redis publish removal**

Run:

```bash
git add apps/webapp/src/lib/notifications/notification-service.ts apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts apps/webapp/src/lib/redis.ts apps/webapp/src/lib/redis.test.ts
git commit -m "refactor(notifications): remove Redis notification fanout"
```

## Task 5: Update Documentation For Polling Direction

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/superpowers/specs/2026-06-11-notify-server-design.md`
- Modify: `docs/superpowers/plans/2026-06-11-notify-server.md`

- [ ] **Step 1: Update README notification claims**

In `README.en.md`, replace the realtime bullet:

```md
- **Real-Time Updates**: Notification center powered by Server-Sent Events (SSE) for instant feedback on approvals.
```

with:

```md
- **Periodic Updates**: Notification center refreshes in the background and on focus without long-lived realtime streams.
```

In `README.md`, replace the German realtime bullet:

```md
- **Echtzeit-Updates**: Notification Center auf Basis von Server-Sent Events (SSE) für unmittelbares Feedback bei Freigaben.
```

with:

```md
- **Regelmäßige Updates**: Das Notification Center aktualisiert sich im Hintergrund und beim Fokuswechsel ohne langlebige Echtzeit-Streams.
```

- [ ] **Step 2: Mark notify-server spec as superseded**

Add this notice after the title in `docs/superpowers/specs/2026-06-11-notify-server-design.md`:

```md
> **Superseded:** This realtime notify-server design is superseded by `docs/superpowers/specs/2026-06-12-polling-notifications-design.md`. Do not implement this service unless a future spec explicitly reintroduces realtime in-app notification delivery.
```

- [ ] **Step 3: Mark notify-server plan as superseded**

Add this notice after the title in `docs/superpowers/plans/2026-06-11-notify-server.md`:

```md
> **Superseded:** This implementation plan is superseded by `docs/superpowers/specs/2026-06-12-polling-notifications-design.md` and should not be executed unless realtime in-app notification delivery is reapproved in a new spec.
```

- [ ] **Step 4: Verify documentation references**

Run:

```bash
rg "Server-Sent Events \(SSE\)|EventSource\(\"/api/notifications/stream\"\)|notify-server" README.md README.en.md docs/superpowers/specs/2026-06-11-notify-server-design.md docs/superpowers/plans/2026-06-11-notify-server.md docs/superpowers/specs/2026-06-12-polling-notifications-design.md
```

Expected: README files no longer claim SSE-powered notification updates. Notify-server matches remain only in superseded documents and the polling design's context/discussion.

- [ ] **Step 5: Commit documentation updates**

Run:

```bash
git add README.md README.en.md docs/superpowers/specs/2026-06-11-notify-server-design.md docs/superpowers/plans/2026-06-11-notify-server.md
git commit -m "docs: mark realtime notifications superseded"
```

## Task 6: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Check source no longer references notification streaming**

Run:

```bash
rg "useNotificationStream|notifications/stream|EventSource|publishNotificationEvent|createRedisSubscriber|redisPub|count_update|new_notification" apps/webapp/src
```

Expected: no matches.

- [ ] **Step 2: Run focused notification test suite**

Run:

```bash
pnpm --filter webapp test -- src/hooks/use-notifications.test.ts src/components/notifications/notification-bell.test.tsx src/lib/notifications/__tests__/notification-service.test.ts src/lib/redis.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader test coverage for notification components**

Run:

```bash
pnpm --filter webapp test -- src/components/notifications src/hooks/use-notifications.test.ts src/lib/notifications/__tests__/notification-types.test.ts src/lib/notifications/__tests__/notification-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run type/build verification**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If this fails because external environment variables or services are unavailable, record the exact failure and do not claim full build verification.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- apps/webapp/src/hooks/use-notifications.ts apps/webapp/src/components/notifications/notification-bell.tsx apps/webapp/src/lib/notifications/notification-service.ts apps/webapp/src/lib/redis.ts README.md README.en.md
```

Expected: only intentional polling-notification changes are present. Existing unrelated deleted `.agents/skills` files may remain in the worktree; do not stage, revert, or modify them.

- [ ] **Step 6: Commit any final verification-only fixes if needed**

If Step 4 or Step 5 required small fixes, stage only the exact files changed during final verification. For example, if final verification only required documentation wording fixes, run:

```bash
git add README.md README.en.md docs/superpowers/specs/2026-06-11-notify-server-design.md docs/superpowers/plans/2026-06-11-notify-server.md
git commit -m "fix: finalize polling notification cleanup"
```

If no final fixes were needed, do not create an empty commit.

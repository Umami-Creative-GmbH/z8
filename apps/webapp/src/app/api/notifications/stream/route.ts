import { and, desc, eq, gt } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, notification } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";
import type { NotificationWithMeta } from "@/lib/notifications/types";

/**
 * Calculate relative time string
 */
function getTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffSeconds < 60) return "just now";
	if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
	if (diffDays < 30) {
		const weeks = Math.floor(diffDays / 7);
		return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
	}
	const months = Math.floor(diffDays / 30);
	return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * GET /api/notifications/stream
 * Server-Sent Events endpoint for real-time notification updates
 *
 * Sends:
 * - count_update: When unread count changes (includes count)
 * - new_notification: When a new notification arrives (includes the notification data)
 * - heartbeat: Every 30 seconds to keep connection alive
 */
export async function GET() {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return new Response("Unauthorized", { status: 401 });
		}

		// Get organization from employee record (more reliable than session cache)
		const [emp] = await db
			.select({ organizationId: employee.organizationId })
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!emp) {
			return new Response("No active employee record", { status: 400 });
		}

		const userId = session.user.id;
		const organizationId = emp.organizationId;

		// Create a readable stream for SSE
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				// Helper to send SSE event
				const sendEvent = (type: string, data: unknown) => {
					try {
						const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
						controller.enqueue(encoder.encode(event));
					} catch {
						// Controller might be closed
					}
				};

				// Send initial count
				const initialCount = await getUnreadCount(userId, organizationId);
				sendEvent("count_update", { count: initialCount });

				// Track state for change detection
				let lastCount = initialCount;
				let lastNotificationId: string | null = null;

				// Get the most recent notification ID to track new ones
				const [latestNotification] = await db
					.select({ id: notification.id })
					.from(notification)
					.where(eq(notification.userId, userId))
					.orderBy(desc(notification.createdAt))
					.limit(1);

				if (latestNotification) {
					lastNotificationId = latestNotification.id;
				}

				// Poll for updates every 3 seconds (more responsive than 5s)
				const pollInterval = setInterval(async () => {
					try {
						const currentCount = await getUnreadCount(userId, organizationId);

						// If count increased, fetch and send new notifications
						if (currentCount > lastCount) {
							// Fetch notifications newer than the last one we saw
							const newNotificationsQuery = lastNotificationId
								? db
										.select()
										.from(notification)
										.where(
											and(
												eq(notification.userId, userId),
												gt(notification.createdAt,
													db.select({ createdAt: notification.createdAt })
														.from(notification)
														.where(eq(notification.id, lastNotificationId))
												)
											)
										)
										.orderBy(desc(notification.createdAt))
										.limit(10)
								: db
										.select()
										.from(notification)
										.where(eq(notification.userId, userId))
										.orderBy(desc(notification.createdAt))
										.limit(currentCount - lastCount);

							const newNotifications = await newNotificationsQuery;

							// Send each new notification
							for (const notif of newNotifications.reverse()) {
								const notifWithMeta: NotificationWithMeta = {
									...notif,
									timeAgo: getTimeAgo(notif.createdAt),
								};
								sendEvent("new_notification", notifWithMeta);

								// Update last notification ID
								lastNotificationId = notif.id;
							}
						}

						// Always send count update if changed
						if (currentCount !== lastCount) {
							sendEvent("count_update", { count: currentCount });
							lastCount = currentCount;
						}
					} catch {
						// Ignore polling errors
					}
				}, 3000);

				// Send heartbeat every 30 seconds
				const heartbeatInterval = setInterval(() => {
					try {
						sendEvent("heartbeat", { timestamp: Date.now() });
					} catch {
						// Connection might be closed
						clearInterval(pollInterval);
						clearInterval(heartbeatInterval);
					}
				}, 30000);

				// Cleanup on close
				const cleanup = () => {
					clearInterval(pollInterval);
					clearInterval(heartbeatInterval);
				};

				// Handle abort
				return cleanup;
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no", // Disable nginx buffering
			},
		});
	} catch (error) {
		console.error("Error in notification stream:", error);
		return new Response("Internal server error", { status: 500 });
	}
}

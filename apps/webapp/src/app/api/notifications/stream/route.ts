import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";
import { createValkeySubscriber, valkey } from "@/lib/valkey";

/**
 * GET /api/notifications/stream
 * Server-Sent Events endpoint for real-time notification updates
 *
 * Uses Valkey Pub/Sub for event-driven updates instead of database polling.
 * This scales to thousands of concurrent connections without database overhead.
 *
 * Sends:
 * - count_update: When unread count changes (includes count)
 * - new_notification: When a new notification arrives (includes the notification data)
 * - heartbeat: Every 30 seconds to keep connection alive
 */
export async function GET() {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return new Response("Unauthorized", { status: 401 });
		}

		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return new Response("No active organization", { status: 400 });
		}

		// Get employee record for the active organization ONLY
		let emp: { organizationId: string } | undefined;
		try {
			const result = await db
				.select({ organizationId: employee.organizationId })
				.from(employee)
				.where(
					and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, activeOrgId),
						eq(employee.isActive, true),
					),
				)
				.limit(1);
			emp = result[0];
		} catch (dbError) {
			console.error("Database error querying employee:", dbError);
			return new Response("Employee record not found - please complete onboarding", {
				status: 400,
			});
		}

		if (!emp) {
			return new Response("No active employee record in this organization", { status: 400 });
		}

		const userId = session.user.id;
		const organizationId = emp.organizationId;
		const channel = `notifications:${userId}`;

		// Check if Valkey is available
		const valkeyAvailable = valkey.status === "ready" || valkey.status === "connecting";

		// Create a readable stream for SSE
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				let subscriber: ReturnType<typeof createValkeySubscriber> | null = null;
				let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
				let pollInterval: ReturnType<typeof setInterval> | null = null;
				let isCleanedUp = false;

				// Helper to send SSE event
				const sendEvent = (type: string, data: unknown) => {
					if (isCleanedUp) return;
					try {
						const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
						controller.enqueue(encoder.encode(event));
					} catch {
						// Controller might be closed
					}
				};

				// Cleanup function
				const cleanup = () => {
					if (isCleanedUp) return;
					isCleanedUp = true;

					if (heartbeatInterval) {
						clearInterval(heartbeatInterval);
					}
					if (pollInterval) {
						clearInterval(pollInterval);
					}
					if (subscriber) {
						subscriber.unsubscribe(channel).catch(() => {});
						subscriber.disconnect();
					}
				};

				try {
					// Send initial count
					const initialCount = await getUnreadCount(userId, organizationId);
					sendEvent("count_update", { count: initialCount });

					if (valkeyAvailable) {
						// Use Valkey Pub/Sub for real-time updates (preferred)
						subscriber = createValkeySubscriber();

						// Handle connection errors
						subscriber.on("error", (err) => {
							console.error("Valkey subscriber error:", err);
							// Don't cleanup here - let the subscription try to reconnect
						});

						// Subscribe to user's notification channel
						await subscriber.subscribe(channel);

						// Handle incoming messages
						subscriber.on("message", (_receivedChannel, message) => {
							try {
								const parsed = JSON.parse(message);
								if (parsed.event && parsed.data) {
									sendEvent(parsed.event, parsed.data);
								}
							} catch (error) {
								console.error("Failed to parse notification message:", error);
							}
						});
					} else {
						// Fallback to polling if Valkey is not available
						// This ensures the feature still works, just with higher database load
						console.warn("Valkey not available, falling back to database polling");

						let lastCount = initialCount;

						pollInterval = setInterval(async () => {
							try {
								const currentCount = await getUnreadCount(userId, organizationId);
								if (currentCount !== lastCount) {
									sendEvent("count_update", { count: currentCount });
									lastCount = currentCount;
								}
							} catch {
								// Ignore polling errors
							}
						}, 5000);
					}

					// Send heartbeat every 30 seconds
					heartbeatInterval = setInterval(() => {
						sendEvent("heartbeat", { timestamp: Date.now() });
					}, 30000);
				} catch (error) {
					console.error("Error setting up notification stream:", error);
					cleanup();
				}

				// Return cleanup function for when stream is closed
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

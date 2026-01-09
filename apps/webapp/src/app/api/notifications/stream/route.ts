import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";

/**
 * GET /api/notifications/stream
 * Server-Sent Events endpoint for real-time notification updates
 *
 * Sends:
 * - count_update: When unread count changes
 * - heartbeat: Every 30 seconds to keep connection alive
 */
export async function GET() {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return new Response("Unauthorized", { status: 401 });
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return new Response("No active organization", { status: 400 });
		}

		const userId = session.user.id;

		// Create a readable stream for SSE
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				// Helper to send SSE event
				const sendEvent = (type: string, data: unknown) => {
					const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(event));
				};

				// Send initial count
				const initialCount = await getUnreadCount(userId, organizationId);
				sendEvent("count_update", { count: initialCount });

				// Track last known count
				let lastCount = initialCount;

				// Poll for updates every 5 seconds
				const pollInterval = setInterval(async () => {
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

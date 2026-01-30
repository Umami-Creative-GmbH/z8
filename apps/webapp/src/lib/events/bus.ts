/**
 * Event Bus
 *
 * Unified event publishing system that fans out to all subscribers.
 * Subscribers include notifications (in-app, push, email) and webhooks.
 */

import { createLogger } from "@/lib/logger";
import type { NotificationType } from "@/lib/notifications/types";
import { getSubscribers, isInitialized, markInitialized, registerSubscriber } from "./subscribers";
import type { EventPayload } from "./types";

const logger = createLogger("EventBus");

/**
 * Initialize default subscribers
 * Called lazily on first event publish
 */
async function initializeSubscribers(): Promise<void> {
	if (isInitialized()) return;

	try {
		// Register webhook subscriber
		const { webhookSubscriber } = await import("@/lib/webhooks/webhook-subscriber");
		registerSubscriber(webhookSubscriber);

		markInitialized();
		logger.info("Event bus subscribers initialized");
	} catch (error) {
		logger.error({ error }, "Failed to initialize event bus subscribers");
		// Mark as initialized to prevent repeated failures
		markInitialized();
	}
}

/**
 * Publish an event to all subscribers
 *
 * This is a fire-and-forget operation - subscriber failures are logged but don't propagate.
 *
 * @param type - The notification/event type
 * @param organizationId - The organization scope
 * @param data - Event-specific data
 * @param sourceId - Optional source event/entity ID for correlation
 */
export async function publishEvent(
	type: NotificationType,
	organizationId: string,
	data: Record<string, unknown>,
	sourceId?: string,
): Promise<void> {
	// Ensure subscribers are initialized
	await initializeSubscribers();

	const event: EventPayload = {
		type,
		organizationId,
		timestamp: new Date().toISOString(),
		data,
		sourceId,
	};

	const subscribers = getSubscribers();

	if (subscribers.length === 0) {
		logger.debug({ type, organizationId }, "No subscribers registered for event");
		return;
	}

	// Fan out to all subscribers (fire-and-forget)
	const results = await Promise.allSettled(
		subscribers.map(async (subscriber) => {
			try {
				await subscriber.handler(event);
			} catch (error) {
				logger.error(
					{ error, subscriber: subscriber.name, type, organizationId },
					"Event subscriber handler failed",
				);
				throw error; // Re-throw for Promise.allSettled to capture
			}
		}),
	);

	// Log any failures
	const failures = results.filter((r) => r.status === "rejected");
	if (failures.length > 0) {
		logger.warn(
			{
				type,
				organizationId,
				failureCount: failures.length,
				totalSubscribers: subscribers.length,
			},
			"Some event subscribers failed",
		);
	}

	logger.debug(
		{ type, organizationId, subscriberCount: subscribers.length },
		"Event published to subscribers",
	);
}

/**
 * Publish an event without waiting (truly fire-and-forget)
 *
 * Use this when you don't want to block the caller at all.
 */
export function publishEventAsync(
	type: NotificationType,
	organizationId: string,
	data: Record<string, unknown>,
	sourceId?: string,
): void {
	void publishEvent(type, organizationId, data, sourceId).catch((error) => {
		logger.error({ error, type, organizationId }, "Async event publish failed");
	});
}

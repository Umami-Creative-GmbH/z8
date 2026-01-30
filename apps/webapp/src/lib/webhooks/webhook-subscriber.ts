/**
 * Webhook Event Subscriber
 *
 * Subscribes to the event bus and queues webhook deliveries.
 */

import { randomUUID } from "node:crypto";
import type { EventPayload, EventSubscriber } from "@/lib/events/types";
import { createLogger } from "@/lib/logger";
import { addWebhookJob } from "./webhook-queue";
import { createDeliveryRecord, getActiveWebhooksForEvent } from "./webhook-service";
import type { WebhookPayloadData } from "./types";

const logger = createLogger("WebhookSubscriber");

/**
 * Handle an event by queuing webhook deliveries for all subscribed endpoints
 */
async function handleEvent(event: EventPayload): Promise<void> {
	try {
		// Find webhooks subscribed to this event
		const webhooks = await getActiveWebhooksForEvent(event.organizationId, event.type);

		if (webhooks.length === 0) {
			logger.debug(
				{ eventType: event.type, organizationId: event.organizationId },
				"No webhooks subscribed to event",
			);
			return;
		}

		// Build webhook payload
		const payload: WebhookPayloadData = {
			id: event.sourceId ?? randomUUID(),
			type: event.type,
			createdAt: event.timestamp,
			data: event.data,
		};

		// Queue delivery for each webhook
		await Promise.all(
			webhooks.map(async (webhook) => {
				try {
					// Create delivery record
					const deliveryId = await createDeliveryRecord({
						webhookEndpointId: webhook.id,
						organizationId: event.organizationId,
						url: webhook.url,
						eventType: event.type,
						payload,
						eventId: event.sourceId,
					});

					// Queue job
					const job = await addWebhookJob({
						deliveryId,
						webhookEndpointId: webhook.id,
						organizationId: event.organizationId,
						url: webhook.url,
						payload,
						eventType: event.type,
						eventId: event.sourceId,
						attemptNumber: 1,
					});

					logger.debug(
						{
							webhookId: webhook.id,
							deliveryId,
							jobId: job.id,
							eventType: event.type,
						},
						"Webhook delivery queued",
					);
				} catch (error) {
					logger.error(
						{ error, webhookId: webhook.id, eventType: event.type },
						"Failed to queue webhook delivery",
					);
				}
			}),
		);

		logger.info(
			{
				eventType: event.type,
				organizationId: event.organizationId,
				webhookCount: webhooks.length,
			},
			"Webhook deliveries queued for event",
		);
	} catch (error) {
		logger.error({ error, event }, "Failed to handle event for webhooks");
	}
}

/**
 * Webhook event subscriber
 */
export const webhookSubscriber: EventSubscriber = {
	name: "webhooks",
	handler: handleEvent,
	priority: 200, // Lower priority than notifications (run after)
};

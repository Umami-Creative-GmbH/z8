/**
 * Webhook Queue Integration
 *
 * BullMQ job management for webhook deliveries.
 */

import type { Job, JobsOptions } from "bullmq";
import { addJob, type JobResult, type WebhookJobData as QueueWebhookJobData } from "@/lib/queue";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "@/lib/notifications/types";
import type { WebhookPayloadData } from "./types";
import { RETRY_DELAYS_MS } from "./types";

const logger = createLogger("WebhookQueue");

/**
 * Add a webhook delivery job to the queue
 */
export async function addWebhookJob(params: {
	deliveryId: string;
	webhookEndpointId: string;
	organizationId: string;
	url: string;
	payload: WebhookPayloadData;
	eventType: NotificationType;
	eventId?: string;
	attemptNumber: number;
}): Promise<Job> {
	// Cast to queue's WebhookJobData type (looser types to avoid circular imports)
	const jobData: QueueWebhookJobData = {
		type: "webhook",
		deliveryId: params.deliveryId,
		webhookEndpointId: params.webhookEndpointId,
		organizationId: params.organizationId,
		url: params.url,
		// Cast payload to Record<string, unknown> as required by the queue's type
		payload: params.payload as unknown as Record<string, unknown>,
		eventType: params.eventType,
		eventId: params.eventId,
		attemptNumber: params.attemptNumber,
	};

	// Calculate delay for retries
	const delay = params.attemptNumber > 1 ? (RETRY_DELAYS_MS[params.attemptNumber - 1] ?? 0) : 0;

	const options: Partial<JobsOptions> = {
		attempts: 1, // We handle retries manually for better control
		priority: 5, // Medium priority
		delay,
		removeOnComplete: {
			count: 100,
			age: 24 * 60 * 60, // 24 hours
		},
		removeOnFail: {
			count: 500,
			age: 7 * 24 * 60 * 60, // 7 days
		},
	};

	const job = await addJob(`webhook-delivery-${params.deliveryId}`, jobData, options);

	logger.debug(
		{
			jobId: job.id,
			deliveryId: params.deliveryId,
			webhookEndpointId: params.webhookEndpointId,
			attemptNumber: params.attemptNumber,
			delay,
		},
		"Webhook job added to queue",
	);

	return job;
}

/**
 * Schedule a retry for a failed webhook delivery
 */
export async function scheduleWebhookRetry(params: {
	deliveryId: string;
	webhookEndpointId: string;
	organizationId: string;
	url: string;
	payload: WebhookPayloadData;
	eventType: NotificationType;
	eventId?: string;
	attemptNumber: number;
}): Promise<Job | null> {
	// Check if we should retry
	const maxAttempts = RETRY_DELAYS_MS.length;
	if (params.attemptNumber >= maxAttempts) {
		logger.info(
			{ deliveryId: params.deliveryId, attemptNumber: params.attemptNumber },
			"Max retry attempts reached, not scheduling retry",
		);
		return null;
	}

	return addWebhookJob({
		...params,
		attemptNumber: params.attemptNumber + 1,
	});
}

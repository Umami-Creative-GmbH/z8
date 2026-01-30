/**
 * Webhook Worker
 *
 * BullMQ job processor for webhook deliveries.
 */

import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import { createLogger } from "@/lib/logger";
import { executeWebhookRequest } from "./webhook-delivery";
import { scheduleWebhookRetry } from "./webhook-queue";
import {
	checkAndDisableUnhealthyEndpoint,
	getDeliveryRecord,
	getRetryDelay,
	getWebhookEndpoint,
	updateDeliveryRecord,
	updateEndpointStats,
} from "./webhook-service";
import type { WebhookJobData } from "./types";
import { MAX_ATTEMPTS } from "./types";

const logger = createLogger("WebhookWorker");

/**
 * Process a webhook delivery job
 */
export async function processWebhookJob(job: Job<WebhookJobData>): Promise<JobResult> {
	const { deliveryId, webhookEndpointId, url, payload, eventType, eventId, attemptNumber } =
		job.data;

	logger.info(
		{ jobId: job.id, deliveryId, webhookEndpointId, eventType, attemptNumber },
		"Processing webhook delivery",
	);

	// Fetch webhook endpoint to get current secret and status
	const endpoint = await getWebhookEndpoint(webhookEndpointId);
	if (!endpoint) {
		logger.warn({ webhookEndpointId, deliveryId }, "Webhook endpoint not found, skipping delivery");
		await updateDeliveryRecord(deliveryId, {
			status: "failed",
			attemptNumber,
			errorMessage: "Webhook endpoint not found",
			completedAt: new Date(),
		});
		return { success: false, error: "Webhook endpoint not found" };
	}

	if (!endpoint.isActive) {
		logger.info({ webhookEndpointId, deliveryId }, "Webhook endpoint inactive, skipping delivery");
		await updateDeliveryRecord(deliveryId, {
			status: "failed",
			attemptNumber,
			errorMessage: "Webhook endpoint is inactive",
			completedAt: new Date(),
		});
		return { success: false, error: "Webhook endpoint is inactive" };
	}

	// Mark delivery as started
	await updateDeliveryRecord(deliveryId, {
		status: attemptNumber > 1 ? "retrying" : "pending",
		attemptNumber,
		startedAt: new Date(),
	});

	// Execute the webhook request
	const result = await executeWebhookRequest({
		url,
		payload,
		secret: endpoint.secret,
		eventType,
		deliveryId,
	});

	// Update delivery record
	await updateDeliveryRecord(deliveryId, {
		status: result.success ? "success" : attemptNumber >= MAX_ATTEMPTS ? "failed" : "retrying",
		attemptNumber,
		httpStatus: result.httpStatus,
		responseBody: result.responseBody,
		errorMessage: result.errorMessage,
		completedAt: result.success ? new Date() : undefined,
		durationMs: result.durationMs,
		nextRetryAt:
			!result.success && attemptNumber < MAX_ATTEMPTS
				? new Date(Date.now() + getRetryDelay(attemptNumber))
				: undefined,
	});

	// Update endpoint statistics
	await updateEndpointStats(webhookEndpointId, result);

	// Handle failure
	if (!result.success) {
		// Check if endpoint should be auto-disabled
		await checkAndDisableUnhealthyEndpoint(webhookEndpointId);

		// Schedule retry if we haven't exhausted attempts
		if (attemptNumber < MAX_ATTEMPTS) {
			await scheduleWebhookRetry({
				deliveryId,
				webhookEndpointId,
				organizationId: job.data.organizationId,
				url,
				payload,
				eventType,
				eventId,
				attemptNumber,
			});
		} else {
			logger.warn(
				{ deliveryId, webhookEndpointId, attemptNumber },
				"Webhook delivery failed after max attempts",
			);
		}
	}

	return {
		success: result.success,
		message: result.success ? "Webhook delivered" : result.errorMessage,
		data: {
			httpStatus: result.httpStatus,
			durationMs: result.durationMs,
			attemptNumber,
		},
	};
}

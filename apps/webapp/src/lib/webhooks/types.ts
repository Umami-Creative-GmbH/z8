/**
 * Webhook Types
 *
 * Type definitions for the webhook system.
 */

import type { NotificationType } from "@/lib/notifications/types";
import type { WebhookDelivery, WebhookEndpoint } from "@/db/schema";

// Re-export database types
export type { WebhookDelivery, WebhookEndpoint };

/**
 * Parameters for creating a webhook endpoint
 */
export interface CreateWebhookParams {
	organizationId: string;
	name: string;
	url: string;
	subscribedEvents: NotificationType[];
	description?: string;
	createdBy: string;
}

/**
 * Parameters for updating a webhook endpoint
 */
export interface UpdateWebhookParams {
	name?: string;
	url?: string;
	subscribedEvents?: NotificationType[];
	description?: string;
	isActive?: boolean;
}

/**
 * Webhook delivery job data for BullMQ
 */
export interface WebhookJobData {
	type: "webhook";
	deliveryId: string;
	webhookEndpointId: string;
	organizationId: string;
	url: string;
	payload: WebhookPayloadData;
	eventType: NotificationType;
	eventId?: string;
	attemptNumber: number;
}

/**
 * Payload sent to webhook endpoints
 */
export interface WebhookPayloadData {
	id: string;
	type: NotificationType;
	createdAt: string;
	data: Record<string, unknown>;
}

/**
 * Result of a webhook delivery attempt
 */
export interface WebhookDeliveryResult {
	success: boolean;
	httpStatus?: number;
	responseBody?: string;
	errorMessage?: string;
	durationMs: number;
}

/**
 * Retry delays in milliseconds (exponential backoff)
 * Attempt 1: immediate
 * Attempt 2: 1s
 * Attempt 3: 5s
 * Attempt 4: 30s
 * Attempt 5: 2m
 * Attempt 6: 10m
 */
export const RETRY_DELAYS_MS = [0, 1000, 5000, 30000, 120000, 600000] as const;

/**
 * Maximum number of delivery attempts
 */
export const MAX_ATTEMPTS = 6;

/**
 * HTTP timeout for webhook requests (30 seconds)
 */
export const WEBHOOK_TIMEOUT_MS = 30000;

/**
 * Maximum response body to store (10KB)
 */
export const MAX_RESPONSE_BODY_LENGTH = 10240;

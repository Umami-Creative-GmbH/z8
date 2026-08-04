/**
 * Webhook Types
 *
 * Type definitions for the webhook system.
 */

import type { WebhookDelivery, WebhookEndpoint } from "@/db/schema";
import type { NotificationType } from "@/lib/notifications/types";

// Re-export database types
export type { WebhookDelivery, WebhookEndpoint };
export type PublicWebhookEndpoint = Omit<WebhookEndpoint, "secret">;

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

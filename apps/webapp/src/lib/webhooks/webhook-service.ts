/**
 * Webhook Service
 *
 * Core service for webhook management and delivery orchestration.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDelivery, webhookEndpoint } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "@/lib/notifications/types";
import { generateWebhookSecret } from "./signature";
import type {
	CreateWebhookParams,
	UpdateWebhookParams,
	WebhookDeliveryResult,
	WebhookEndpoint,
	WebhookPayloadData,
} from "./types";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from "./types";

const logger = createLogger("WebhookService");

// ============================================
// WEBHOOK ENDPOINT MANAGEMENT
// ============================================

/**
 * Create a new webhook endpoint
 */
export async function createWebhookEndpoint(
	params: CreateWebhookParams,
): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
	const secret = generateWebhookSecret();

	const [endpoint] = await db
		.insert(webhookEndpoint)
		.values({
			organizationId: params.organizationId,
			name: params.name,
			url: params.url,
			secret,
			subscribedEvents: params.subscribedEvents,
			description: params.description,
			createdBy: params.createdBy,
			updatedAt: new Date(),
		})
		.returning();

	logger.info(
		{ webhookId: endpoint.id, organizationId: params.organizationId },
		"Webhook endpoint created",
	);

	return { endpoint, secret };
}

/**
 * Update a webhook endpoint
 */
export async function updateWebhookEndpoint(
	webhookId: string,
	params: UpdateWebhookParams,
): Promise<WebhookEndpoint | null> {
	const [updated] = await db
		.update(webhookEndpoint)
		.set({
			...params,
			updatedAt: new Date(),
		})
		.where(eq(webhookEndpoint.id, webhookId))
		.returning();

	if (updated) {
		logger.info({ webhookId }, "Webhook endpoint updated");
	}

	return updated ?? null;
}

/**
 * Delete a webhook endpoint
 */
export async function deleteWebhookEndpoint(webhookId: string): Promise<boolean> {
	const result = await db
		.delete(webhookEndpoint)
		.where(eq(webhookEndpoint.id, webhookId))
		.returning({ id: webhookEndpoint.id });

	if (result.length > 0) {
		logger.info({ webhookId }, "Webhook endpoint deleted");
		return true;
	}

	return false;
}

/**
 * Get a webhook endpoint by ID
 */
export async function getWebhookEndpoint(webhookId: string): Promise<WebhookEndpoint | null> {
	const endpoint = await db.query.webhookEndpoint.findFirst({
		where: eq(webhookEndpoint.id, webhookId),
	});
	return endpoint ?? null;
}

/**
 * Get all webhook endpoints for an organization
 */
export async function getWebhookEndpointsByOrganization(
	organizationId: string,
): Promise<WebhookEndpoint[]> {
	return db.query.webhookEndpoint.findMany({
		where: eq(webhookEndpoint.organizationId, organizationId),
		orderBy: (endpoint, { desc }) => [desc(endpoint.createdAt)],
	});
}

/**
 * Get active webhook endpoints subscribed to a specific event type
 */
export async function getActiveWebhooksForEvent(
	organizationId: string,
	eventType: NotificationType,
): Promise<Array<Pick<WebhookEndpoint, "id" | "url" | "secret" | "name">>> {
	// Query webhooks and filter by subscribed events (JSONB contains)
	const webhooks = await db.query.webhookEndpoint.findMany({
		where: and(
			eq(webhookEndpoint.organizationId, organizationId),
			eq(webhookEndpoint.isActive, true),
		),
		columns: {
			id: true,
			url: true,
			secret: true,
			name: true,
			subscribedEvents: true,
		},
	});

	// Filter by event type (JSONB array contains)
	return webhooks.filter((w) => {
		const events = w.subscribedEvents as string[];
		return events.includes(eventType);
	});
}

/**
 * Regenerate a webhook secret
 */
export async function regenerateWebhookSecret(
	webhookId: string,
): Promise<{ secret: string } | null> {
	const secret = generateWebhookSecret();

	const [updated] = await db
		.update(webhookEndpoint)
		.set({
			secret,
			updatedAt: new Date(),
		})
		.where(eq(webhookEndpoint.id, webhookId))
		.returning({ id: webhookEndpoint.id });

	if (updated) {
		logger.info({ webhookId }, "Webhook secret regenerated");
		return { secret };
	}

	return null;
}

// ============================================
// WEBHOOK DELIVERY MANAGEMENT
// ============================================

/**
 * Create a webhook delivery record
 */
export async function createDeliveryRecord(params: {
	webhookEndpointId: string;
	organizationId: string;
	url: string;
	eventType: NotificationType;
	payload: WebhookPayloadData;
	eventId?: string;
	bullmqJobId?: string;
}): Promise<string> {
	const [record] = await db
		.insert(webhookDelivery)
		.values({
			webhookEndpointId: params.webhookEndpointId,
			organizationId: params.organizationId,
			url: params.url,
			eventType: params.eventType,
			payload: params.payload,
			eventId: params.eventId,
			status: "pending",
			attemptNumber: 1,
			maxAttempts: MAX_ATTEMPTS,
			scheduledAt: new Date(),
			bullmqJobId: params.bullmqJobId,
		})
		.returning({ id: webhookDelivery.id });

	return record.id;
}

/**
 * Update a delivery record after an attempt
 */
export async function updateDeliveryRecord(
	deliveryId: string,
	update: {
		status?: "pending" | "success" | "failed" | "retrying";
		attemptNumber?: number;
		httpStatus?: number;
		responseBody?: string;
		errorMessage?: string;
		startedAt?: Date;
		completedAt?: Date;
		durationMs?: number;
		nextRetryAt?: Date;
	},
): Promise<void> {
	await db.update(webhookDelivery).set(update).where(eq(webhookDelivery.id, deliveryId));
}

/**
 * Get delivery record by ID
 */
export async function getDeliveryRecord(deliveryId: string) {
	return db.query.webhookDelivery.findFirst({
		where: eq(webhookDelivery.id, deliveryId),
	});
}

/**
 * Get delivery logs for a webhook endpoint
 */
export async function getDeliveryLogs(
	webhookId: string,
	options: { limit?: number; offset?: number } = {},
): Promise<{ deliveries: (typeof webhookDelivery.$inferSelect)[]; total: number }> {
	const { limit = 50, offset = 0 } = options;

	const deliveries = await db.query.webhookDelivery.findMany({
		where: eq(webhookDelivery.webhookEndpointId, webhookId),
		orderBy: (delivery, { desc }) => [desc(delivery.createdAt)],
		limit,
		offset,
	});

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(webhookDelivery)
		.where(eq(webhookDelivery.webhookEndpointId, webhookId));

	return { deliveries, total: count };
}

/**
 * Update webhook endpoint statistics after delivery
 */
export async function updateEndpointStats(
	webhookEndpointId: string,
	result: WebhookDeliveryResult,
): Promise<void> {
	if (result.success) {
		await db
			.update(webhookEndpoint)
			.set({
				lastDeliveredAt: new Date(),
				consecutiveFailures: 0,
				totalDeliveries: sql`${webhookEndpoint.totalDeliveries} + 1`,
				totalSuccesses: sql`${webhookEndpoint.totalSuccesses} + 1`,
			})
			.where(eq(webhookEndpoint.id, webhookEndpointId));
	} else {
		await db
			.update(webhookEndpoint)
			.set({
				lastFailedAt: new Date(),
				consecutiveFailures: sql`${webhookEndpoint.consecutiveFailures} + 1`,
				totalDeliveries: sql`${webhookEndpoint.totalDeliveries} + 1`,
			})
			.where(eq(webhookEndpoint.id, webhookEndpointId));
	}
}

/**
 * Calculate next retry delay based on attempt number
 */
export function getRetryDelay(attemptNumber: number): number {
	const index = Math.min(attemptNumber, RETRY_DELAYS_MS.length - 1);
	return RETRY_DELAYS_MS[index];
}

/**
 * Check if an endpoint should be auto-disabled due to consecutive failures
 */
export async function checkAndDisableUnhealthyEndpoint(
	webhookEndpointId: string,
	maxConsecutiveFailures = 10,
): Promise<boolean> {
	const endpoint = await db.query.webhookEndpoint.findFirst({
		where: eq(webhookEndpoint.id, webhookEndpointId),
		columns: { consecutiveFailures: true, isActive: true },
	});

	if (endpoint && endpoint.isActive && endpoint.consecutiveFailures >= maxConsecutiveFailures) {
		await db
			.update(webhookEndpoint)
			.set({ isActive: false })
			.where(eq(webhookEndpoint.id, webhookEndpointId));

		logger.warn(
			{ webhookId: webhookEndpointId, consecutiveFailures: endpoint.consecutiveFailures },
			"Webhook endpoint auto-disabled due to consecutive failures",
		);

		return true;
	}

	return false;
}

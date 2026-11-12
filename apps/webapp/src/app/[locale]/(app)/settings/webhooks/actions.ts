"use server";

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { env } from "@/env";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/types";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	createDeliveryRecord,
	createWebhookEndpoint,
	deleteWebhookEndpoint,
	getDeliveryLogs,
	getWebhookEndpoint,
	getWebhookEndpointsByOrganization,
	regenerateWebhookSecret,
	updateWebhookEndpoint,
} from "@/lib/webhooks";
import type { WebhookPayloadData } from "@/lib/webhooks/types";
import { isPrivateIP } from "@/lib/webhooks/url-validation";
import { addWebhookJob } from "@/lib/webhooks/webhook-queue";

const logger = createLogger("WebhookActions");

// Webhooks are owner-only settings (ADR 0002 keeps the level each action had).

/**
 * Validate webhook URL
 * - Must be HTTPS in production
 * - Must not target private/internal IP ranges (SSRF protection)
 */
function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
	try {
		const parsed = new URL(url);

		if (env.NODE_ENV === "production") {
			if (parsed.protocol !== "https:") {
				return { valid: false, reason: "HTTPS is required in production" };
			}
		} else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return { valid: false, reason: "Only HTTP(S) protocols are allowed" };
		}

		// SSRF protection: block private/internal IPs
		if (isPrivateIP(parsed.hostname)) {
			return {
				valid: false,
				reason: "Webhook URLs cannot target private or internal addresses",
			};
		}

		return { valid: true };
	} catch {
		return { valid: false, reason: "Invalid URL format" };
	}
}

function requireValidUrl(url: string) {
	const validation = validateWebhookUrl(url);
	return validation.valid
		? Effect.void
		: Effect.fail(
				new ValidationError({
					message: validation.reason ?? "Invalid webhook URL",
					field: "url",
					value: url,
				}),
			);
}

function requireValidEvents(events: string[]) {
	if (!events.length) {
		return Effect.fail(
			new ValidationError({
				message: "At least one event must be selected",
				field: "subscribedEvents",
			}),
		);
	}
	if (!events.every((event) => NOTIFICATION_TYPES.includes(event as NotificationType))) {
		return Effect.fail(
			new ValidationError({
				message: "Invalid event type(s) selected",
				field: "subscribedEvents",
			}),
		);
	}
	return Effect.void;
}

/** The webhook with this ID in the session's organization; another organization's reads as not found. */
function loadWebhook(webhookId: string, organizationId: string) {
	return Effect.promise(() => getWebhookEndpoint(webhookId, organizationId)).pipe(
		Effect.flatMap((webhook) =>
			webhook ? Effect.succeed(webhook) : Effect.fail(webhookNotFound(webhookId)),
		),
	);
}

function webhookNotFound(webhookId: string) {
	return new NotFoundError({
		message: "Webhook not found",
		entityType: "webhook",
		entityId: webhookId,
	});
}

const webhookIdSchema = z.string().min(1);

// ============================================
// WEBHOOK CRUD ACTIONS
// ============================================

/**
 * Create a new webhook endpoint
 * Returns the endpoint and secret (secret is only shown once)
 */
export const createWebhook = organizationAction(
	{
		name: "webhooks.create",
		requires: "owner",
		schema: z.strictObject({
			name: z.string(),
			url: z.string(),
			subscribedEvents: z.array(z.string()),
			description: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* requireValidUrl(input.url);
			yield* requireValidEvents(input.subscribedEvents);

			const result = yield* Effect.promise(() =>
				createWebhookEndpoint({
					organizationId,
					name: input.name.trim(),
					url: input.url.trim(),
					subscribedEvents: input.subscribedEvents as NotificationType[],
					description: input.description?.trim(),
					createdBy: actor.userId,
				}),
			);

			logger.info({ webhookId: result.endpoint.id, organizationId }, "Webhook created");
			return result;
		}),
);

/**
 * Update a webhook endpoint
 */
export const updateWebhook = organizationAction(
	{
		name: "webhooks.update",
		requires: "owner",
		schema: z.strictObject({
			webhookId: webhookIdSchema,
			name: z.string().optional(),
			url: z.string().optional(),
			subscribedEvents: z.array(z.string()).optional(),
			description: z.string().optional(),
			isActive: z.boolean().optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const { webhookId, ...data } = input;
			yield* loadWebhook(webhookId, organizationId);

			if (data.url) yield* requireValidUrl(data.url);
			if (data.subscribedEvents) yield* requireValidEvents(data.subscribedEvents);

			const updated = yield* Effect.promise(() =>
				updateWebhookEndpoint(webhookId, {
					name: data.name?.trim(),
					url: data.url?.trim(),
					subscribedEvents: data.subscribedEvents as NotificationType[] | undefined,
					description: data.description?.trim(),
					isActive: data.isActive,
				}),
			);
			if (!updated) return yield* Effect.fail(webhookNotFound(webhookId));

			logger.info({ webhookId }, "Webhook updated");
			return { endpoint: updated };
		}),
);

/**
 * Delete a webhook endpoint
 */
export const deleteWebhook = organizationAction(
	{ name: "webhooks.delete", requires: "owner", schema: webhookIdSchema },
	({ organizationId, input: webhookId }) =>
		Effect.gen(function* () {
			yield* loadWebhook(webhookId, organizationId);

			const deleted = yield* Effect.promise(() => deleteWebhookEndpoint(webhookId));
			if (!deleted) return yield* Effect.fail(webhookNotFound(webhookId));

			logger.info({ webhookId }, "Webhook deleted");
		}),
);

/**
 * Regenerate webhook secret
 * Returns the new secret (only shown once)
 */
export const regenerateSecret = organizationAction(
	{ name: "webhooks.regenerateSecret", requires: "owner", schema: webhookIdSchema },
	({ organizationId, input: webhookId }) =>
		Effect.gen(function* () {
			yield* loadWebhook(webhookId, organizationId);

			const result = yield* Effect.promise(() => regenerateWebhookSecret(webhookId));
			if (!result) return yield* Effect.fail(webhookNotFound(webhookId));

			logger.info({ webhookId }, "Webhook secret regenerated");
			return result;
		}),
);

// ============================================
// WEBHOOK TESTING
// ============================================

/**
 * Send a test ping to a webhook endpoint
 */
export const testWebhook = organizationAction(
	{ name: "webhooks.test", requires: "owner", schema: webhookIdSchema },
	({ organizationId, input: webhookId }) =>
		Effect.gen(function* () {
			const webhook = yield* loadWebhook(webhookId, organizationId);

			const payload: WebhookPayloadData = {
				id: randomUUID(),
				type: "password_changed", // Use a valid type for the test
				createdAt: new Date().toISOString(),
				data: {
					test: true,
					message: "This is a test webhook event from Z8",
					organizationId,
					timestamp: new Date().toISOString(),
				},
			};

			const deliveryId = yield* Effect.promise(() =>
				createDeliveryRecord({
					webhookEndpointId: webhook.id,
					organizationId,
					url: webhook.url,
					eventType: "password_changed",
					payload,
				}),
			);

			yield* Effect.promise(() =>
				addWebhookJob({
					deliveryId,
					webhookEndpointId: webhook.id,
					organizationId,
					url: webhook.url,
					payload,
					eventType: "password_changed",
					attemptNumber: 1,
				}),
			);

			logger.info({ webhookId, deliveryId }, "Test webhook queued");
			return { deliveryId };
		}),
);

// ============================================
// WEBHOOK QUERIES
// ============================================

/**
 * Get all webhooks of the active organization
 */
export const getWebhooks = organizationAction(
	{ name: "webhooks.list", requires: "owner", schema: noInput },
	({ organizationId }) =>
		Effect.promise(() => getWebhookEndpointsByOrganization(organizationId)).pipe(
			Effect.map((webhooks) => ({ webhooks })),
		),
);

/**
 * Get delivery logs for a webhook
 */
export const getWebhookDeliveryLogs = organizationAction(
	{
		name: "webhooks.deliveryLogs",
		requires: "owner",
		schema: z.strictObject({
			webhookId: webhookIdSchema,
			limit: z.number().int().positive().optional(),
			offset: z.number().int().nonnegative().optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const { webhookId, limit = 50, offset = 0 } = input;
			yield* loadWebhook(webhookId, organizationId);

			const { deliveries, total } = yield* Effect.promise(() =>
				getDeliveryLogs(webhookId, organizationId, { limit, offset }),
			);

			return { deliveries, total, hasMore: offset + deliveries.length < total };
		}),
);

/**
 * Get available event types for webhook subscription
 */
export const getAvailableEventTypes = organizationAction(
	{ name: "webhooks.eventTypes", requires: "owner", schema: noInput },
	() => Effect.succeed({ eventTypes: [...NOTIFICATION_TYPES] }),
);

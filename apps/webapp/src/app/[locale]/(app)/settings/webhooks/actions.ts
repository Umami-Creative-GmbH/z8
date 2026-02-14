"use server";

import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { isPrivateIP } from "@/lib/webhooks/url-validation";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { webhookDelivery } from "@/db/schema";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/types";
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
import { addWebhookJob } from "@/lib/webhooks/webhook-queue";
import type { WebhookDelivery, WebhookEndpoint, WebhookPayloadData } from "@/lib/webhooks/types";

const logger = createLogger("WebhookActions");

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Verify the current user is an organization owner
 */
function verifyOwnerRole(memberRecord: { role: string } | null | undefined, userId: string) {
	return Effect.gen(function* (_) {
		if (!memberRecord || memberRecord.role !== "owner") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only organization owners can manage webhooks",
						userId,
						resource: "webhook",
						action: "manage",
					}),
				),
			);
		}
	});
}

/**
 * Validate webhook URL
 * - Must be HTTPS in production
 * - Must not target private/internal IP ranges (SSRF protection)
 */
function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
	try {
		const parsed = new URL(url);

		// Check protocol
		if (process.env.NODE_ENV === "production") {
			if (parsed.protocol !== "https:") {
				return { valid: false, reason: "HTTPS is required in production" };
			}
		} else {
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
				return { valid: false, reason: "Only HTTP(S) protocols are allowed" };
			}
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

/**
 * Validate subscribed events
 */
function validateEvents(events: string[]): events is NotificationType[] {
	return events.every((e) => NOTIFICATION_TYPES.includes(e as NotificationType));
}

// ============================================
// WEBHOOK CRUD ACTIONS
// ============================================

/**
 * Create a new webhook endpoint
 * Returns the endpoint and secret (secret is only shown once)
 */
export async function createWebhook(data: {
	organizationId: string;
	name: string;
	url: string;
	subscribedEvents: string[];
	description?: string;
}): Promise<ServerActionResult<{ endpoint: WebhookEndpoint; secret: string }>> {
	const tracer = trace.getTracer("webhooks");

	return runServerActionSafe(
		tracer.startActiveSpan("createWebhook", (span) =>
			Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("organization.id", data.organizationId);
				span.setAttribute("webhook.name", data.name);

				// Get current user's member record
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, data.organizationId),
							),
						});
					}),
				);

				// Verify owner role
				yield* _(verifyOwnerRole(memberRecord, session.user.id));

				// Validate URL
				const urlValidation = validateWebhookUrl(data.url);
				if (!urlValidation.valid) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: urlValidation.reason ?? "Invalid webhook URL",
								field: "url",
								value: data.url,
							}),
						),
					);
				}

				// Validate events
				if (!data.subscribedEvents.length) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "At least one event must be selected",
								field: "subscribedEvents",
							}),
						),
					);
				}

				if (!validateEvents(data.subscribedEvents)) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invalid event type(s) selected",
								field: "subscribedEvents",
							}),
						),
					);
				}

				// Create webhook
				const result = yield* _(
					Effect.promise(() =>
						createWebhookEndpoint({
							organizationId: data.organizationId,
							name: data.name.trim(),
							url: data.url.trim(),
							subscribedEvents: data.subscribedEvents as NotificationType[],
							description: data.description?.trim(),
							createdBy: session.user.id,
						}),
					),
				);

				logger.info(
					{ webhookId: result.endpoint.id, organizationId: data.organizationId },
					"Webhook created",
				);

				span.setAttribute("webhook.id", result.endpoint.id);

				return result;
			}),
		),
	);
}

/**
 * Update a webhook endpoint
 */
export async function updateWebhook(
	webhookId: string,
	data: {
		name?: string;
		url?: string;
		subscribedEvents?: string[];
		description?: string;
		isActive?: boolean;
	},
): Promise<ServerActionResult<{ endpoint: WebhookEndpoint }>> {
	const tracer = trace.getTracer("webhooks");

	return runServerActionSafe(
		tracer.startActiveSpan("updateWebhook", (span) =>
			Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("webhook.id", webhookId);

				// Get webhook to verify ownership
				const webhook = yield* _(
					Effect.promise(() => getWebhookEndpoint(webhookId)),
					Effect.flatMap((w) =>
						w
							? Effect.succeed(w)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				// Get member record
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, webhook.organizationId),
							),
						});
					}),
				);

				// Verify owner role
				yield* _(verifyOwnerRole(memberRecord, session.user.id));

				// Validate URL if provided
				if (data.url) {
					const urlValidation = validateWebhookUrl(data.url);
					if (!urlValidation.valid) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: urlValidation.reason ?? "Invalid webhook URL",
									field: "url",
									value: data.url,
								}),
							),
						);
					}
				}

				// Validate events if provided
				if (data.subscribedEvents) {
					if (!data.subscribedEvents.length) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "At least one event must be selected",
									field: "subscribedEvents",
								}),
							),
						);
					}

					if (!validateEvents(data.subscribedEvents)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid event type(s) selected",
									field: "subscribedEvents",
								}),
							),
						);
					}
				}

				// Update webhook
				const updated = yield* _(
					Effect.promise(() =>
						updateWebhookEndpoint(webhookId, {
							name: data.name?.trim(),
							url: data.url?.trim(),
							subscribedEvents: data.subscribedEvents as NotificationType[] | undefined,
							description: data.description?.trim(),
							isActive: data.isActive,
						}),
					),
					Effect.flatMap((w) =>
						w
							? Effect.succeed(w)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				logger.info({ webhookId }, "Webhook updated");

				return { endpoint: updated };
			}),
		),
	);
}

/**
 * Delete a webhook endpoint
 */
export async function deleteWebhook(webhookId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("webhooks");

	return runServerActionSafe(
		tracer.startActiveSpan("deleteWebhook", (span) =>
			Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("webhook.id", webhookId);

				// Get webhook to verify ownership
				const webhook = yield* _(
					Effect.promise(() => getWebhookEndpoint(webhookId)),
					Effect.flatMap((w) =>
						w
							? Effect.succeed(w)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				// Get member record
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, webhook.organizationId),
							),
						});
					}),
				);

				// Verify owner role
				yield* _(verifyOwnerRole(memberRecord, session.user.id));

				// Delete webhook
				const deleted = yield* _(Effect.promise(() => deleteWebhookEndpoint(webhookId)));

				if (!deleted) {
					yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Webhook not found",
								entityType: "webhook",
								entityId: webhookId,
							}),
						),
					);
				}

				logger.info({ webhookId }, "Webhook deleted");
			}),
		),
	);
}

/**
 * Regenerate webhook secret
 * Returns the new secret (only shown once)
 */
export async function regenerateSecret(
	webhookId: string,
): Promise<ServerActionResult<{ secret: string }>> {
	const tracer = trace.getTracer("webhooks");

	return runServerActionSafe(
		tracer.startActiveSpan("regenerateWebhookSecret", (span) =>
			Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("webhook.id", webhookId);

				// Get webhook to verify ownership
				const webhook = yield* _(
					Effect.promise(() => getWebhookEndpoint(webhookId)),
					Effect.flatMap((w) =>
						w
							? Effect.succeed(w)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				// Get member record
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, webhook.organizationId),
							),
						});
					}),
				);

				// Verify owner role
				yield* _(verifyOwnerRole(memberRecord, session.user.id));

				// Regenerate secret
				const result = yield* _(
					Effect.promise(() => regenerateWebhookSecret(webhookId)),
					Effect.flatMap((r) =>
						r
							? Effect.succeed(r)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				logger.info({ webhookId }, "Webhook secret regenerated");

				return result;
			}),
		),
	);
}

// ============================================
// WEBHOOK TESTING
// ============================================

/**
 * Send a test ping to a webhook endpoint
 */
export async function testWebhook(
	webhookId: string,
): Promise<ServerActionResult<{ deliveryId: string }>> {
	const tracer = trace.getTracer("webhooks");

	return runServerActionSafe(
		tracer.startActiveSpan("testWebhook", (span) =>
			Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("webhook.id", webhookId);

				// Get webhook to verify ownership
				const webhook = yield* _(
					Effect.promise(() => getWebhookEndpoint(webhookId)),
					Effect.flatMap((w) =>
						w
							? Effect.succeed(w)
							: Effect.fail(
									new NotFoundError({
										message: "Webhook not found",
										entityType: "webhook",
										entityId: webhookId,
									}),
								),
					),
				);

				// Get member record
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, webhook.organizationId),
							),
						});
					}),
				);

				// Verify owner role
				yield* _(verifyOwnerRole(memberRecord, session.user.id));

				// Create test payload
				const payload: WebhookPayloadData = {
					id: randomUUID(),
					type: "password_changed", // Use a valid type for the test
					createdAt: new Date().toISOString(),
					data: {
						test: true,
						message: "This is a test webhook event from Z8",
						organizationId: webhook.organizationId,
						timestamp: new Date().toISOString(),
					},
				};

				// Create delivery record
				const deliveryId = yield* _(
					Effect.promise(() =>
						createDeliveryRecord({
							webhookEndpointId: webhook.id,
							organizationId: webhook.organizationId,
							url: webhook.url,
							eventType: "password_changed",
							payload,
						}),
					),
				);

				// Queue delivery job
				yield* _(
					Effect.promise(() =>
						addWebhookJob({
							deliveryId,
							webhookEndpointId: webhook.id,
							organizationId: webhook.organizationId,
							url: webhook.url,
							payload,
							eventType: "password_changed",
							attemptNumber: 1,
						}),
					),
				);

				logger.info({ webhookId, deliveryId }, "Test webhook queued");

				span.setAttribute("delivery.id", deliveryId);

				return { deliveryId };
			}),
		),
	);
}

// ============================================
// WEBHOOK QUERIES
// ============================================

/**
 * Get all webhooks for an organization
 */
export async function getWebhooks(
	organizationId: string,
): Promise<ServerActionResult<{ webhooks: WebhookEndpoint[] }>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const dbService = yield* _(DatabaseService);

			// Get member record to verify access
			const memberRecord = yield* _(
				dbService.query("getCurrentMember", async () => {
					return await db.query.member.findFirst({
						where: and(
							eq(authSchema.member.userId, session.user.id),
							eq(authSchema.member.organizationId, organizationId),
						),
					});
				}),
			);

			// Verify owner role (only owners can view webhooks)
			yield* _(verifyOwnerRole(memberRecord, session.user.id));

			// Get webhooks
			const webhooks = yield* _(
				Effect.promise(() => getWebhookEndpointsByOrganization(organizationId)),
			);

			return { webhooks };
		}),
	);
}

/**
 * Get delivery logs for a webhook
 */
export async function getWebhookDeliveryLogs(
	webhookId: string,
	options: { limit?: number; offset?: number } = {},
): Promise<ServerActionResult<{ deliveries: WebhookDelivery[]; total: number; hasMore: boolean }>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const dbService = yield* _(DatabaseService);

			// Get webhook to verify ownership
			const webhook = yield* _(
				Effect.promise(() => getWebhookEndpoint(webhookId)),
				Effect.flatMap((w) =>
					w
						? Effect.succeed(w)
						: Effect.fail(
								new NotFoundError({
									message: "Webhook not found",
									entityType: "webhook",
									entityId: webhookId,
								}),
							),
				),
			);

			// Get member record
			const memberRecord = yield* _(
				dbService.query("getCurrentMember", async () => {
					return await db.query.member.findFirst({
						where: and(
							eq(authSchema.member.userId, session.user.id),
							eq(authSchema.member.organizationId, webhook.organizationId),
						),
					});
				}),
			);

			// Verify owner role
			yield* _(verifyOwnerRole(memberRecord, session.user.id));

			// Get delivery logs
			const { limit = 50, offset = 0 } = options;
			const { deliveries, total } = yield* _(
				Effect.promise(() => getDeliveryLogs(webhookId, { limit, offset })),
			);

			return {
				deliveries,
				total,
				hasMore: offset + deliveries.length < total,
			};
		}),
	);
}

/**
 * Get available event types for webhook subscription
 */
export async function getAvailableEventTypes(): Promise<
	ServerActionResult<{ eventTypes: NotificationType[] }>
> {
	return runServerActionSafe(
		Effect.succeed({
			eventTypes: [...NOTIFICATION_TYPES],
		}),
	);
}

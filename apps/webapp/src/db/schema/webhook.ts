/**
 * Webhook System Schema
 *
 * Organization-level webhook endpoints with event subscriptions.
 * Delivery logs track webhook attempts with retry history.
 */

import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

import { organization, user } from "../auth-schema";
import { notificationTypeEnum } from "./enums";

// ============================================
// ENUMS
// ============================================

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
	"pending", // Queued, awaiting delivery
	"success", // Delivered successfully (2xx response)
	"failed", // Permanently failed (exhausted retries)
	"retrying", // Failed but will retry
]);

// ============================================
// WEBHOOK ENDPOINTS
// ============================================

/**
 * Organization webhook endpoints
 *
 * Each endpoint can subscribe to multiple notification event types.
 * Only organization owners can manage webhooks.
 */
export const webhookEndpoint = pgTable(
	"webhook_endpoint",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Endpoint configuration
		url: text("url").notNull(), // HTTPS endpoint URL
		secret: text("secret").notNull(), // HMAC-SHA256 secret for signature verification

		// Metadata
		name: varchar("name", { length: 100 }).notNull(), // User-friendly name
		description: text("description"),

		// Subscribed event types (array of notification types)
		subscribedEvents: jsonb("subscribed_events").$type<string[]>().notNull().default([]),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Statistics (cached for UI display)
		lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
		lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
		consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
		totalDeliveries: integer("total_deliveries").default(0).notNull(),
		totalSuccesses: integer("total_successes").default(0).notNull(),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("webhook_endpoint_organization_idx").on(table.organizationId),
		index("webhook_endpoint_is_active_idx").on(table.isActive),
		index("webhook_endpoint_organization_active_idx").on(table.organizationId, table.isActive),
	],
);

// ============================================
// WEBHOOK DELIVERY LOGS
// ============================================

/**
 * Webhook delivery attempt tracking
 *
 * Logs all delivery attempts with response details for debugging and monitoring.
 * Similar pattern to cron_job_execution.
 */
export const webhookDelivery = pgTable(
	"webhook_delivery",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		webhookEndpointId: uuid("webhook_endpoint_id")
			.notNull()
			.references(() => webhookEndpoint.id, { onDelete: "cascade" }),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Event details
		eventType: notificationTypeEnum("event_type").notNull(),
		eventId: text("event_id"), // Optional reference to source event/notification

		// Delivery details
		url: text("url").notNull(), // Snapshot of URL at delivery time

		// Request/response data
		payload: jsonb("payload").notNull(), // Webhook payload sent
		requestHeaders: jsonb("request_headers").$type<Record<string, string>>(),

		// Response tracking
		status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
		httpStatus: integer("http_status"), // HTTP response code (e.g., 200, 500)
		responseBody: text("response_body"), // First 10KB of response
		errorMessage: text("error_message"), // Error if delivery failed

		// Retry tracking
		attemptNumber: integer("attempt_number").default(1).notNull(), // 1-6 (initial + 5 retries)
		maxAttempts: integer("max_attempts").default(6).notNull(),
		nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

		// BullMQ job reference
		bullmqJobId: varchar("bullmq_job_id", { length: 100 }),

		// Timing
		scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"), // Response time in milliseconds

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("webhook_delivery_endpoint_idx").on(table.webhookEndpointId),
		index("webhook_delivery_organization_idx").on(table.organizationId),
		index("webhook_delivery_status_idx").on(table.status),
		index("webhook_delivery_event_type_idx").on(table.eventType),
		index("webhook_delivery_created_at_idx").on(table.createdAt),
		// For finding deliveries needing retry
		index("webhook_delivery_next_retry_idx").on(table.nextRetryAt),
		// Composite index for endpoint history queries
		index("webhook_delivery_endpoint_created_idx").on(table.webhookEndpointId, table.createdAt),
	],
);

// Type exports
export type WebhookEndpoint = typeof webhookEndpoint.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoint.$inferInsert;
export type WebhookDelivery = typeof webhookDelivery.$inferSelect;
export type NewWebhookDelivery = typeof webhookDelivery.$inferInsert;
export type WebhookDeliveryStatus = WebhookDelivery["status"];

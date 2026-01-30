/**
 * Event Bus Types
 *
 * Type definitions for the unified event bus system.
 */

import type { NotificationType } from "@/lib/notifications/types";

/**
 * Standard event payload structure
 */
export interface EventPayload {
	/** Event type (matches notification types) */
	type: NotificationType;
	/** Organization scope */
	organizationId: string;
	/** ISO 8601 timestamp when event was created */
	timestamp: string;
	/** Event-specific data */
	data: Record<string, unknown>;
	/** Optional source event/entity ID for correlation */
	sourceId?: string;
}

/**
 * Event subscriber interface
 */
export interface EventSubscriber {
	/** Unique name for the subscriber */
	name: string;
	/** Handler function (fire-and-forget, should not throw) */
	handler: (event: EventPayload) => Promise<void>;
	/** Optional priority (lower = higher priority, default 100) */
	priority?: number;
}

/**
 * Webhook payload structure (what gets sent to external endpoints)
 */
export interface WebhookPayload {
	/** Unique event ID */
	id: string;
	/** Event type */
	type: NotificationType;
	/** ISO 8601 timestamp */
	createdAt: string;
	/** Event data */
	data: {
		title?: string;
		message?: string;
		userId?: string;
		organizationId: string;
		entityType?: string;
		entityId?: string;
		actionUrl?: string;
		metadata?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

/**
 * Webhook HTTP headers
 */
export const WEBHOOK_HEADERS = {
	SIGNATURE: "X-Z8-Signature",
	TIMESTAMP: "X-Z8-Timestamp",
	EVENT_TYPE: "X-Z8-Event-Type",
	DELIVERY_ID: "X-Z8-Delivery-Id",
} as const;
